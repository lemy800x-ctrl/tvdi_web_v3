"use strict";
/* =====================================================================
   TÍNH NĂNG BỔ SUNG (nạp SAU app.js, dùng chung biến toàn cục của app.js)
   1. Liên kết chia sẻ + thẻ thông tin phường/xã (tải PNG)
   2. Bản tin tự động hàng tháng
   3. Máy tính cây xanh gắn với bản đồ + phường ưu tiên trồng cây
   4. Đảo nhiệt đô thị, so sánh trước/sau, độ tin cậy số liệu
   ===================================================================== */

/* ===== FEATURES-PURE-START ===== */
const REL_FULL = ["Cao - đo từ ảnh vệ tinh", "Trung bình - nội suy từ các tháng lân cận", "Thấp - dùng trung bình nhiều năm", "Dự báo - kết quả mô hình"];
const REL_SHORT = ["Ảnh thật", "Nội suy", "TB nhiều năm", "Dự báo"];
const REL_COLORS = ["#2e9b5f", "#e6c229", "#e68a2e", "#7a4fb0"];
METRICS.uhi = { key: "uhi", label: "ĐNĐT", unit: " °C", min: 0, max: 10, dec: 1, rank: "desc",
  legend: "Chênh nhiệt so với vùng nền (°C)",
  palette: ["#2b83ba", "#7fbfa8", "#d9ef8b", "#fee08b", "#fdae61", "#f46d43", "#d73027", "#a50026"] };
const NDVI_TREE = 0.75;   // NDVI giả định của điểm ảnh phủ kín tán cây

