"use strict";

/* =====================================================================
   PHẦN THUẦN (không đụng tới trình duyệt) - có kiểm thử riêng
   ===================================================================== */
/* ===== PURE-START ===== */
const NODATA = "#cfd8d3";
const DIM = "#e1e8e4";
const METRICS = {
  tvdi: { key: "tvdi", label: "TVDI", unit: "", min: 0, max: 1, dec: 2, rank: "desc",
    legend: "TVDI (0 ẩm - 1 khô)",
    palette: ["#066b00", "#0bc400", "#0ce100", "#00ff00", "#ffff00", "#ffcc00", "#ff6600", "#ff0000"] },
  lst: { key: "lst", label: "LST", unit: " °C", min: 20, max: 45, dec: 1, rank: "desc",
    legend: "Nhiệt độ bề mặt LST (°C)",
    palette: ["#0000FF", "#0066FF", "#00FFFF", "#00FF00", "#FFFF00", "#FFCC00", "#FF6600", "#FF0000"] },
  ndvi: { key: "ndvi", label: "NDVI", unit: "", min: -0.2, max: 1, dec: 2, rank: "asc",
    legend: "Chỉ số thực vật NDVI",
    palette: ["#FF0000", "#FF7F00", "#FFFF00", "#ADFF2F", "#00FF00", "#00FFFF", "#007FFF", "#0000FF"] },
};
const TVDI_CLASSES = [
  { label: "Rất ẩm", lo: 0, hi: 0.2 }, { label: "Ẩm", lo: 0.2, hi: 0.4 }, { label: "Trung bình", lo: 0.4, hi: 0.6 },
  { label: "Khô", lo: 0.6, hi: 0.8 }, { label: "Rất khô", lo: 0.8, hi: Infinity },
];

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

function colorFor(metricKey, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return NODATA;
  const M = METRICS[metricKey];
  const u = Math.min(Math.max((v - M.min) / (M.max - M.min), 0), 1) * (M.palette.length - 1);
  const i = Math.min(Math.floor(u), M.palette.length - 2);
  const f = u - i, a = hexToRgb(M.palette[i]), b = hexToRgb(M.palette[i + 1]);
  const c = a.map((x, k) => Math.round(x + (b[k] - x) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
function fmt(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return Number(v).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtMetric(key, v) { return v === null || v === undefined ? "-" : fmt(v, METRICS[key].dec) + METRICS[key].unit; }
function periodText(p) { return `Tháng ${p.thang}/${p.nam}`; }

function norm(s) {
  return String(s || "").normalize("NFD").toLowerCase().replace(/đ/g, "d").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim();
}
function cleanName(s) { return norm(s).replace(/^(phuong|xa|thi tran|dac khu) /, ""); }

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function round6(x) { return Math.round(x * 1e6) / 1e6; }

/* Chia lớp để tô bản đồ chuyên đề và thống kê. TVDI dùng 5 mức cố định. */
function makeClasses(metricKey, values) {
  if (metricKey === "tvdi") {
    return TVDI_CLASSES.map((c) => ({ ...c, color: colorFor("tvdi", Math.min((c.lo + Math.min(c.hi, 1)) / 2, 1)) }));
  }
  const v = values.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (!v.length) return [];
  const lo = Math.min(...v), hi = Math.max(...v);
  const step = niceStep((hi - lo) / 5 || 1);
  const start = Math.floor(round6(lo / step)) * step;
  const out = [];
  for (let a = start; a < hi + 1e-9 && out.length < 8; a = round6(a + step)) {
    const b = round6(a + step), d = METRICS[metricKey].dec;
    out.push({ lo: a, hi: b, label: `${fmt(a, d)} - ${fmt(b, d)}`, color: colorFor(metricKey, (a + b) / 2) });
  }
  return out;
}
function classIndex(classes, v) {
  if (v === null || v === undefined || Number.isNaN(v)) return -1;
  for (let i = 0; i < classes.length; i++) if (v >= classes[i].lo && (v < classes[i].hi || i === classes.length - 1)) return i;
  return -1;
}

function compare(op, v, a, b) {
  if (v === null || v === undefined || Number.isNaN(v)) return false;
  switch (op) {
    case "gt": return v > a;
    case "ge": return v >= a;
    case "lt": return v < a;
    case "le": return v <= a;
    case "between": return v >= Math.min(a, b) && v <= Math.max(a, b);
    default: return false;
  }
}
function opText(op) { return { gt: ">", ge: "≥", lt: "<", le: "≤", between: "từ" }[op]; }

/* Chỉ số các phường/xã có giá trị, xếp theo thứ tự yêu cầu ("desc" cao->thấp, "asc" thấp->cao). */
function rankIndices(values, order) {
  const idx = [];
  values.forEach((v, i) => { if (v !== null && v !== undefined && !Number.isNaN(v)) idx.push(i); });
  idx.sort((x, y) => (order === "asc" ? values[x] - values[y] : values[y] - values[x]) || x - y);
  return idx;
}
function cityMean(values) {
  const v = values.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function normHeight(metricKey, v) {
  if (v === null || v === undefined) return 0;
  const M = METRICS[metricKey];
  return Math.min(Math.max((v - M.min) / (M.max - M.min), 0), 1);
}

/* ---- Hỗ trợ bản đồ chuyên đề ---- */
function bboxOfGeometry(g, acc = [Infinity, Infinity, -Infinity, -Infinity]) {
  const walk = (c) => {
    if (typeof c[0] === "number") {
      acc[0] = Math.min(acc[0], c[0]); acc[1] = Math.min(acc[1], c[1]);
      acc[2] = Math.max(acc[2], c[0]); acc[3] = Math.max(acc[3], c[1]);
    } else c.forEach(walk);
  };
  walk(g.coordinates);
  return acc;
}
function bboxOfFeatures(features) {
  const acc = [Infinity, Infinity, -Infinity, -Infinity];
  features.forEach((f) => bboxOfGeometry(f.geometry, acc));
  return acc;
}
function makeProjection(bbox, rect) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const kx = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const wU = (maxLon - minLon) * kx, hU = maxLat - minLat;
  const scale = Math.min(rect.w / wU, rect.h / hU);
  const ox = rect.x + (rect.w - wU * scale) / 2, oy = rect.y + (rect.h - hU * scale) / 2;
  return {
    fn: (lon, lat) => [ox + (lon - minLon) * kx * scale, oy + (maxLat - lat) * scale],
    box: { x0: ox, y0: oy, x1: ox + wU * scale, y1: oy + hU * scale },
    metersPerPx: 111000 / scale,
  };
}
function graticuleStep(span) {
  for (const s of [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2]) if (span / s <= 7) return s;
  return 5;
}
function toDMS(deg, isLat) {
  const hemi = isLat ? (deg >= 0 ? "B" : "N") : (deg >= 0 ? "Đ" : "T");
  let a = Math.abs(deg), d = Math.floor(a + 1e-9), m = Math.round((a - d) * 60);
  if (m === 60) { d += 1; m = 0; }
  return `${d}°${String(m).padStart(2, "0")}′${hemi}`;
}
function niceScaleKm(maxKm) {
  for (const k of [100, 50, 25, 20, 10, 5, 2, 1, 0.5]) if (k <= maxKm) return k;
  return 0.5;
}
/* Tên bản đồ chuyên đề: hiện trạng/dự báo + chỉ số + tháng/năm */
function themeTitle(metricKey, p) {
  const what = { tvdi: "hạn hán (TVDI)", lst: "nhiệt độ bề mặt (LST)", ndvi: "chỉ số thực vật (NDVI)" }[metricKey];
  const kind = p.loai === "du_bao" ? "dự báo" : "hiện trạng";
  return `Bản đồ ${kind} ${what} TP.HCM sau sáp nhập (trừ đặc khu Côn Đảo) tháng ${p.thang} năm ${p.nam}`;
}
function wrapLines(text, maxW, measure) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (measure(t) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
/* ===== PURE-END ===== */


/* =====================================================================
   TRẠNG THÁI VÀ TIỆN ÍCH GIAO DIỆN
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const HEIGHT_M = 6000;           // chiều cao tối đa khi vẽ 3D (mét)
const state = {
  data: null, geo: null, idx: 0, metric: "tvdi", view: "2d", ward: null,
  filter: null, rank: { metric: "tvdi", reverse: false, q: "" },
  map: null, mapReady: false, layersReady: false, popup: null,
  anim: { playing: false, timer: null }, error: null,
  token: sessionStorage.getItem("adm") || null, charts: {}, modelTab: false,
};

function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v; else if (k === "class") n.className = v; else n.setAttribute(k, v);
  }
  kids.forEach((c) => n.append(c));
  return n;
}
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.admin && state.token) headers.Authorization = "Bearer " + state.token;
  let res;
  try { res = await fetch(path, { method: opts.method || "GET", headers, body: opts.body }); }
  catch (e) { throw new Error("Không kết nối được máy chủ. Máy chủ miễn phí có thể mất khoảng 1 phút để khởi động, hãy thử lại."); }
  if (!res.ok) {
    let msg = `Lỗi ${res.status}`;
    try { msg = (await res.json()).detail || msg; } catch (_) { /* giữ nguyên */ }
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return res.json();
}
const column = (metric, m) => state.data[metric].map((row) => row[m]);
const curPeriod = () => state.data.months[state.idx];

function renderNotice() {
  const n = $("notice");
  let msg = state.error;
  if (!msg && state.data && curPeriod().loai === "du_bao" && state.metric !== "tvdi") {
    msg = `Chưa có dự báo ${METRICS[state.metric].label}. Với các tháng dự báo, chỉ có chỉ số TVDI.`;
  }
  n.hidden = !msg; if (msg) n.textContent = msg;
}

/* =====================================================================
   BẢN ĐỒ (MapLibre: 2D và 3D dùng chung)
   ===================================================================== */

function initMap() {
  if (!window.maplibregl) {
    state.error = "Không tải được thư viện bản đồ. Kiểm tra kết nối mạng.";
    renderNotice();
    return;
  }

  const map = new maplibregl.Map({
    container: "map",
    center: [106.75, 10.85],
    zoom: 8.6,
    maxPitch: 70,
    attributionControl: { compact: true },

    style: {
      version: 8,

      sources: {
        carto: {
          type: "raster",
          tiles: [
            "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
          ],
          tileSize: 256,
          maxzoom: 20,
          attribution:
            "© OpenStreetMap contributors © CARTO"
        }
      },

      layers: [
        {
          id: "carto-background",
          type: "raster",
          source: "carto",
          paint: {
            "raster-saturation": -0.5,
            "raster-opacity": 1
          }
        }
      ]
    }
  });

  map.addControl(
    new maplibregl.NavigationControl({
      visualizePitch: true
    }),
    "top-right"
  );

  map.on("load", () => {
    state.mapReady = true;
    ensureLayers();
  });

  map.on("error", (e) => {
    console.error("Lỗi bản đồ:", e.error || e);
  });

  state.map = map;
}

function ensureLayers() {
  const map = state.map;
  if (!state.mapReady || !state.geo) return;
  if (map.getSource("wards")) { map.getSource("wards").setData(state.geo); applyToMap(); return; }
  const color = ["coalesce", ["feature-state", "color"], NODATA];
  map.addSource("wards", { type: "geojson", data: state.geo });
  map.addLayer({ id: "wards-fill", type: "fill", source: "wards", paint: { "fill-color": color,
    "fill-opacity": ["case", ["==", ["coalesce", ["feature-state", "est"], 0], 0], 0.88, 0.5] } });
  map.addLayer({ id: "wards-line", type: "line", source: "wards", paint: { "line-color": "#ffffff", "line-width": 0.6, "line-opacity": 0.9 } });
  map.addLayer({ id: "wards-3d", type: "fill-extrusion", source: "wards", layout: { visibility: "none" },
    paint: { "fill-extrusion-color": color, "fill-extrusion-height": ["coalesce", ["feature-state", "height"], 0],
             "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.92 } });
  if (!map.getLayer("wards-3d")) {              // trình duyệt/bản thư viện không hỗ trợ -> tắt 3D, vẫn dùng 2D
    state.no3d = true;
    document.querySelector('#seg-view [data-view="3d"]').hidden = true;
    state.view = "2d";
  }
  map.addLayer({ id: "wards-sel", type: "line", source: "wards", filter: ["==", ["get", "idx"], -1],
    paint: { "line-color": "#10231a", "line-width": 3 } });

  state.layersReady = true;
  const layers = state.no3d ? ["wards-fill"] : ["wards-fill", "wards-3d"];
  map.on("mousemove", (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers })[0];
    map.getCanvas().style.cursor = f ? "pointer" : "";
    if (!f) { state.popup.remove(); return; }
    state.popup.setLngLat(e.lngLat).setDOMContent(popupContent(f.properties.idx)).addTo(map);
  });
  map.on("mouseout", () => state.popup.remove());
  map.on("click", (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers })[0];
    if (f) { selectWard(f.properties.idx, false); showTab("overview"); if (window.innerWidth <= 900) openRail(true); }
  });
  fitCity();
  setView(state.view);
  applyToMap();
}

function fitCity() {
  const b = bboxOfFeatures(state.geo.features);
  state.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 70, bottom: 190, left: 30, right: 30 }, duration: 0 });
}

function popupContent(i) {
  const d = state.data, m = state.idx, box = el("div");
  box.append(el("b", { text: d.wards[i] }));
  const M = METRICS[state.metric];
  box.append(el("div", { text: `${M.label}: ${fmtMetric(state.metric, d[state.metric][i][m])}` }));
  if (state.metric === "tvdi") {
    const k = classIndex(TVDI_CLASSES, d.tvdi[i][m]);
    if (k >= 0) box.append(el("div", { text: `Mức: ${TVDI_CLASSES[k].label}` }));
  }
  const e = d.est[i][m];
  if (e) box.append(el("div", { class: "muted", text: e === 1 ? "Ước lượng: thiếu ảnh, nội suy từ các tháng lân cận." : "Ước lượng: thiếu ảnh lâu, dùng trung bình nhiều năm." }));
  return box;
}

/* Tô màu (2D) và đặt chiều cao (3D) cho từng phường/xã theo tháng, chỉ số và bộ lọc hiện tại */
function applyToMap() {
  if (!state.layersReady || !state.data) return;
  const map = state.map, m = state.idx, key = state.metric;
  const vals = column(key, m);
  const keep = state.filter ? column(state.filter.metric, m).map((v) => compare(state.filter.op, v, state.filter.a, state.filter.b)) : null;
  vals.forEach((v, i) => {
    const dim = keep && !keep[i];
    const color = v === null ? NODATA : dim ? DIM : colorFor(key, v);
    const height = v === null ? 0 : dim ? 150 : 300 + normHeight(key, v) * HEIGHT_M;
    map.setFeatureState({ source: "wards", id: i }, { color, height, est: state.data.est[i][m] || 0 });
  });
}

function setView(v) {
  state.view = state.no3d ? "2d" : v; v = state.view;
  document.querySelectorAll("#seg-view button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  const map = state.map;
  if (!map || !state.layersReady) return;
  if (state.no3d) v = "2d";
  const three = v === "3d";
  map.setLayoutProperty("wards-fill", "visibility", three ? "none" : "visible");
  map.setLayoutProperty("wards-line", "visibility", three ? "none" : "visible");
  map.setLayoutProperty("wards-3d", "visibility", three ? "visible" : "none");
  map.easeTo({ pitch: three ? 58 : 0, bearing: three ? -18 : 0, duration: 800 });
}

function selectWard(i, zoom) {
  state.ward = i;
  if (state.layersReady) state.map.setFilter("wards-sel", ["==", ["get", "idx"], i]);
  if (zoom && state.layersReady) {
    const b = bboxOfFeatures([state.geo.features[i]]);
    state.map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, maxZoom: 13, duration: 700 });
  }
  renderWard();
}