const isNum = (v) => v !== null && v !== undefined && !Number.isNaN(v);
function meanOf(arr) { const v = arr.filter(isNum); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function medianOf(arr) {
  const v = arr.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = Math.floor(v.length / 2);
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
}
function quantileOf(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function olsFit(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = meanOf(xs), my = meanOf(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let k = 0; k < n; k++) { const dx = xs[k] - mx, dy = ys[k] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy), n };
}
function topN(col, n, dir) {
  const a = [];
  col.forEach((v, i) => { if (isNum(v)) a.push({ i, v }); });
  a.sort((x, y) => (dir === "asc" ? x.v - y.v : y.v - x.v) || x.i - y.i);
  return a.slice(0, n);
}

/* Mức tin cậy của ô (phường i, tháng m): 0 ảnh thật, 1 nội suy, 2 trung bình nhiều năm, 3 dự báo */
function relLevel(d, i, m) {
  if (d.months[m].loai === "du_bao") return 3;
  const e = d.est[i][m];
  return e > 0 ? Math.min(e, 2) : 0;
}
function monthIndex(d, nam, thang) { return d.months.findIndex((x) => x.nam === nam && x.thang === thang); }

/* Đảo nhiệt đô thị: LST phường trừ LST trung bình của 25% phường có NDVI cao nhất cùng tháng (vùng nền) */
function computeUhi(d) {
  const W = d.wards.length, M = d.months.length;
  const uhi = d.wards.map(() => new Array(M).fill(null));
  for (let m = 0; m < M; m++) {
    const rows = [];
    for (let i = 0; i < W; i++) { const l = d.lst[i][m], n = d.ndvi[i][m]; if (isNum(l) && isNum(n)) rows.push({ i, l, n }); }
    if (rows.length < 8) continue;
    const thr = quantileOf(rows.map((r) => r.n).sort((a, b) => a - b), 0.75);
    const base = meanOf(rows.filter((r) => r.n >= thr).map((r) => r.l));
    rows.forEach((r) => { uhi[r.i][m] = r.l - base; });
  }
  return uhi;
}

/* Hệ số LST theo NDVI giữa các phường: trung vị của hệ số hồi quy từng tháng hiện trạng gần nhất (chỉ ô đo từ ảnh) */
function lstNdviSlope(d, lastN = 36) {
  const slopes = [], r2s = [];
  let used = 0;
  for (let m = d.months.length - 1; m >= 0 && used < lastN; m--) {
    if (d.months[m].loai !== "thuc_te") continue;
    used++;
    const xs = [], ys = [];
    for (let i = 0; i < d.wards.length; i++) {
      const l = d.lst[i][m], n = d.ndvi[i][m];
      if (d.est[i][m] === 0 && isNum(l) && isNum(n)) { xs.push(n); ys.push(l); }
    }
    const fit = xs.length >= 30 ? olsFit(xs, ys) : null;
    if (fit) { slopes.push(fit.slope); r2s.push(fit.r2); }
  }
  if (slopes.length < 6) return null;
  const slope = medianOf(slopes);
  if (!(slope < 0)) return null;   // quan hệ không âm thì không đủ cơ sở để ước tính
  return { slope, r2: medianOf(r2s), months: slopes.length };
}

/* Diện tích polygon (m2), xấp xỉ phép chiếu equirectangular tại vĩ độ trung bình */
function ringAreaM2(ring, lat0) {
  const R = 6371008.8, k = Math.PI / 180, c = Math.cos(lat0 * k);
  let s = 0;
  for (let j = 0; j < ring.length; j++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[(j + 1) % ring.length];
    s += (x1 * k * R * c) * (y2 * k * R) - (x2 * k * R * c) * (y1 * k * R);
  }
  return Math.abs(s) / 2;
}
function geomAreaM2(g) {
  if (!g) return 0;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  let total = 0;
  polys.forEach((rings) => {
    if (!rings.length) return;
    const lat0 = meanOf(rings[0].map((p) => p[1]));
    total += ringAreaM2(rings[0], lat0);
    for (let h = 1; h < rings.length; h++) total -= ringAreaM2(rings[h], lat0);
  });
  return total;
}

/* Ước tính giảm LST khi trồng N cây (tán S m2, hệ số f), dựa trên quan hệ LST-NDVI giữa các phường */
function treeCooling({ N, S, F, areaM2, ndviWard, slope }) {
  const frac = Math.min((N * S * F) / areaM2, 1);
  const dNdvi = frac * Math.max(NDVI_TREE - ndviWard, 0);
  return { frac, dNdvi, dLst: slope * dNdvi };
}
function treesForCooling({ target, S, F, areaM2, ndviWard, slope }) {
  const gain = -slope * Math.max(NDVI_TREE - ndviWard, 0);   // °C giảm được khi phủ kín cả phường
  if (!(gain > 0) || !(S * F > 0) || !(areaM2 > 0)) return null;
  const frac = target / gain;
  if (frac > 1) return { N: null, maxCooling: gain };
  return { N: Math.ceil((frac * areaM2) / (S * F)), frac, maxCooling: gain };
}
/* Phường ưu tiên trồng cây: LST cao và NDVI thấp (điểm = z(LST) - z(NDVI)) */
function priorityWards(d, m, topCount = 10) {
  const rows = [];
  d.wards.forEach((w, i) => { const l = d.lst[i][m], n = d.ndvi[i][m]; if (isNum(l) && isNum(n)) rows.push({ i, l, n }); });
  if (rows.length < 3) return [];
  const ml = meanOf(rows.map((r) => r.l)), mn = meanOf(rows.map((r) => r.n));
  const sd = (a, mu) => Math.sqrt(a.reduce((s, x) => s + (x - mu) * (x - mu), 0) / a.length) || 1;
  const sl = sd(rows.map((r) => r.l), ml), sn = sd(rows.map((r) => r.n), mn);
  rows.forEach((r) => { r.score = (r.l - ml) / sl - (r.n - mn) / sn; });
  rows.sort((a, b) => b.score - a.score || a.i - b.i);
  return rows.slice(0, topCount);
}

/* Thống kê một phường/xã cho thẻ thông tin */
function wardStats(d, i, m, key) {
  const col = d[key].map((r) => r[m]), v = col[i];
  if (!isNum(v)) return null;
  const n = col.filter(isNum).length, rank = 1 + col.filter((x) => isNum(x) && x > v).length;
  const city = meanOf(col), p = d.months[m];
  const py = monthIndex(d, p.nam - 1, p.thang), vy = py >= 0 ? d[key][i][py] : null;
  const vm = m > 0 ? d[key][i][m - 1] : null;
  const xs = [], ys = [];
  d.months.forEach((q, k) => {
    const x = d[key][i][k];
    if (q.loai === "thuc_te" && d.est[i][k] === 0 && isNum(x)) { xs.push(q.nam + (q.thang - 1) / 12); ys.push(x); }
  });
  const fit = xs.length >= 24 ? olsFit(xs, ys) : null;
  return { v, rank, n, city, diff: v - city, dYear: isNum(vy) ? v - vy : null, dMonth: isNum(vm) ? v - vm : null,
    trend: fit ? fit.slope : null, rel: relLevel(d, i, m) };
}
function wardSentence(name, key, st) {
  const M = METRICS[key], dec = M.dec, s = [];
  s.push(`${name} đứng thứ ${st.rank}/${st.n} về ${M.label} (hạng 1 là cao nhất), ${st.diff >= 0 ? "cao hơn" : "thấp hơn"} trung bình thành phố ${fmt(Math.abs(st.diff), dec)}${M.unit}.`);
  if (st.dYear !== null) s.push(`So với cùng kỳ năm trước, ${M.label} ${st.dYear >= 0 ? "tăng" : "giảm"} ${fmt(Math.abs(st.dYear), dec)}${M.unit}.`);
  if (st.trend !== null && Math.abs(st.trend) >= 0.5 * Math.pow(10, -dec)) {
    s.push(`Xu hướng nhiều năm ${st.trend > 0 ? "tăng" : "giảm"} khoảng ${fmt(Math.abs(st.trend), Math.max(dec, 2))}${M.unit} mỗi năm.`);
  }
  if (st.rel === 3) s.push("Đây là số liệu dự báo, mang tính tham khảo.");
  else if (st.rel > 0) s.push("Lưu ý: số liệu tháng này là ước lượng do thiếu ảnh vệ tinh dùng được.");
  return s.join(" ");
}

/* Bản tin tự động hàng tháng */
function bulletinData(d, m) {
  const p = d.months[m], W = d.wards.length, py = monthIndex(d, p.nam - 1, p.thang), city = {};
  ["tvdi", "lst", "ndvi"].forEach((k) => {
    const mean = meanOf(d[k].map((r) => r[m]));
    const pm = m > 0 ? meanOf(d[k].map((r) => r[m - 1])) : null;
    const pyv = py >= 0 ? meanOf(d[k].map((r) => r[py])) : null;
    city[k] = { mean, dMonth: isNum(mean) && isNum(pm) ? mean - pm : null, dYear: isNum(mean) && isNum(pyv) ? mean - pyv : null };
  });
  const tv = d.tvdi.map((r) => r[m]), counts = TVDI_CLASSES.map(() => 0);
  tv.forEach((v) => { const k = classIndex(TVDI_CLASSES, v); if (k >= 0) counts[k]++; });
  let rise = [], fall = [];
  if (m > 0) {
    const dl = d.tvdi.map((r) => (isNum(r[m]) && isNum(r[m - 1]) ? r[m] - r[m - 1] : null));
    rise = topN(dl, 5, "desc").filter((x) => x.v > 0);
    fall = topN(dl, 5, "asc").filter((x) => x.v < 0);
  }
  const anom = d.wards.map((w, i) => {
    const v = d.tvdi[i][m];
    if (!isNum(v)) return null;
    const hist = [];
    d.months.forEach((q, k) => { if (k !== m && q.thang === p.thang && q.loai === "thuc_te" && d.est[i][k] === 0 && isNum(d.tvdi[i][k])) hist.push(d.tvdi[i][k]); });
    return hist.length >= 3 ? v - meanOf(hist) : null;
  });
  const next = [];
  for (let k = m + 1; k < d.months.length && next.length < 3; k++) {
    if (d.months[k].loai !== "du_bao") continue;
    const col = d.tvdi.map((r) => r[k]);
    next.push({ p: d.months[k], mean: meanOf(col), dry: col.filter((v) => isNum(v) && v >= 0.6).length });
  }
  return {
    p, m, W, city, counts, topTvdi: topN(tv, 5, "desc"), topLst: topN(d.lst.map((r) => r[m]), 5, "desc"),
    topUhi: d.uhi ? topN(d.uhi.map((r) => r[m]), 5, "desc") : [], rise, fall,
    anom: { n: anom.filter((x) => isNum(x) && x >= 0.05).length, top: topN(anom, 5, "desc").filter((x) => x.v > 0) },
    nEst: d.est.reduce((a, row) => a + (row[m] > 0 ? 1 : 0), 0), next, forecast: p.loai === "du_bao",
  };
}
function bulletinTitle(b) { return `Bản tin khô hạn ${periodText(b.p).toLowerCase()} (${b.forecast ? "dự báo" : "hiện trạng"})`; }
function bulletinSections(d, b) {
  const sg = (v, dec) => { const r = Number(v.toFixed(dec)); return (r > 0 ? "+" : r < 0 ? "-" : "") + fmt(Math.abs(r), dec); };
  const list = (arr, k) => arr.map((x) => `${d.wards[x.i]} (${fmtMetric(k, x.v)})`).join("; ");
  const secs = [];
  const over = [];
  [["tvdi", "TVDI"], ["lst", "LST"], ["ndvi", "NDVI"]].forEach(([k, name]) => {
    const c = b.city[k];
    if (!isNum(c.mean)) return;
    const parts = [];
    if (c.dMonth !== null) parts.push(`so với tháng trước ${sg(c.dMonth, METRICS[k].dec)}${METRICS[k].unit}`);
    if (c.dYear !== null) parts.push(`so với cùng kỳ năm trước ${sg(c.dYear, METRICS[k].dec)}${METRICS[k].unit}`);
    over.push(`${name} trung bình ${fmtMetric(k, c.mean)}${parts.length ? " (" + parts.join("; ") + ")" : ""}.`);
  });
  if (!over.length) over.push("Tháng này chưa có dữ liệu.");
  secs.push({ title: "Tổng quan toàn thành phố", lines: over });

  const total = b.counts.reduce((a, x) => a + x, 0);
  if (total > 0) {
    const dry = b.counts[3] + b.counts[4];
    secs.push({ title: "Mức khô hạn (TVDI)", lines: [
      TVDI_CLASSES.map((c, k) => `${c.label}: ${b.counts[k]}`).join(" | ") + ` (trên ${total} phường/xã).`,
      dry > 0 ? `Cảnh báo: ${dry}/${total} phường/xã ở mức khô trở lên (TVDI từ 0,6).` : "Chưa có phường/xã nào ở mức khô (TVDI từ 0,6).",
    ] });
  }
  const hi = [];
  if (b.topTvdi.length) hi.push(`TVDI cao nhất: ${list(b.topTvdi, "tvdi")}.`);
  if (b.topLst.length) hi.push(`LST cao nhất: ${list(b.topLst, "lst")}.`);
  if (b.topUhi.length) hi.push(`Chênh nhiệt lớn nhất so với vùng nền: ${list(b.topUhi, "uhi")}.`);
  if (hi.length) secs.push({ title: "Phường/xã nổi bật", lines: hi });

  const ch = [];
  if (b.rise.length) ch.push(`TVDI tăng nhiều nhất so với tháng trước: ${b.rise.map((x) => `${d.wards[x.i]} (${sg(x.v, 2)})`).join("; ")}.`);
  if (b.fall.length) ch.push(`TVDI giảm nhiều nhất so với tháng trước: ${b.fall.map((x) => `${d.wards[x.i]} (${sg(x.v, 2)})`).join("; ")}.`);
  if (b.anom.n > 0) ch.push(`${b.anom.n} phường/xã có TVDI cao hơn trung bình cùng tháng các năm trước từ 0,05 trở lên; cao nhất: ${b.anom.top.map((x) => `${d.wards[x.i]} (${sg(x.v, 2)})`).join("; ")}.`);
  else if (b.anom.top.length === 0) ch.push("Không có phường/xã nào cao hơn rõ rệt so với trung bình cùng tháng các năm trước.");
  secs.push({ title: "Biến động", lines: ch });

  if (b.next.length) {
    secs.push({ title: "Dự báo các tháng tới", lines: b.next.map((x) => `${periodText(x.p)}: TVDI trung bình ${fmt(x.mean)}; ${x.dry} phường/xã ở mức khô trở lên.`).concat("Dự báo mang tính tham khảo, cần đọc cùng độ tin cậy số liệu.") });
  }
  secs.push({ title: "Độ tin cậy số liệu", lines: [
    b.forecast ? "Tháng này là kết quả dự báo của mô hình, không phải số đo trực tiếp."
      : b.nEst > 0 ? `${b.nEst}/${b.W} phường/xã trong tháng này là số ước lượng do thiếu ảnh vệ tinh dùng được.`
      : "Toàn bộ phường/xã trong tháng này được tính từ ảnh vệ tinh.",
  ] });
  return secs;
}
function bulletinText(d, b) {
  return [bulletinTitle(b)].concat(...bulletinSections(d, b).map((s) => ["", s.title.toUpperCase()].concat(s.lines.map((l) => "- " + l)))).join("\n");
}

/* So sánh hai thời điểm */
function compareStats(d, key, a, b) {
  const ca = d[key].map((r) => r[a]), cb = d[key].map((r) => r[b]);
  const mA = meanOf(ca), mB = meanOf(cb);
  const diff = ca.map((v, i) => (isNum(v) && isNum(cb[i]) ? cb[i] - v : null));
  return { mA, mB, d: isNum(mA) && isNum(mB) ? mB - mA : null, up: topN(diff, 5, "desc").filter((x) => x.v > 0), down: topN(diff, 5, "asc").filter((x) => x.v < 0) };
}

/* Liên kết chia sẻ */
function buildHash(s) {
  const p = ["m=" + s.metric, "t=" + s.nam + "-" + String(s.thang).padStart(2, "0")];
  if (s.view && s.view !== "2d") p.push("v=" + s.view);
  if (s.ward) p.push("w=" + encodeURIComponent(s.ward));
  return "#" + p.join("&");
}
function parseHash(h) {
  const o = {};
  String(h || "").replace(/^#/, "").split("&").forEach((kv) => {
    const k = kv.indexOf("=");
    if (k < 1) return;
    try { o[kv.slice(0, k)] = decodeURIComponent(kv.slice(k + 1)); } catch (_) { /* bỏ qua tham số hỏng */ }
  });
  const t = /^(\d{4})-(\d{1,2})$/.exec(o.t || "");
  return { metric: o.m, nam: t ? Number(t[1]) : null, thang: t ? Number(t[2]) : null, view: o.v, ward: o.w };
}
/* ===== FEATURES-PURE-END ===== */