/* =====================================================================
   THANH THỜI GIAN
   ===================================================================== */
function buildStrip() {
  const strip = $("strip");
  strip.replaceChildren();
  const months = state.data.months;
  let yearBox = null, cells = null, curYear = null;
  months.forEach((p, i) => {
    const changed = i > 0 && months[i - 1].loai === "thuc_te" && p.loai === "du_bao";
    const divider = () => el("div", { class: "divider", "aria-hidden": "true" }, [
      el("span", { class: "l", text: "HIỆN TRẠNG" }), el("span", { class: "r", text: "DỰ BÁO" })]);
    if (p.nam !== curYear) {
      if (changed) strip.append(divider());
      curYear = p.nam;
      cells = el("div", { class: "cells" });
      yearBox = el("div", { class: "year" }, [el("div", { class: "year-label", text: String(p.nam) }), cells]);
      strip.append(yearBox);
    } else if (changed) cells.append(divider());
    cells.append(el("button", { type: "button", class: "cell" + (p.loai === "du_bao" ? " forecast" : ""), "data-i": String(i), tabindex: "-1" }));
  });
  strip.setAttribute("aria-valuemax", String(months.length - 1));
  recolorStrip();

  const opts = (sel) => {
    sel.replaceChildren();
    months.forEach((p, i) => sel.append(el("option", { value: String(i), text: `${p.thang}/${p.nam}${p.loai === "du_bao" ? " (dự báo)" : ""}` })));
  };
  ["anim-from", "anim-to", "th-period"].forEach((id) => opts($(id)));
  $("anim-from").value = String(Math.max(0, months.length - 25));
  $("anim-to").value = String(months.length - 1);
}

function recolorStrip() {
  const key = state.metric;
  document.querySelectorAll(".cell").forEach((c) => {
    const i = Number(c.dataset.i), mean = cityMean(column(key, i)), p = state.data.months[i];
    const nEst = state.data.est.reduce((a, row) => a + (row[i] > 0 ? 1 : 0), 0);
    const mostEst = p.loai === "thuc_te" && nEst / state.data.wards.length > 0.5;
    c.classList.toggle("est", mostEst);
    c.classList.toggle("nodata", mean === null);
    c.style.background = mean === null ? "" : colorFor(key, mean);
    c.title = `${periodText(p)} - ${p.loai === "du_bao" ? "dự báo" : "hiện trạng"} - ${METRICS[key].label} trung bình ${fmtMetric(key, mean)}${mostEst ? " (phần lớn là ước lượng do thiếu ảnh)" : ""}`;
    c.setAttribute("aria-label", c.title);
  });
}

function markActiveCell() {
  document.querySelectorAll(".cell.active").forEach((c) => c.classList.remove("active"));
  const c = document.querySelector(`.cell[data-i="${state.idx}"]`);
  if (c) { c.classList.add("active"); c.scrollIntoView({ block: "nearest", inline: "center" }); }
  const strip = $("strip"), p = curPeriod();
  strip.setAttribute("aria-valuenow", String(state.idx));
  strip.setAttribute("aria-valuetext", `${periodText(p)}, ${p.loai === "du_bao" ? "dự báo" : "hiện trạng"}`);
}

/* =====================================================================
   CHUYỂN THÁNG VÀ HIỂN THỊ
   ===================================================================== */
function goTo(i) {
  const n = state.data.months.length;
  state.idx = Math.min(Math.max(i, 0), n - 1);
  const p = curPeriod(), fc = p.loai === "du_bao";
  const b = $("banner");
  b.className = "banner " + (fc ? "forecast" : "actual");
  $("banner-mode").textContent = fc ? "DỰ BÁO" : "HIỆN TRẠNG";
  $("banner-period").textContent = periodText(p);
  $("strip-caption").textContent = `${periodText(p)} - ${fc ? "dự báo từ mô hình" : "tính từ ảnh vệ tinh"}`;
  markActiveCell();
  renderNotice();
  applyToMap();
  renderOverview();
  renderRank();
  if (state.ward !== null) renderWard();
}

function renderOverview() {
  const key = state.metric, M = METRICS[key], vals = column(key, state.idx), mean = cityMean(vals);
  $("mean-value").textContent = mean === null ? "-" : fmt(mean, M.dec);
  const classes = makeClasses(key, vals);
  const cnt = classes.map(() => 0);
  vals.forEach((v) => { const k = classIndex(classes, v); if (k >= 0) cnt[k]++; });
  const k = mean === null ? -1 : classIndex(classes, mean);
  $("mean-label").textContent = mean === null ? "Không có dữ liệu cho tháng này"
    : `${M.label} trung bình${M.unit ? " (" + M.unit.trim() + ")" : ""}${key === "tvdi" && k >= 0 ? ", mức " + classes[k].label.toLowerCase() : ""}`;
  const nEst = state.data.est.reduce((a, row) => a + (row[state.idx] > 0 ? 1 : 0), 0);
  const note = $("est-note");
  note.hidden = nEst === 0;
  if (nEst) note.textContent = `${nEst}/${state.data.wards.length} phường/xã trong tháng này là số ước lượng vì thiếu ảnh vệ tinh dùng được (hiện màu nhạt trên bản đồ).`;
  const total = cnt.reduce((a, b) => a + b, 0) || 1;
  const bar = $("class-bar"), list = $("class-list");
  bar.replaceChildren(); list.replaceChildren();
  classes.forEach((c, j) => {
    const s = el("span"); s.style.width = `${(cnt[j] / total) * 100}%`; s.style.background = c.color; bar.append(s);
    const sw = el("i"); sw.style.background = c.color;
    list.append(el("li", {}, [sw, el("span", { text: c.label }), el("b", { text: `${cnt[j]} phường/xã` })]));
  });
}

function drawLegend() {
  const M = METRICS[state.metric];
  $("legend-title").textContent = M.legend;
  $("legend-bar").style.background = `linear-gradient(to right, ${M.palette.map((c, i) => `${c} ${(i / (M.palette.length - 1)) * 100}%`).join(", ")})`;
  const t = $("legend-ticks"); t.replaceChildren();
  const range = M.max - M.min, td = range >= 5 ? 0 : 1;
  for (let i = 0; i <= 5; i++) t.append(el("span", { text: fmt(M.min + (range * i) / 5, td) }));
}

function setMetric(key) {
  state.metric = key;
  document.querySelectorAll("#seg-metric button").forEach((b) => b.classList.toggle("on", b.dataset.metric === key));
  $("th-metric").value = key;
  drawLegend();
  if (state.data) { recolorStrip(); renderNotice(); applyToMap(); renderOverview(); if (state.ward !== null) renderWard(); }
}

/* ---------- Phường/xã đang chọn ---------- */
function renderWard() {
  const i = state.ward, d = state.data;
  $("ward-block").hidden = false; $("hint-block").hidden = true;
  $("ward-name").textContent = d.wards[i];
  const box = $("ward-values"); box.replaceChildren();
  ["tvdi", "lst", "ndvi"].forEach((k) => box.append(el("div", { text: METRICS[k].label }, [el("b", { text: fmtMetric(k, d[k][i][state.idx]) })])));

  const key = state.metric, labels = d.months.map((p) => `${String(p.thang).padStart(2, "0")}/${p.nam}`);
  const row = d[key][i];
  const actual = row.map((v, m) => (d.months[m].loai === "thuc_te" ? v : null));
  const fore = row.map((v, m) => (d.months[m].loai === "du_bao" ? v : null));
  const lastA = actual.map((v, m) => (v !== null ? m : -1)).reduce((a, b) => Math.max(a, b), -1);
  if (lastA >= 0 && fore.some((v) => v !== null)) fore[lastA] = actual[lastA];
  const sets = [
    { label: "Hiện trạng", data: actual, borderColor: "#0e6b8c", borderWidth: 1.6, pointRadius: 0, tension: 0.2 },
    { label: "Dự báo", data: fore, borderColor: "#7a4fb0", borderDash: [5, 4], borderWidth: 2, pointRadius: 2.5, tension: 0.2 },
  ];
  const estPts = row.map((v, m) => (d.est[i][m] > 0 && d.months[m].loai === "thuc_te" ? v : null));
  if (estPts.some((v) => v !== null)) {
    sets.push({ label: "Ước lượng (thiếu ảnh)", data: estPts, showLine: false, pointStyle: "triangle", pointRadius: 4,
      borderColor: "#7a4fb0", backgroundColor: "#ffffff", borderWidth: 1.5 });
  }
  let note = "";
  if (key === "tvdi" && d.verify.months.length) {
    const v = labels.map(() => null);
    d.verify.months.forEach((p, j) => {
      const m = d.months.findIndex((x) => x.nam === p.nam && x.thang === p.thang);
      if (m >= 0) v[m] = d.verify.tvdi[i][j];
    });
    sets.push({ label: "Mô hình dự báo lại 2026 (kiểm chứng)", data: v, borderColor: "#c2531b", borderDash: [2, 3], borderWidth: 1.6, pointRadius: 1.5, tension: 0.2 });
    note = "Đường cam: kết quả mô hình dự báo trước cho các tháng 2026 khi chưa biết dữ liệu 2026, để so với đường hiện trạng.";
  }
  $("ward-chart-note").textContent = note;
  if (window.Chart) {
    if (state.charts.ward) state.charts.ward.destroy();
    const M = METRICS[key];
    state.charts.ward = new Chart($("ward-chart"), {
      type: "line", data: { labels, datasets: sets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: { y: { min: M.min, max: M.max, title: { display: true, text: M.label } }, x: { ticks: { maxTicksLimit: 7 } } },
        plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } } },
    });
  }
  const tb = $("ward-forecast").querySelector("tbody"); tb.replaceChildren();
  d.months.forEach((p, m) => {
    if (p.loai !== "du_bao") return;
    const v = d.tvdi[i][m], k = classIndex(TVDI_CLASSES, v);
    tb.append(el("tr", {}, [el("td", { text: periodText(p) }), el("td", { text: fmt(v) }), el("td", { text: k >= 0 ? TVDI_CLASSES[k].label : "-" })]));
  });
  if (!tb.children.length) tb.append(el("tr", {}, [el("td", { text: "Chưa có dự báo." })]));
}

function notify(msg, ms = 3500) {
  state.error = msg; renderNotice();
  setTimeout(() => { if (state.error === msg) { state.error = null; renderNotice(); } }, ms);
}

function renderForecastSummary() {
  const d = state.data, tb = $("fc-table").querySelector("tbody");
  tb.replaceChildren();
  const fl = d.months.map((p, m) => [p, m]).filter(([p]) => p.loai === "du_bao");
  $("fc-block").hidden = !fl.length;
  fl.forEach(([p, m]) => {
    const vals = column("tvdi", m), have = vals.filter((v) => v !== null).length, dry = vals.filter((v) => v !== null && v >= 0.6).length;
    const tr = el("tr", { class: "click" }, [el("td", { text: periodText(p) }), el("td", { text: fmt(cityMean(vals)) }), el("td", { text: `${dry}/${have}` })]);
    tr.addEventListener("click", () => { stopAnim(); goTo(m); });
    tb.append(tr);
  });
}

function playForecast() {
  const ms = state.data.months, last = ms.length - 1;
  let la = -1; ms.forEach((p, i) => { if (p.loai === "thuc_te") la = i; });
  if (la < 0 || la === last) { notify("Chưa có tháng dự báo trong dữ liệu."); return; }
  stopAnim();
  $("anim-from").value = String(la); $("anim-to").value = String(last);
  startAnim();
}

/* =====================================================================
   XẾP HẠNG VÀ LỌC THEO NGƯỠNG
   ===================================================================== */
function renderRank() {
  const { metric, reverse, q } = state.rank, M = METRICS[metric];
  const vals = column(metric, state.idx), d = state.data;
  let order = M.rank; if (reverse) order = order === "desc" ? "asc" : "desc";
  let ranked = rankIndices(vals, order);
  if (state.filter) {
    const f = state.filter, fv = column(f.metric, state.idx);
    ranked = ranked.filter((i) => compare(f.op, fv[i], f.a, f.b));
  }
  const withRank = ranked.map((i, r) => [i, r + 1]);
  const qq = norm(q);
  const shown = qq ? withRank.filter(([i]) => norm(d.wards[i]).includes(qq)) : withRank;
  const have = vals.filter((v) => v !== null).length;
  $("rank-count").textContent = have === 0 ? `Tháng này chưa có dữ liệu ${M.label}.`
    : `${shown.length} phường/xã${state.filter ? " thỏa điều kiện lọc" : ""} (có dữ liệu ${have}/${vals.length}). Thứ tự: ${M.label} ${order === "desc" ? "cao → thấp" : "thấp → cao"}.`;
  const ol = $("rank-list"); ol.replaceChildren();
  shown.forEach(([i, r]) => {
    const sw = el("i"); sw.style.background = colorFor(metric, vals[i]);
    const b = el("button", { type: "button" }, [el("span", { class: "rk", text: String(r) }), el("span", { class: "nm", text: d.wards[i] }, d.est[i][state.idx] ? [el("small", { text: "ước lượng" })] : []),
      el("span", { class: "vl", text: fmtMetric(metric, vals[i]) }), sw]);
    b.addEventListener("click", () => selectWard(i, true));
    ol.append(el("li", {}, [b]));
  });
}

function applyFilter() {
  const op = $("f-op").value, a = parseFloat($("f-a").value), b = parseFloat($("f-b").value);
  if (Number.isNaN(a) || (op === "between" && Number.isNaN(b))) { $("f-hint").textContent = "Nhập giá trị số hợp lệ."; return; }
  const metric = state.rank.metric;
  state.filter = { metric, op, a, b };
  const M = METRICS[metric];
  $("f-hint").textContent = `Đang lọc: ${M.label} ${opText(op)} ${fmt(a, M.dec)}${op === "between" ? " đến " + fmt(b, M.dec) : ""}${M.unit}. Phường/xã không thỏa điều kiện được làm mờ trên bản đồ.`;
  applyToMap(); renderRank();
}
function clearFilter() {
  state.filter = null;
  $("f-hint").textContent = "Ví dụ: chọn LST, phép >, giá trị 40 để hiện các phường có nhiệt độ bề mặt trên 40 °C.";
  applyToMap(); renderRank();
}

/* =====================================================================
   HOẠT ẢNH THEO KHOẢNG THỜI GIAN
   ===================================================================== */
function stopAnim() {
  state.anim.playing = false; clearTimeout(state.anim.timer);
  $("anim-play").textContent = "▶ Phát";
}
function startAnim() {
  let from = Number($("anim-from").value), to = Number($("anim-to").value);
  if (from > to) [from, to] = [to, from];
  if (from === to) { notify("Chọn khoảng thời gian có ít nhất 2 tháng."); return; }
  state.anim.playing = true; $("anim-play").textContent = "⏸ Dừng";
  const loop = () => {
    if (!state.anim.playing) return;
    let next = state.idx + 1;
    if (state.idx < from || next > to) {
      if (state.idx >= to && !$("anim-loop").checked) { stopAnim(); return; }
      next = from;
    }
    goTo(next);
    state.anim.timer = setTimeout(loop, 1100 / Number($("anim-speed").value));
  };
  goTo(from);
  state.anim.timer = setTimeout(loop, 1100 / Number($("anim-speed").value));
}