/* =====================================================================
   PHẦN GIAO DIỆN
   ===================================================================== */


let relMode = false;       // đang tô bản đồ theo độ tin cậy
let applyingHash = false;  // đang áp dụng liên kết, không ghi ngược lại

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (_) {
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (__) { /* không hỗ trợ */ }
    ta.remove(); return ok;
  }
}
function saveBlob(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = (s) => norm(s).replace(/\s+/g, "_");
const lastActualIdx = (d) => { for (let m = d.months.length - 1; m >= 0; m--) if (d.months[m].loai === "thuc_te") return m; return -1; };

/* ---------- Chuẩn bị dữ liệu dẫn xuất (gọi từ loadAll) ---------- */
function prepareDerived(d) {
  d.uhi = computeUhi(d);
  d._reg = lstNdviSlope(d);
  state._areas = null;
  const sel = $("tc-ward");
  if (sel) {
    sel.replaceChildren(el("option", { value: "", text: "(Chưa chọn)" }));
    d.wards.forEach((w, i) => sel.append(el("option", { value: String(i), text: w })));
  }
}

/* ---------- 1. Liên kết chia sẻ ---------- */
function syncHash() {
  if (applyingHash || !state.data) return;
  const p = curPeriod();
  const h = buildHash({ metric: state.metric, nam: p.nam, thang: p.thang, view: state.view, ward: state.ward !== null ? state.data.wards[state.ward] : null });
  try { if (decodeURIComponent(location.hash) !== decodeURIComponent(h)) history.replaceState(null, "", h); } catch (_) { /* bỏ qua */ }
}
function applyHash(tries = 0) {
  if (!state.data || !location.hash || location.hash.length < 2) return;
  const o = parseHash(location.hash);
  applyingHash = true;
  try {
    if (o.metric && METRICS[o.metric]) setMetric(o.metric);
    if (o.view === "3d" || o.view === "2d") setView(o.view);
    if (o.nam && o.thang) { const j = monthIndex(state.data, o.nam, o.thang); if (j >= 0) { stopAnim(); goTo(j); } }
    if (o.ward) {
      const i = state.data.wards.findIndex((w) => w === o.ward || norm(w) === norm(o.ward));
      if (i >= 0) {
        selectWard(i, true);
        if (!state.layersReady && tries < 12) setTimeout(() => { applyHash(tries + 1); }, 600);   // bản đồ chưa sẵn sàng: thử lại để zoom
      }
    }
  } finally { applyingHash = false; }
  syncHash();
}
async function shareLink() {
  syncHash();
  const ok = await copyText(location.href);
  notify(ok ? "Đã sao chép liên kết. Ai mở liên kết sẽ thấy đúng tháng, chỉ số và phường/xã bạn đang xem." : "Không sao chép được tự động. Hãy sao chép địa chỉ trên thanh trình duyệt.", 4000);
}

/* ---------- Thẻ thông tin phường/xã ---------- */
function cardMetric() { return ["tvdi", "lst", "ndvi"].includes(state.metric) ? state.metric : "lst"; }
function openCard() {
  if (!state.data || state.ward === null) { notify("Hãy bấm chọn một phường/xã trên bản đồ trước."); return; }
  $("card-metric").value = cardMetric();
  $("dlg-card").showModal();
  drawCard();
}
function drawCard() {
  const d = state.data, i = state.ward, m = state.idx, p = d.months[m], key = $("card-metric").value, M = METRICS[key];
  const canvas = $("card-canvas"), W = 1080, H = 1350;
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d"), FONT = "'Be Vietnam Pro', sans-serif", st = wardStats(d, i, m, key);
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#1f7a5a"; g.lineWidth = 4; g.strokeRect(14, 14, W - 28, H - 28);
  g.fillStyle = "#1f7a5a"; g.fillRect(14, 14, W - 28, 176);
  g.fillStyle = "#fff"; g.textAlign = "left"; g.font = `500 24px ${FONT}`; g.fillText("THẺ THÔNG TIN PHƯỜNG/XÃ", 50, 60);
  g.font = `700 46px ${FONT}`;
  wrapLines(d.wards[i], W - 100, (t) => g.measureText(t).width).slice(0, 2).forEach((ln, k) => g.fillText(ln, 50, 118 + k * 52));
  g.fillStyle = "#1f3a2f"; g.font = `600 30px ${FONT}`;
  g.fillText(`${periodText(p)} - ${p.loai === "du_bao" ? "dự báo" : "hiện trạng"}`, 50, 238);

  ["tvdi", "lst", "ndvi"].forEach((k, n) => {
    const x = 50 + n * 335, v = d[k][i][m];
    g.fillStyle = "#eef5f1"; g.fillRect(x, 262, 315, 130);
    g.fillStyle = "#5d7468"; g.font = `500 22px ${FONT}`; g.fillText(METRICS[k].label, x + 18, 296);
    g.fillStyle = "#1f3a2f"; g.font = `700 44px ${FONT}`; g.fillText(fmtMetric(k, v), x + 18, 346);
    if (k === "tvdi" && isNum(v)) { const c = classIndex(TVDI_CLASSES, v); if (c >= 0) { g.fillStyle = "#5d7468"; g.font = `500 21px ${FONT}`; g.fillText("Mức: " + TVDI_CLASSES[c].label, x + 18, 378); } }
  });

  g.fillStyle = "#1f3a2f"; g.font = `700 30px ${FONT}`;
  if (st) {
    g.fillText(`Xếp hạng ${M.label}: ${st.rank}/${st.n} (hạng 1 là cao nhất)`, 50, 450);
    g.fillStyle = "#5d7468"; g.font = `500 26px ${FONT}`; g.fillText(`Trung bình thành phố: ${fmtMetric(key, st.city)}`, 50, 490);
  } else { g.fillText(`Không có dữ liệu ${M.label} cho tháng này`, 50, 450); }

  // Biểu đồ chuỗi theo tháng
  const row = d[key][i], cx = 90, cy = 560, cw = 900, ch = 380;
  g.fillStyle = "#1f3a2f"; g.font = `600 24px ${FONT}`;
  g.fillText(`${M.label} theo tháng (${d.months[0].nam} - ${d.months[d.months.length - 1].nam})`, 50, 530);
  g.fillStyle = "#f6f9f7"; g.fillRect(cx, cy, cw, ch);
  const vals = row.filter(isNum);
  if (vals.length) {
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const X = (k) => cx + 20 + (k / Math.max(d.months.length - 1, 1)) * (cw - 40), Y = (v) => cy + ch - 20 - ((v - lo) / (hi - lo)) * (ch - 40);
    g.font = `500 18px ${FONT}`; g.fillStyle = "#5d7468"; g.textAlign = "left";
    g.fillText(fmt(hi, M.dec), cx + 4, cy + 18); g.fillText(fmt(lo, M.dec), cx + 4, cy + ch - 4);
    d.months.forEach((q, k) => { if (q.thang === 1) { g.fillText(String(q.nam), X(k) - 16, cy + ch + 22); g.strokeStyle = "#dfe9e3"; g.lineWidth = 1; g.beginPath(); g.moveTo(X(k), cy); g.lineTo(X(k), cy + ch); g.stroke(); } });
    const seg = (cond, color, dash) => {
      g.strokeStyle = color; g.lineWidth = 3; g.setLineDash(dash); g.beginPath();
      let pen = false;
      row.forEach((v, k) => {
        if (isNum(v) && cond(k)) { if (!pen) { g.moveTo(X(k), Y(v)); pen = true; } else g.lineTo(X(k), Y(v)); } else pen = false;
      });
      g.stroke(); g.setLineDash([]);
    };
    seg((k) => d.months[k].loai === "thuc_te", "#0e6b8c", []);
    const la = lastActualIdx(d);
    seg((k) => d.months[k].loai === "du_bao" || k === la, "#7a4fb0", [10, 8]);
    if (isNum(row[m])) { g.fillStyle = "#c2531b"; g.beginPath(); g.arc(X(m), Y(row[m]), 9, 0, Math.PI * 2); g.fill(); }
  }

  // Nhận định bằng lời
  g.textAlign = "left"; g.fillStyle = "#1f3a2f"; g.font = `500 28px ${FONT}`;
  const text = st ? wardSentence(d.wards[i], key, st) : "Chưa có số liệu cho chỉ số này ở tháng đang xem.";
  wrapLines(text, W - 100, (t) => g.measureText(t).width).slice(0, 8).forEach((ln, k) => g.fillText(ln, 50, 1010 + k * 40));

  // Độ tin cậy + chân thẻ
  const lv = relLevel(d, i, m);
  g.fillStyle = REL_COLORS[lv]; g.fillRect(50, 1262, 22, 22);
  g.fillStyle = "#1f3a2f"; g.font = `600 24px ${FONT}`; g.fillText("Độ tin cậy: " + REL_FULL[lv], 84, 1281);
  g.fillStyle = "#5d7468"; g.font = `500 20px ${FONT}`; g.textAlign = "center";
  g.fillText("Hệ thống giám sát mức độ khô hạn tại TP.HCM - Landsat 8/9", W / 2, 1320);
}
function downloadCard() {
  const p = curPeriod();
  $("card-canvas").toBlob((b) => saveBlob(b, `the_${slug(state.data.wards[state.ward])}_${p.nam}_${String(p.thang).padStart(2, "0")}.png`));
}

/* ---------- 2. Bản tin ---------- */
function renderBulletin() {
  if (!state.data) return;
  const d = state.data, b = bulletinData(d, state.idx), box = $("bulletin-body");
  box.replaceChildren(el("h2", { text: bulletinTitle(b) }));
  bulletinSections(d, b).forEach((s) => {
    box.append(el("h3", { text: s.title }));
    const ul = el("ul", { class: "bul-list" });
    s.lines.forEach((l) => ul.append(el("li", { text: l })));
    box.append(ul);
  });
}
async function copyBulletin() {
  const d = state.data, ok = await copyText(bulletinText(d, bulletinData(d, state.idx)));
  notify(ok ? "Đã sao chép bản tin." : "Không sao chép được tự động.");
}
function downloadBulletin() {
  const d = state.data, p = curPeriod();
  saveBlob(new Blob([bulletinText(d, bulletinData(d, state.idx))], { type: "text/plain;charset=utf-8" }), `ban_tin_${p.nam}_${String(p.thang).padStart(2, "0")}.txt`);
}

/* ---------- 3. Máy tính cây xanh gắn bản đồ ---------- */
function wardAreaM2(i) {
  if (!state._areas) state._areas = state.geo.features.map((f) => geomAreaM2(f.geometry));
  return state._areas[i];
}
function renderTreeLink() {
  const d = state.data, out = $("tc-link-out");
  if (!d) return;
  out.replaceChildren();
  const add = (t, cls) => out.append(el("div", { class: cls || "", text: t }));
  const btn = $("tc-use-n"); btn.hidden = true;
  if ($("tc-ward").value === "") { add("Chọn một phường/xã để ước tính mức giảm LST từ số cây đã nhập."); return; }
  const i = Number($("tc-ward").value), m = lastActualIdx(d);
  if (m < 0 || !isNum(d.ndvi[i][m]) || !isNum(d.lst[i][m])) { add("Phường/xã này chưa có số liệu NDVI/LST."); return; }
  const area = wardAreaM2(i), ndvi = d.ndvi[i][m], lst = d.lst[i][m];
  add(`${d.wards[i]}: diện tích khoảng ${fmt(area / 1e4, 0)} ha; ${periodText(d.months[m])}: NDVI ${fmt(ndvi, 2)}, LST ${fmt(lst, 1)} °C.`, "strong");
  const reg = d._reg;
  if (!reg) { add("Chưa đủ cơ sở thống kê để ước tính (quan hệ LST - NDVI giữa các phường chưa rõ)."); return; }
  const N = parseVN($("tc-N").value), S = parseVN($("tc-S").value), F = parseVN($("tc-F").value), target = parseVN($("tc-target").value);
  add(`Quan hệ giữa các phường: NDVI tăng 0,1 thì LST giảm khoảng ${fmt(-reg.slope * 0.1, 1)} °C (R² khoảng ${fmt(reg.r2, 2)}, trung vị ${reg.months} tháng gần nhất).`);
  if ([N, S, F].every((x) => Number.isFinite(x) && x >= 0) && F <= 1) {
    const c = treeCooling({ N, S, F, areaM2: area, ndviWard: ndvi, slope: reg.slope });
    add(`Với ${fmt(N, 0)} cây (phủ ${fmt(c.frac * 100, 3)}% diện tích phường): LST trung bình phường giảm khoảng ${fmt(-c.dLst, 3)} °C.`);
  }
  if (Number.isFinite(target) && target > 0 && Number.isFinite(S) && Number.isFinite(F)) {
    const r = treesForCooling({ target, S, F, areaM2: area, ndviWard: ndvi, slope: reg.slope });
    if (!r) add("Không tính được số cây cần thiết (kiểm tra diện tán và hệ số f).");
    else if (r.N === null) add(`Mục tiêu giảm ${fmt(target, 2)} °C vượt khả năng của phường: kể cả phủ kín chỉ giảm tối đa khoảng ${fmt(r.maxCooling, 2)} °C.`);
    else { add(`Để giảm ${fmt(target, 2)} °C cần khoảng ${fmt(r.N, 0)} cây.`, "strong"); btn.hidden = false; btn.dataset.n = String(r.N); }
  }
  add("Đây là ước tính tham khảo từ quan hệ thống kê, không phải kết quả đo hay mô phỏng. Kết quả thực tế phụ thuộc loài cây, vị trí trồng và tuổi cây.", "muted small");
}
function renderPriority() {
  const d = state.data;
  if (!d) return;
  let m = state.idx; if (d.months[m].loai !== "thuc_te") m = lastActualIdx(d);
  const tb = document.querySelector("#tc-prio tbody"); tb.replaceChildren();
  $("tc-prio-cap").textContent = `Dựa trên ${periodText(d.months[m]).toLowerCase()}. Bấm một dòng để xem phường/xã trên bản đồ.`;
  priorityWards(d, m, 10).forEach((r, k) => {
    const tr = el("tr", { class: "click" }, [el("td", { text: `${k + 1}. ${d.wards[r.i]}` }), el("td", { text: fmt(r.l, 1) + " °C" }), el("td", { text: fmt(r.n, 2) })]);
    tr.addEventListener("click", () => { $("dlg-trees").close(); selectWard(r.i, true); showTab("overview"); if (window.innerWidth <= 900) openRail(true); });
    tb.append(tr);
  });
}

/* ---------- 4a. So sánh trước/sau ---------- */
function drawMsg(canvas, text) {
  canvas.width = 1754; canvas.height = 1240;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 1754, 1240);
  g.fillStyle = "#5d7468"; g.textAlign = "center"; g.font = "500 30px 'Be Vietnam Pro', sans-serif"; g.fillText(text, 877, 620);
}
function openCompare() {
  if (!state.data) { notify("Dữ liệu chưa tải xong."); return; }
  stopAnim();
  const d = state.data, sa = $("cmp-a"), sb = $("cmp-b");
  [sa, sb].forEach((s) => { s.replaceChildren(); d.months.forEach((p, i) => s.append(el("option", { value: String(i), text: `${p.thang}/${p.nam}${p.loai === "du_bao" ? " (dự báo)" : ""}` }))); });
  $("cmp-metric").value = state.metric;
  sb.value = String(state.idx);
  const py = monthIndex(d, curPeriod().nam - 1, curPeriod().thang);
  sa.value = String(py >= 0 ? py : 0);
  $("dlg-compare").showModal();
  renderCompare();
}
function renderCompare() {
  const d = state.data, key = $("cmp-metric").value, a = Number($("cmp-a").value), b = Number($("cmp-b").value);
  const ca = column(key, a), cb = column(key, b), all = ca.concat(cb);
  const draw = (canvas, idx, col) => {
    const p = d.months[idx];
    if (col.every((v) => !isNum(v))) { drawMsg(canvas, `${periodText(p)} chưa có dữ liệu ${METRICS[key].label}. Các tháng dự báo chỉ có TVDI.`); return; }
    drawThematic(canvas, { geo: state.geo, values: col, est: d.est.map((r) => r[idx]), metricKey: key, classes: makeClasses(key, all),
      title: themeTitle(key, p), subtitle: p.loai === "du_bao" ? "DỰ BÁO bằng mô hình học máy" : "HIỆN TRẠNG tính từ ảnh vệ tinh Landsat 8/9",
      modelNote: "", grid: false, north: false, scale: false, labels: false });
  };
  draw($("cmp-cv-a"), a, ca); draw($("cmp-cv-b"), b, cb);
  setCompareSlider();
  const s = compareStats(d, key, a, b), M = METRICS[key], sg = (v) => { const r = Number(v.toFixed(M.dec + 1)); return (r > 0 ? "+" : r < 0 ? "-" : "") + fmt(Math.abs(r), M.dec + 1) + M.unit; };
  const box = $("cmp-summary"); box.replaceChildren();
  box.append(el("p", { text: `${M.label} trung bình: ${periodText(d.months[a])} = ${fmtMetric(key, s.mA)}; ${periodText(d.months[b])} = ${fmtMetric(key, s.mB)}${s.d !== null ? " (chênh " + sg(s.d) + ")" : ""}.` }));
  const lines = (arr) => arr.map((x) => `${d.wards[x.i]} (${sg(x.v)})`).join("; ") || "không có";
  box.append(el("p", { text: `Tăng nhiều nhất: ${lines(s.up)}.` }));
  box.append(el("p", { text: `Giảm nhiều nhất: ${lines(s.down)}.` }));
}
function setCompareSlider() {
  const v = Number($("cmp-slider").value);
  $("cmp-cv-b").style.clipPath = `inset(0 0 0 ${v}%)`;
  $("cmp-line").style.left = `calc(${v}% - 1px)`;
}