/* =====================================================================
   BẢN ĐỒ CHUYÊN ĐỀ: lập cho đúng tháng/năm và chỉ số người dùng chọn.
   Có khung tọa độ địa lý, la bàn, thước tỷ lệ, tên bản đồ, chú giải (vẽ bằng canvas, tải về PNG)
   ===================================================================== */
function drawThematic(canvas, spec) {
  const W = 1754, H = 1240; canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d");
  const FONT = "'Be Vietnam Pro', sans-serif";
  g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#1f3a2f"; g.lineWidth = 3; g.strokeRect(14, 14, W - 28, H - 28);

  // Tên bản đồ (tự xuống dòng) và phụ đề
  g.fillStyle = "#1f3a2f"; g.textAlign = "center"; g.font = `700 34px ${FONT}`;
  const tl = wrapLines(spec.title, W - 140, (t) => g.measureText(t).width);
  tl.forEach((ln, i) => g.fillText(ln, W / 2, 66 + i * 42));
  const subY = 66 + (tl.length - 1) * 42 + 40;
  g.font = `500 22px ${FONT}`; g.fillStyle = "#5d7468"; g.fillText(spec.subtitle, W / 2, subY);

  const top = subY + 28;
  const frame = { x: 110, y: top, w: 1130, h: H - top - 90 };
  const feats = spec.geo.features, bbox = bboxOfFeatures(feats);
  const pr = makeProjection(bbox, { x: frame.x + 30, y: frame.y + 30, w: frame.w - 60, h: frame.h - 60 });
  g.fillStyle = "#f6f9f7"; g.fillRect(frame.x, frame.y, frame.w, frame.h);
  const step = graticuleStep(Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]));

  // Lưới tọa độ địa lý
  g.save(); g.beginPath(); g.rect(frame.x, frame.y, frame.w, frame.h); g.clip();
  if (spec.grid) {
    g.strokeStyle = "#b9c8c0"; g.lineWidth = 1; g.setLineDash([6, 6]);
    for (let lon = Math.ceil(bbox[0] / step) * step; lon <= bbox[2] + 1e-9; lon += step) {
      const [x] = pr.fn(lon, bbox[1]); g.beginPath(); g.moveTo(x, frame.y); g.lineTo(x, frame.y + frame.h); g.stroke();
    }
    for (let lat = Math.ceil(bbox[1] / step) * step; lat <= bbox[3] + 1e-9; lat += step) {
      const [, y] = pr.fn(bbox[0], lat); g.beginPath(); g.moveTo(frame.x, y); g.lineTo(frame.x + frame.w, y); g.stroke();
    }
    g.setLineDash([]);
  }
  // Phường/xã. Ô ước lượng (thiếu ảnh) được kẻ gạch chéo.
  feats.forEach((f, i) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    g.beginPath();
    polys.forEach((poly) => poly.forEach((ring) => {
      ring.forEach((c, k) => { const [x, y] = pr.fn(c[0], c[1]); if (k) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
    }));
    const k = classIndex(spec.classes, spec.values[i]);
    g.fillStyle = k >= 0 ? spec.classes[k].color : "#e6eaed"; g.fill("evenodd");
    g.strokeStyle = "#5d7468"; g.lineWidth = 0.8; g.stroke();
    if (spec.est && spec.est[i] > 0 && spec.values[i] !== null) {
      const bb = bboxOfGeometry(f.geometry), [ax, ay] = pr.fn(bb[0], bb[3]), [bx, by] = pr.fn(bb[2], bb[1]), h = by - ay;
      g.save(); g.clip("evenodd");
      g.strokeStyle = "rgba(90, 50, 150, .8)"; g.lineWidth = 1.2;
      for (let x = ax - h; x < bx; x += 7) { g.beginPath(); g.moveTo(x, by); g.lineTo(x + h, ay); g.stroke(); }
      g.restore();
    }
  });
  if (spec.labels) {
    g.fillStyle = "#10231a"; g.font = `500 11px ${FONT}`; g.textAlign = "center";
    feats.forEach((f, i) => {
      const b = bboxOfGeometry(f.geometry), [x, y] = pr.fn((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      if (spec.values[i] !== null) g.fillText(fmt(spec.values[i], METRICS[spec.metricKey].dec), x, y);
    });
  }
  g.restore();
  g.strokeStyle = "#1f3a2f"; g.lineWidth = 2; g.strokeRect(frame.x, frame.y, frame.w, frame.h);

  // Nhãn tọa độ trên khung
  if (spec.grid) {
    g.fillStyle = "#1f3a2f"; g.font = `500 17px ${FONT}`; g.textAlign = "center";
    for (let lon = Math.ceil(bbox[0] / step) * step; lon <= bbox[2] + 1e-9; lon += step) {
      const [x] = pr.fn(lon, bbox[1]); if (x > frame.x + 40 && x < frame.x + frame.w - 40) g.fillText(toDMS(lon, false), x, frame.y + frame.h + 28);
    }
    g.textAlign = "right";
    for (let lat = Math.ceil(bbox[1] / step) * step; lat <= bbox[3] + 1e-9; lat += step) {
      const [, y] = pr.fn(bbox[0], lat); if (y > frame.y + 20 && y < frame.y + frame.h - 20) g.fillText(toDMS(lat, true), frame.x - 10, y + 6);
    }
  }
  // La bàn
  if (spec.north) {
    const cx = frame.x + frame.w - 70, cy = frame.y + 85;
    g.fillStyle = "#1f3a2f"; g.beginPath(); g.moveTo(cx, cy - 48); g.lineTo(cx + 16, cy + 18); g.lineTo(cx, cy + 6); g.lineTo(cx - 16, cy + 18); g.closePath(); g.fill();
    g.strokeStyle = "#1f3a2f"; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 36, 0, Math.PI * 2); g.stroke();
    g.textAlign = "center"; g.font = `700 22px ${FONT}`; g.fillText("B", cx, cy - 56);
  }
  // Thước tỷ lệ
  if (spec.scale) {
    const km = niceScaleKm(frame.w * 0.28 * pr.metersPerPx / 1000), len = (km * 1000) / pr.metersPerPx;
    const x0 = frame.x + 36, y0 = frame.y + frame.h - 46;
    for (let q = 0; q < 4; q++) { g.fillStyle = q % 2 ? "#fff" : "#1f3a2f"; g.fillRect(x0 + (len / 4) * q, y0, len / 4, 10); }
    g.strokeStyle = "#1f3a2f"; g.lineWidth = 1.5; g.strokeRect(x0, y0, len, 10);
    g.fillStyle = "#1f3a2f"; g.font = `500 16px ${FONT}`; g.textAlign = "center";
    g.fillText("0", x0, y0 - 6); g.fillText(`${km / 2} km`, x0 + len / 2, y0 - 6); g.fillText(`${km} km`, x0 + len, y0 - 6);
  }

  // Chú giải
  const lx = frame.x + frame.w + 50; let ly = top + 20;
  g.textAlign = "left"; g.fillStyle = "#1f3a2f"; g.font = `700 24px ${FONT}`; g.fillText("CHÚ GIẢI", lx, ly);
  g.font = `600 20px ${FONT}`; ly += 40; g.fillText(METRICS[spec.metricKey].legend, lx, ly); ly += 16;
  const counts = spec.classes.map(() => 0); let none = 0;
  spec.values.forEach((v) => { const k = classIndex(spec.classes, v); if (k >= 0) counts[k]++; else none++; });
  g.font = `500 18px ${FONT}`;
  const row = (color, label, hatch) => {
    ly += 38; g.fillStyle = color; g.fillRect(lx, ly - 22, 44, 26);
    if (hatch) {
      g.save(); g.beginPath(); g.rect(lx, ly - 22, 44, 26); g.clip(); g.strokeStyle = "rgba(90, 50, 150, .8)"; g.lineWidth = 1.2;
      for (let x = lx - 26; x < lx + 44; x += 7) { g.beginPath(); g.moveTo(x, ly + 4); g.lineTo(x + 26, ly - 22); g.stroke(); }
      g.restore();
    }
    g.strokeStyle = "#5d7468"; g.lineWidth = 1; g.strokeRect(lx, ly - 22, 44, 26);
    g.fillStyle = "#1f3a2f"; g.fillText(label, lx + 58, ly - 2);
  };
  const lab = (c) => (spec.metricKey === "tvdi" ? `${c.label} (${c.hi === Infinity ? "từ " + fmt(c.lo, 1) : fmt(c.lo, 1) + " - " + fmt(c.hi, 1)})` : c.label);
  spec.classes.forEach((c, k) => row(c.color, `${lab(c)}  [${counts[k]}]`));
  row("#e6eaed", `Không có dữ liệu  [${none}]`);
  const nEst = (spec.est || []).filter((e, i) => e > 0 && spec.values[i] !== null).length;
  if (nEst) row("#ffffff", `Số liệu ước lượng  [${nEst}]`, true);
  ly += 50; g.font = `500 17px ${FONT}`; g.fillStyle = "#5d7468";
  const notes = ["Số trong [ ]: số phường/xã.", nEst ? "Gạch chéo: thiếu ảnh vệ tinh dùng được," : "", nEst ? "số liệu nội suy hoặc lấy trung bình nhiều năm." : "", "",
    "Hệ tọa độ: WGS 84 (EPSG:4326).", "Ranh giới: phường/xã TP.HCM sau sáp nhập,", "không gồm đặc khu Côn Đảo.",
    "Nguồn dữ liệu: ảnh Landsat 8/9, xử lý", "trên Google Earth Engine.", spec.modelNote || ""];
  notes.forEach((t) => { if (t) g.fillText(t, lx, ly); ly += 26; });
}

function drawMessage(canvas, msg) {
  canvas.width = 1754; canvas.height = 420;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, 1754, 420);
  g.fillStyle = "#5d7468"; g.textAlign = "center"; g.font = "500 26px 'Be Vietnam Pro', sans-serif";
  g.fillText(msg, 877, 210);
}

function redrawTheme() {
  const key = $("th-metric").value, i = Number($("th-period").value), p = state.data.months[i];
  const values = column(key, i), canvas = $("th-canvas");
  if (values.every((v) => v === null)) { drawMessage(canvas, `Tháng ${p.thang}/${p.nam} chưa có dữ liệu ${METRICS[key].label}. Các tháng dự báo chỉ có TVDI.`); return; }
  const fc = p.loai === "du_bao", fm = state.data.forecast_model;
  drawThematic(canvas, {
    geo: state.geo, values, est: state.data.est.map((r) => r[i]), metricKey: key, classes: makeClasses(key, values),
    title: $("th-title").value.trim() || themeTitle(key, p),
    subtitle: fc ? `DỰ BÁO bằng mô hình học máy${fm ? " (" + fm + ")" : ""}` : "HIỆN TRẠNG tính từ ảnh vệ tinh Landsat 8/9",
    modelNote: fc && fm ? `Mô hình dự báo: ${fm}.` : "",
    grid: $("th-grid").checked, north: $("th-north").checked, scale: $("th-scale").checked, labels: $("th-labels").checked,
  });
}
function openTheme() {
  if (!state.data) { notify("Dữ liệu chưa tải xong."); return; }
  stopAnim();
  $("th-metric").value = state.metric; $("th-period").value = String(state.idx); $("th-title").value = "";
  $("dlg-theme").showModal();
  redrawTheme();
}
function downloadTheme() {
  const key = $("th-metric").value, p = state.data.months[Number($("th-period").value)];
  $("th-canvas").toBlob((b) => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(b);
    a.download = `ban_do_${key}_${p.loai === "du_bao" ? "du_bao" : "hien_trang"}_${p.nam}_${String(p.thang).padStart(2, "0")}.png`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

/* =====================================================================
   TAB MÔ HÌNH
   ===================================================================== */
async function loadModelTab() {
  if (state.modelTab) return;
  $("model-used").textContent = state.data.forecast_model
    ? `Dự báo các tháng tới dùng: ${state.data.forecast_model}. Mô hình học phần lệch của TVDI so với trung bình nhiều năm của từng phường/xã theo từng tháng (kèm mùa vụ), rồi dự báo lần lượt từng tháng. Kết quả dự báo được giữ nguyên, không điều chỉnh sau khi tính.`
    : "Chưa có thông tin mô hình dự báo.";
  try {
    const [models, verify, edge] = await Promise.all([api("/api/models"), api("/api/verify"), api("/api/edge-r2")]);
    const tb = document.querySelector("#model-table tbody"); tb.replaceChildren();
    models.forEach((m) => tb.append(el("tr", {}, [el("td", { text: m.mo_hinh }), el("td", { text: fmt(m.mae, 4) }), el("td", { text: fmt(m.rmse, 4) }),
      el("td", { text: fmt(m.r2, 3) }), el("td", { text: m.so_voi_khi_hau === null ? "-" : (m.so_voi_khi_hau > 0 ? "+" : "") + fmt(m.so_voi_khi_hau * 100, 1) + "%" })])));
    if (!models.length) tb.append(el("tr", {}, [el("td", { text: "Chưa có dữ liệu so sánh mô hình." })]));

    const vb = document.querySelector("#verify-table tbody"); vb.replaceChildren();
    verify.forEach((v) => vb.append(el("tr", {}, [el("td", { text: `${v.thang_du_bao} tháng` }), el("td", { text: String(v.n) }),
      el("td", { text: fmt(v.rmse_mo_hinh, 4) }), el("td", { text: fmt(v.rmse_khi_hau, 4) })])));
    if (!verify.length) vb.append(el("tr", {}, [el("td", { text: "Chưa có kết quả kiểm chứng." })]));
    if (window.Chart) {
      if (state.charts.verify) state.charts.verify.destroy();
      if (verify.length) state.charts.verify = new Chart($("verify-chart"), { type: "bar", data: { labels: verify.map((v) => `${v.thang_du_bao} th.`),
        datasets: [{ label: "RMSE mô hình", data: verify.map((v) => v.rmse_mo_hinh), backgroundColor: "#7a4fb0" },
                   { label: "RMSE chỉ dùng trung bình nhiều năm", data: verify.map((v) => v.rmse_khi_hau), backgroundColor: "#9aa7b3" }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, title: { display: true, text: "RMSE (thấp hơn là tốt hơn)" } } },
          plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } } } });
      if (state.charts.edge) state.charts.edge.destroy();
      if (edge.length) state.charts.edge = new Chart($("edge-chart"), { type: "bar", data: { labels: edge.map((e) => "T" + e.thang),
        datasets: [{ label: "Cạnh khô", data: edge.map((e) => e.r2_dry), backgroundColor: "#ff6600" },
                   { label: "Cạnh ướt", data: edge.map((e) => e.r2_wet), backgroundColor: "#0e6b8c" }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, title: { display: true, text: "R² trung bình" } } },
          plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } } } });
    }
    state.modelTab = true;
  } catch (e) { state.error = e.message; renderNotice(); }
}

/* =====================================================================
   QUẢN TRỊ (mọi thao tác đều được máy chủ kiểm tra lại bằng mật khẩu/phiên đăng nhập)
   ===================================================================== */