/* ---------- 4b. Độ tin cậy: tô bản đồ theo mức tin cậy ---------- */
function paintReliability() {
  const d = state.data, map = state.map;
  if (!d || !state.layersReady) return;
  d.wards.forEach((w, i) => map.setFeatureState({ source: "wards", id: i }, { color: REL_COLORS[relLevel(d, i, state.idx)] }));
}
function updateUhiNote() { $("uhi-note").hidden = state.metric !== "uhi"; }

/* ---------- Móc vào các hàm của app.js ---------- */
const _goTo = goTo;
goTo = function (i) { _goTo(i); syncHash(); if (currentTab() === "bulletin") renderBulletin(); };
const _setMetric = setMetric;
setMetric = function (key) { _setMetric(key); updateUhiNote(); syncHash(); };
const _setView = setView;
setView = function (v) { _setView(v); syncHash(); };
const _selectWard = selectWard;
selectWard = function (i, zoom) { _selectWard(i, zoom); syncHash(); };
const _showTab = showTab;
showTab = function (name) { _showTab(name); if (currentTab() === "bulletin") renderBulletin(); };
const _applyToMap = applyToMap;
applyToMap = function () { _applyToMap(); if (relMode) paintReliability(); };
const _drawLegend = drawLegend;
drawLegend = function () {
  _drawLegend();
  if (!relMode) return;
  $("legend-title").textContent = "Độ tin cậy số liệu";
  $("legend-bar").style.background = `linear-gradient(to right, ${REL_COLORS.map((c, k) => `${c} ${k * 25}% ${(k + 1) * 25}%`).join(", ")})`;
  const t = $("legend-ticks"); t.replaceChildren();
  REL_SHORT.forEach((s) => t.append(el("span", { text: s })));
};
const _popupContent = popupContent;
popupContent = function (i) {
  const box = _popupContent(i), lv = relLevel(state.data, i, state.idx);
  const row = el("div", { class: "rel-row" }), dot = el("i");
  dot.style.background = REL_COLORS[lv];
  row.append(dot, document.createTextNode("Độ tin cậy: " + REL_FULL[lv]));
  box.append(row);
  return box;
};