const UPLOADS = [
  { kind: "thuc-te", title: "Hiện trạng: TVDI, LST, NDVI theo phường/xã (đã lấp tháng thiếu ảnh)", file: "tvdi_phuong_xa_hienthi.csv" },
  { kind: "du-bao", title: "Dự báo và kiểm chứng", file: "du_bao_phuong_xa.csv" },
  { kind: "mo-hinh", title: "So sánh mô hình", file: "ket_qua_so_sanh_mo_hinh.csv" },
  { kind: "kiem-chung", title: "Tóm tắt kiểm chứng", file: "kiem_chung_tom_tat.csv" },
  { kind: "canh-kho-uot", title: "Hệ số cạnh khô/cạnh ướt", file: "thong_so_bien_full.csv" },
];
function setAdmin(on) {
  $("tab-admin").hidden = !on;
  $("btn-admin").textContent = on ? "Quản trị ✓" : "Quản trị";
  if (!on) { state.token = null; sessionStorage.removeItem("adm"); if (currentTab() === "admin") showTab("overview"); }
}
async function adminCall(path, opts = {}) {
  try { return await api(path, { ...opts, admin: true }); }
  catch (e) { if (e.status === 401) { setAdmin(false); } throw e; }
}
async function loadAdmin() {
  const box = $("admin-uploads");
  if (!box.children.length) UPLOADS.forEach((u) => {
    const msg = el("div", { class: "u-msg" }), inp = el("input", { type: "file", accept: ".csv,text/csv" });
    const btn = el("button", { type: "button", class: "primary", text: "Tải lên" });
    btn.addEventListener("click", async () => {
      if (!inp.files[0]) { msg.textContent = "Chọn file CSV trước."; msg.className = "u-msg error"; return; }
      btn.disabled = true; msg.className = "u-msg"; msg.textContent = "Đang nạp...";
      try {
        const r = await adminCall(`/api/admin/upload/${u.kind}`, { method: "POST", headers: { "Content-Type": "text/csv; charset=utf-8" }, body: inp.files[0] });
        msg.className = "u-msg ok"; msg.textContent = `Đã nạp ${r.rows.toLocaleString("vi-VN")} dòng.`;
        state.modelTab = false; await loadAll(true); loadAdmin();
      } catch (e) { msg.className = "u-msg error"; msg.textContent = e.message; }
      btn.disabled = false;
    });
    box.append(el("div", { class: "upload" }, [el("div", { class: "u-title", text: u.title }),
      el("div", { class: "muted small", text: `File mẫu: ${u.file}` }), el("div", { class: "u-row" }, [inp, btn]), msg]));
  });
  try {
    const s = await adminCall("/api/admin/status");
    const st = $("admin-status"); st.replaceChildren();
    const line = (t) => st.append(el("div", { text: t }));
    line(`Phường/xã có ranh giới: ${s.wards_geometry} | số tháng: ${s.months}`);
    s.by_loai.forEach((r) => line(`${r.loai}: ${Number(r.so_dong).toLocaleString("vi-VN")} dòng (${r.tu} đến ${r.den})`));
    line("Chất lượng hiện trạng: " + s.quality.map((q) => `${q.trang_thai} ${q.so_dong}`).join(", "));
    if (s.unmatched_count) line(`! ${s.unmatched_count} tên phường/xã trong dữ liệu không khớp ranh giới: ${s.unmatched.slice(0, 5).join("; ")}...`);
    const q = await adminCall("/api/admin/quality");
    const tb = document.querySelector("#admin-quality tbody"); tb.replaceChildren();
    q.forEach((r) => tb.append(el("tr", {}, [el("td", { text: `${String(r.thang).padStart(2, "0")}/${r.nam}` }), el("td", { text: r.so_anh === null ? "-" : String(r.so_anh) }),
      el("td", { text: `${r.uoc_luong}/${r.tong}` })])));
    if (!q.length) tb.append(el("tr", {}, [el("td", { text: "Không có." })]));
  } catch (e) { $("admin-status").textContent = e.message; }
}
async function doLogin(ev) {
  ev.preventDefault();
  const msg = $("login-msg"); msg.textContent = "";
  try {
    const r = await api("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("login-pw").value }) });
    state.token = r.token; sessionStorage.setItem("adm", r.token);
    $("login-pw").value = ""; $("dlg-login").close();
    setAdmin(true); showTab("admin"); if (window.innerWidth <= 900) openRail(true); loadAdmin();
  } catch (e) { msg.textContent = e.message; }
}

/* =====================================================================
   TRỢ LÝ HỎI ĐÁP (chạy hoàn toàn trên trình duyệt, theo quy tắc, chưa dùng mô hình ngôn ngữ)
   ===================================================================== */
function chatAnswer(q) {
  const d = state.data, t = " " + norm(q) + " ", p = curPeriod();
  // 1. Chuyển tháng: "tháng 5/2026", "3/2025"
  const mm = t.match(/(?:thang\s*)?\b(\d{1,2})\s*[\/-]\s*(20\d\d)\b/) || t.match(/thang\s*(\d{1,2})(?:\s*nam\s*(20\d\d))?/);
  if (mm && Number(mm[1]) >= 1 && Number(mm[1]) <= 12 && !/\b(bao nhieu|tren|duoi)\b/.test(t.replace(mm[0], ""))) {
    const th = Number(mm[1]), nam = mm[2] ? Number(mm[2]) : p.nam;
    const j = d.months.findIndex((x) => x.thang === th && x.nam === nam);
    if (j < 0) return `Chưa có dữ liệu tháng ${th}/${nam}. Dữ liệu từ ${periodText(d.months[0]).toLowerCase()} đến ${periodText(d.months[d.months.length - 1]).toLowerCase()}.`;
    stopAnim(); goTo(j);
    return `Đã chuyển bản đồ sang ${periodText(d.months[j]).toLowerCase()} (${d.months[j].loai === "du_bao" ? "dự báo" : "hiện trạng"}).`;
  }
  // 2. Chỉ số được hỏi
  const metric = /\b(lst|nhiet do|nong|mat)\b/.test(t) ? "lst" : /\b(ndvi|thuc vat|cay xanh|xanh|cay)\b/.test(t) ? "ndvi" : /\b(tvdi|kho han|kho|am)\b/.test(t) ? "tvdi" : state.metric;
  const M = METRICS[metric], vals = column(metric, state.idx);
  if (vals.every((v) => v === null)) return `Tháng này chưa có dữ liệu ${M.label} (các tháng dự báo chỉ có TVDI).`;
  // 3. Phường/xã được nhắc tên (tên dài nhất khớp)
  let best = -1, bl = 0;
  d.wards.forEach((w, i) => { const c = cleanName(w); if (c.length >= 4 && t.includes(" " + c + " ") && c.length > bl) { best = i; bl = c.length; } });
  if (best >= 0) {
    selectWard(best, true); showTab("overview");
    const lines = [`${d.wards[best]} - ${periodText(p).toLowerCase()} (${p.loai === "du_bao" ? "dự báo" : "hiện trạng"}):`];
    ["tvdi", "lst", "ndvi"].forEach((k) => { const v = d[k][best][state.idx]; if (v !== null) lines.push(`${METRICS[k].label}: ${fmtMetric(k, v)}`); });
    if (/du bao|sap toi|tuong lai/.test(t)) {
      d.months.forEach((x, m) => { if (x.loai === "du_bao") lines.push(`${periodText(x)}: TVDI dự báo ${fmt(d.tvdi[best][m])}`); });
    }
    return lines.join("\n");
  }
  // 4. Xếp hạng / cực trị
  const asc = /\b(thap nhat|it nhat|am nhat|mat nhat|it cay|kem nhat)\b/.test(t), desc = /\b(cao nhat|nhieu nhat|kho nhat|nong nhat|xanh nhat|nhieu cay|top)\b/.test(t);
  if (asc || desc || /xep hang/.test(t)) {
    const order = asc ? "asc" : "desc", top = rankIndices(vals, order).slice(0, 5);
    return `Top 5 ${M.label} ${order === "desc" ? "cao" : "thấp"} nhất, ${periodText(p).toLowerCase()}:\n` + top.map((i, r) => `${r + 1}. ${d.wards[i]}: ${fmtMetric(metric, vals[i])}`).join("\n");
  }
  // 5. Đếm theo ngưỡng: "bao nhiêu phường có LST trên 40"
  const num = t.replace(/(\d{1,2})\s*[\/-]\s*20\d\d/, "").match(/(-?\d+(?:[.,]\d+)?)/);
  if (/bao nhieu|so luong|may phuong/.test(t) && num) {
    const a = parseFloat(num[1].replace(",", ".")), lower = /duoi|nho hon|thap hon|<|it hon/.test(t);
    const n = vals.filter((v) => compare(lower ? "lt" : "gt", v, a)).length;
    return `Có ${n}/${vals.length} phường/xã có ${M.label} ${lower ? "dưới" : "trên"} ${fmt(a, M.dec)}${M.unit} (${periodText(p).toLowerCase()}).`;
  }
  // 6. Trung bình / dự báo chung
  if (/du bao|sap toi|tuong lai/.test(t)) {
    const fl = d.months.map((x, m) => [x, m]).filter(([x]) => x.loai === "du_bao");
    if (!fl.length) return "Chưa có dữ liệu dự báo.";
    return "TVDI dự báo trung bình toàn thành phố:\n" + fl.map(([x, m]) => `${periodText(x)}: ${fmt(cityMean(column("tvdi", m)))}`).join("\n");
  }
  if (/trung binh|toan thanh pho|tong quan/.test(t)) return `${M.label} trung bình toàn thành phố, ${periodText(p).toLowerCase()}: ${fmtMetric(metric, cityMean(vals))}.`;
  return "Mình chưa hiểu câu hỏi. Bạn thử hỏi về một phường/xã, về phường/xã cao hoặc thấp nhất, số phường/xã vượt một ngưỡng, hoặc nói \"tháng 5/2026\" để chuyển bản đồ.";
}
function setupChat() {
  const log = $("chat-log");
  const add = (t, who) => { log.append(el("div", { class: "msg " + who, text: t })); log.scrollTop = log.scrollHeight; };
  const ask = (q) => {
    if (!q.trim()) return;
    add(q, "me");
    try { add(state.data ? chatAnswer(q) : "Dữ liệu chưa tải xong.", "bot"); } catch (e) { add("Có lỗi khi trả lời, bạn thử hỏi cách khác.", "bot"); }
  };
  add("Xin chào! Mình trả lời theo quy tắc dựa trên dữ liệu đang hiển thị, chưa phải mô hình ngôn ngữ nên chỉ hiểu một số kiểu câu hỏi.", "bot");
  ["Phường nào khô nhất?", "Bao nhiêu phường có LST trên 38?", "NDVI thấp nhất", "Dự báo các tháng tới"].forEach((c) => {
    const b = el("button", { type: "button", text: c }); b.addEventListener("click", () => ask(c)); $("chat-chips").append(b);
  });
  $("chat-launcher").addEventListener("click", () => { $("chat-panel").hidden = false; $("chat-launcher").hidden = true; $("chat-input").focus(); });
  $("chat-close").addEventListener("click", () => { $("chat-panel").hidden = true; $("chat-launcher").hidden = false; });
  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("chat-input").value; $("chat-input").value = ""; ask(v); });
}

/* =====================================================================
   TAB, NGĂN KÉO VÀ KHỞI ĐỘNG
   ===================================================================== */
const currentTab = () => (document.querySelector(".tabs button[aria-selected='true']") || {}).dataset?.tab;
function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".panel").forEach((p) => { p.hidden = p.dataset.panel !== name; });
  if (name === "model") loadModelTab();
  if (name === "admin") loadAdmin();
}
function openRail(open) {
  $("rail").classList.toggle("open", open);
  $("btn-rail").setAttribute("aria-expanded", String(open));
}

async function loadAll(reload = false) {
  const [geo, data] = await Promise.all([api("/api/geometry"), api("/api/dataset")]);
  if (!data.months.length) throw new Error("CSDL chưa có dữ liệu. Quản trị viên cần nạp dữ liệu.");
  if (!data.est) data.est = data.wards.map(() => data.months.map(() => 0));
  state.geo = geo; state.data = data; state.error = null;
  buildStrip();
  renderForecastSummary();
  let start = reload ? Math.min(state.idx, data.months.length - 1) : -1;
  if (start < 0) { start = data.months.length - 1; for (let i = start; i >= 0; i--) if (data.months[i].loai === "thuc_te") { start = i; break; } }
  ensureLayers();
  goTo(start);
  if (state.ward !== null && state.ward >= data.wards.length) state.ward = null;
}

function bindUI() {
  document.querySelectorAll("#seg-metric button").forEach((b) => b.addEventListener("click", () => setMetric(b.dataset.metric)));
  document.querySelectorAll("#seg-view button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("btn-rail").addEventListener("click", () => openRail(!$("rail").classList.contains("open")));
  $("strip").addEventListener("click", (e) => { const c = e.target.closest(".cell"); if (c) { stopAnim(); goTo(Number(c.dataset.i)); } });
  $("strip").addEventListener("keydown", (e) => {
    if (!state.data) return;
    const last = state.data.months.length - 1;
    const k = { ArrowLeft: state.idx - 1, ArrowRight: state.idx + 1, ArrowDown: state.idx - 1, ArrowUp: state.idx + 1, Home: 0, End: last, PageUp: state.idx - 12, PageDown: state.idx + 12 };
    if (e.key in k) { e.preventDefault(); stopAnim(); goTo(k[e.key]); }
  });
  $("anim-play").addEventListener("click", () => (state.anim.playing ? stopAnim() : startAnim()));
  // xếp hạng & lọc
  document.querySelectorAll("#rank-metric button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#rank-metric button").forEach((x) => x.classList.toggle("on", x === b));
    state.rank.metric = b.dataset.m; state.rank.reverse = false; renderRank();
  }));
  $("rank-reverse").addEventListener("click", () => { state.rank.reverse = !state.rank.reverse; renderRank(); });
  $("rank-search").addEventListener("input", (e) => { state.rank.q = e.target.value; renderRank(); });
  $("f-op").addEventListener("change", () => { $("f-b").hidden = $("f-op").value !== "between"; });
  $("f-apply").addEventListener("click", applyFilter);
  $("f-clear").addEventListener("click", clearFilter);
  // bản đồ chuyên đề: mở bằng nút trên thanh trên cùng, đổi tùy chọn là vẽ lại ngay
  $("btn-theme").addEventListener("click", openTheme);
  $("btn-forecast6").addEventListener("click", playForecast);
  $("th-close").addEventListener("click", () => $("dlg-theme").close());
  $("th-download").addEventListener("click", downloadTheme);
  ["th-metric", "th-period", "th-grid", "th-north", "th-scale", "th-labels"].forEach((id) => $(id).addEventListener("change", redrawTheme));
  let thTimer = null;
  $("th-title").addEventListener("input", () => { clearTimeout(thTimer); thTimer = setTimeout(redrawTheme, 300); });
  // quản trị
  $("btn-admin").addEventListener("click", () => { if (state.token) { showTab("admin"); if (window.innerWidth <= 900) openRail(true); } else $("dlg-login").showModal(); });
  $("login-form").addEventListener("submit", doLogin);
  $("login-cancel").addEventListener("click", () => $("dlg-login").close());
  $("admin-logout").addEventListener("click", () => setAdmin(false));
  $("admin-refresh").addEventListener("click", loadAdmin);
  window.addEventListener("resize", () => state.map && state.map.resize());
}

function showFatal(msg) {
  const hasData = !!state.data;
  state.error = msg; renderNotice();
  if (!hasData) { $("banner-mode").textContent = "KHÔNG CÓ DỮ LIỆU"; $("banner-period").textContent = ""; $("banner").className = "banner"; }
}

async function init() {
  bindUI(); drawLegend(); initMap(); setupChat();
  if (state.token) setAdmin(true);
  try { await loadAll(); } catch (e) { showFatal(e.message); }
}
if (typeof document !== "undefined" && document.getElementById("map")) init();