/* ---------- Khởi động ---------- */
function onDataReady() {
  try { updateUhiNote(); applyHash(); } catch (e) { console.error("features:", e); }
}
function setupFeatures() {
  $("btn-share").addEventListener("click", shareLink);
  $("btn-ward-link").addEventListener("click", shareLink);
  $("btn-card").addEventListener("click", openCard);
  $("card-metric").addEventListener("change", drawCard);
  $("card-download").addEventListener("click", downloadCard);
  $("card-close").addEventListener("click", () => $("dlg-card").close());
  $("bul-copy").addEventListener("click", copyBulletin);
  $("bul-download").addEventListener("click", downloadBulletin);
  $("btn-compare").addEventListener("click", openCompare);
  $("cmp-close").addEventListener("click", () => $("dlg-compare").close());
  ["cmp-metric", "cmp-a", "cmp-b"].forEach((id) => $(id).addEventListener("change", renderCompare));
  $("cmp-slider").addEventListener("input", setCompareSlider);
  $("rel-toggle").addEventListener("change", (e) => { relMode = e.target.checked; drawLegend(); applyToMap(); });
  $("btn-ward-trees").addEventListener("click", () => { $("btn-trees").click(); });
  $("tc-ward").addEventListener("change", renderTreeLink);
  $("tc-target").addEventListener("input", renderTreeLink);
  $("tc-fields").addEventListener("input", renderTreeLink);
  $("tc-use-n").addEventListener("click", () => {
    const inp = $("tc-N"); inp.value = tcFmt(Number($("tc-use-n").dataset.n), 0, 0);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });
  $("btn-trees").addEventListener("click", () => {
    if (!state.data) return;
    $("tc-ward").value = state.ward === null ? "" : String(state.ward);
    renderPriority(); renderTreeLink();
  });
  window.addEventListener("hashchange", () => applyHash());
}
setupFeatures();
