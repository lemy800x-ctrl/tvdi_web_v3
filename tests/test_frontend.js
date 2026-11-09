// Kiểm thử logic giao diện (chạy bằng: node tests/test_frontend.js). Không cần trình duyệt.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
let src = fs.readFileSync(__dirname + "/../frontend/app.js", "utf8").replace(/\nif \(typeof document !== "undefined"[^\n]*\n?$/, "\n");

// DOM giả: mọi thuộc tính/phương thức đều "chạy được" và không làm gì
const dummy = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "children" ? [] : k === "length" ? 0 : dummy), apply: () => dummy, set: () => true });
const ctx = { document: { getElementById: () => dummy, querySelector: () => dummy, querySelectorAll: () => [], createElement: () => dummy },
  window: { innerWidth: 1400 }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, console, Math, Number, Infinity, Object, String, JSON, Array, Set };
vm.createContext(ctx);
vm.runInContext(src + "\n;this.T = {colorFor,fmt,fmtMetric,norm,cleanName,niceStep,makeClasses,classIndex,compare,rankIndices,cityMean,normHeight,bboxOfFeatures,makeProjection,graticuleStep,toDMS,niceScaleKm,state,chatAnswer,drawThematic,METRICS,TVDI_CLASSES,opText,themeTitle,wrapLines};", ctx);
const T = ctx.T;
const J = (x) => JSON.stringify(x);
const eq = (a, b) => assert.strictEqual(J(Array.isArray(a) || (a && a.length !== undefined) ? Array.from(a) : a), J(b));

// ---- Màu theo đúng thang màu trong tài liệu của nhóm ----
assert.strictEqual(T.colorFor("tvdi", 0), "rgb(6, 107, 0)");        // #066b00
assert.strictEqual(T.colorFor("tvdi", 1), "rgb(255, 0, 0)");        // #ff0000
assert.strictEqual(T.colorFor("lst", 20), "rgb(0, 0, 255)");        // #0000FF
assert.strictEqual(T.colorFor("lst", 45), "rgb(255, 0, 0)");
assert.strictEqual(T.colorFor("ndvi", -0.2), "rgb(255, 0, 0)");     // NDVI thấp = đỏ
assert.strictEqual(T.colorFor("ndvi", 1), "rgb(0, 0, 255)");
assert.strictEqual(T.colorFor("tvdi", null), "#cfd8d3");
assert.strictEqual(T.colorFor("tvdi", 9), T.colorFor("tvdi", 1));
console.log("màu OK");

// ---- Chuẩn hóa tên / định dạng ----
assert.strictEqual(T.norm("  Phường  Bến Nghé "), "phuong ben nghe");
assert.strictEqual(T.cleanName("Xã Đất Đỏ"), "dat do");
assert.strictEqual(T.cleanName("Đặc khu Côn Đảo"), "con dao");
assert.strictEqual(T.fmt(0.5234), "0,52");
assert.strictEqual(T.fmtMetric("lst", 38.46), "38,5 °C");
assert.strictEqual(T.fmtMetric("tvdi", null), "-");

// ---- Chia lớp ----
const tv = T.makeClasses("tvdi", []);
assert.strictEqual(tv.length, 5);
eq([0, 0.19, 0.2, 0.59, 0.6, 0.79, 0.8, 1, 1.3].map((v) => T.classIndex(tv, v)), [0, 0, 1, 2, 3, 3, 4, 4, 4]);
assert.strictEqual(T.classIndex(tv, null), -1);
const lc = T.makeClasses("lst", [30.2, 33.8, 36.1, 41.7, 44.4, null]);
assert(lc.length >= 3 && lc.length <= 8, "số lớp LST: " + lc.length);
assert(lc[0].lo <= 30.2 && lc[lc.length - 1].hi >= 44.4, "lớp phải phủ hết khoảng giá trị");
assert.strictEqual(T.classIndex(lc, 44.4) >= 0, true);
eq(T.makeClasses("ndvi", [null, null]), []);
console.log("chia lớp OK:", lc.map((c) => c.label).join(" | "));

// ---- Lọc theo ngưỡng (ví dụ cô nêu: LST > 40) ----
const lst = [38, 41.5, 40, null, 43, 39.9];
const ids = (op, a, b) => lst.map((v, i) => (T.compare(op, v, a, b) ? i : -1)).filter((i) => i >= 0);
eq(ids("gt", 40), [1, 4]);          // 40 không lớn hơn 40
eq(ids("ge", 40), [1, 2, 4]);
eq(ids("lt", 40), [0, 5]);
eq(ids("le", 40), [0, 2, 5]);
eq(ids("between", 43, 39.9), [1, 2, 4, 5]);   // khoảng [39,9 ; 43], đảo đầu cuối vẫn đúng
eq(ids("between", 39.9, 43), [1, 2, 4, 5]);
assert.strictEqual(T.compare("gt", null, 1), false);
console.log("lọc ngưỡng OK");

// ---- Xếp hạng: LST cao->thấp, NDVI thấp->cao, TVDI cao->thấp (bỏ ô trống) ----
const v = [0.5, null, 0.9, 0.1, 0.5];
eq(T.rankIndices(v, "desc"), [2, 0, 4, 3]);
eq(T.rankIndices(v, "asc"), [3, 0, 4, 2]);
assert.strictEqual(T.METRICS.lst.rank, "desc"); assert.strictEqual(T.METRICS.ndvi.rank, "asc"); assert.strictEqual(T.METRICS.tvdi.rank, "desc");
assert.strictEqual(T.cityMean([1, null, 3]), 2); assert.strictEqual(T.cityMean([null]), null);
assert.strictEqual(T.normHeight("tvdi", 0.5), 0.5); assert.strictEqual(T.normHeight("lst", 32.5), 0.5);
console.log("xếp hạng OK");

// ---- Bản đồ chuyên đề: phép chiếu, lưới tọa độ, thước tỷ lệ ----
const feats = [
  { type: "Feature", geometry: { type: "Polygon", coordinates: [[[106.4, 10.4], [107.2, 10.4], [107.2, 11.2], [106.4, 11.2], [106.4, 10.4]]] }, properties: {} },
  { type: "Feature", geometry: { type: "MultiPolygon", coordinates: [[[[106.9, 10.5], [107.0, 10.5], [107.0, 10.6], [106.9, 10.5]]]] }, properties: {} },
];
const bb = T.bboxOfFeatures(feats);
eq(Array.from(bb), [106.4, 10.4, 107.2, 11.2]);
const pr = T.makeProjection(bb, { x: 100, y: 100, w: 1000, h: 800 });
const [x0, y0] = pr.fn(106.4, 11.2), [x1, y1] = pr.fn(107.2, 10.4);
assert(x1 > x0 && y1 > y0, "Bắc phải ở trên, Đông phải ở bên phải");
assert(x0 >= 100 - 1e-6 && y0 >= 100 - 1e-6 && x1 <= 1100 + 1e-6 && y1 <= 900 + 1e-6, "vẽ trong khung");
const kx = Math.cos(10.8 * Math.PI / 180);
assert(Math.abs((x1 - x0) / (y1 - y0) - (0.8 * kx) / 0.8) < 1e-6, "giữ đúng tỷ lệ ngang/dọc theo vĩ độ");
assert(pr.metersPerPx > 0);
assert.strictEqual(T.graticuleStep(0.8), 0.2);
assert.strictEqual(T.toDMS(106.75, false), "106°45′Đ"); assert.strictEqual(T.toDMS(10.5, true), "10°30′B");
assert.strictEqual(T.toDMS(106.9999, false), "107°00′Đ");
assert.strictEqual(T.niceScaleKm(37), 25); assert.strictEqual(T.niceScaleKm(120), 100);
console.log("phép chiếu/lưới/thước tỷ lệ OK");

// ---- Tên bản đồ chuyên đề theo tháng/năm người dùng chọn ----
assert.strictEqual(T.themeTitle("tvdi", { nam: 2026, thang: 9, loai: "thuc_te" }),
  "Bản đồ hiện trạng hạn hán (TVDI) TP.HCM sau sáp nhập (trừ đặc khu Côn Đảo) tháng 9 năm 2026");
assert.strictEqual(T.themeTitle("tvdi", { nam: 2027, thang: 1, loai: "du_bao" }),
  "Bản đồ dự báo hạn hán (TVDI) TP.HCM sau sáp nhập (trừ đặc khu Côn Đảo) tháng 1 năm 2027");
assert(T.themeTitle("lst", { nam: 2025, thang: 5, loai: "thuc_te" }).includes("nhiệt độ bề mặt (LST)"));
const wrapped = T.wrapLines("một hai ba bốn năm sáu bảy tám chín mười", 100, (t) => t.length * 10);
assert(wrapped.length > 1 && wrapped.every((l) => l.length * 10 <= 100), J(wrapped));
assert.strictEqual(Array.from(wrapped).join(" "), "một hai ba bốn năm sáu bảy tám chín mười");
assert.strictEqual(T.wrapLines("rấtdàirấtdàirấtdài", 50, (t) => t.length * 10).length, 1);   // từ quá dài không bị mất
assert.strictEqual(T.wrapLines("", 100, (t) => t.length).length, 0);
console.log("tên bản đồ + ngắt dòng OK");

// ---- Vẽ bản đồ chuyên đề không phát sinh lỗi (canvas giả ghi lại lệnh vẽ) ----
const calls = [];
const g2d = new Proxy({ measureText: (t) => ({ width: String(t).length * 18 }) }, { get: (t, k) => (k in t ? t[k] : (...a) => { calls.push(String(k)); }), set: (t, k, val) => { t[k] = val; return true; } });
const canvas = { width: 0, height: 0, getContext: () => g2d };
const values = [0.35, null];
T.drawThematic(canvas, { geo: { features: feats }, values, est: [1, 0], metricKey: "tvdi", classes: T.makeClasses("tvdi", values), title: T.themeTitle("tvdi", { nam: 2026, thang: 9, loai: "thuc_te" }),
  subtitle: "Phụ đề", modelNote: "Mô hình: X", grid: true, north: true, scale: true, labels: true });
assert.strictEqual(canvas.width, 1754); assert.strictEqual(canvas.height, 1240);
for (const need of ["fill", "stroke", "fillText", "strokeRect", "arc", "clip"]) assert(calls.includes(need), "thiếu lệnh vẽ " + need);
const nClip = calls.filter((c) => c === "clip").length;
T.drawThematic(canvas, { geo: { features: feats }, values: [31, 38], est: [0, 0], metricKey: "lst", classes: T.makeClasses("lst", [31, 38]), title: "t", subtitle: "s", grid: false, north: false, scale: false, labels: false });
T.drawThematic(canvas, { geo: { features: feats }, values: [0.5, 0.6], metricKey: "tvdi", classes: T.makeClasses("tvdi", []), title: "t", subtitle: "s" });  // không có est
console.log("vẽ bản đồ chuyên đề OK (", calls.length, "lệnh vẽ, gạch chéo ô ước lượng:", nClip > 2 ? "có" : "không", ")");

// ---- Trợ lý hỏi đáp ----
const months = []; for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (y < 2026 || m <= 12) months.push({ nam: y, thang: m, loai: (y === 2026 && m >= 10) ? "du_bao" : "thuc_te" });
const wards = ["Phường Bến Nghé", "Xã Đất Đỏ", "Phường An Đông", "Xã Bình Khánh"];
const mk = (f) => wards.map((w, i) => months.map((p, m) => f(i, m, p)));
T.state.data = { months, wards, tvdi: mk((i, m) => 0.3 + 0.1 * i), lst: mk((i, m, p) => (p.loai === "du_bao" ? null : 34 + 2 * i)), ndvi: mk((i, m, p) => (p.loai === "du_bao" ? null : 0.6 - 0.1 * i)),
  est: mk(() => 0), verify: { months: [], tvdi: [] } };
T.state.idx = 5; T.state.metric = "tvdi";
let jumped = null; ctx.goTo = (j) => { jumped = j; T.state.idx = j; }; ctx.selectWard = () => {}; ctx.showTab = () => {}; ctx.stopAnim = () => {};
const Q = (q) => T.chatAnswer(q);
let a = Q("Phường nào khô nhất?"); assert(a.includes("1. Xã Bình Khánh") && a.includes("0,60"), a);
a = Q("NDVI thấp nhất"); assert(a.includes("1. Xã Bình Khánh") && a.includes("0,30"), a);
a = Q("Bao nhiêu phường có LST trên 37?"); assert(a.startsWith("Có 2/4"), a);          // 38 và 40
a = Q("bao nhiêu phường có lst dưới 36"); assert(a.startsWith("Có 1/4"), a);
a = Q("Xã Đất Đỏ thế nào?"); assert(a.includes("Xã Đất Đỏ") && a.includes("TVDI: 0,40") && a.includes("LST: 36,0 °C"), a);
a = Q("Dự báo các tháng tới"); assert(a.includes("Tháng 10/2026") && a.includes("0,45"), a);
a = Q("cho xem tháng 3/2026"); assert.strictEqual(jumped, 14); assert(a.includes("tháng 3/2026"), a);
a = Q("tháng 12/2030"); assert(a.includes("Chưa có dữ liệu"), a);
a = Q("trung bình toàn thành phố"); assert(a.includes("0,45"), a);
a = Q("xyz abc"); assert(a.includes("chưa hiểu"), a);
T.state.idx = 22;   // tháng dự báo: chỉ có TVDI
a = Q("LST cao nhất"); assert(a.includes("chưa có dữ liệu LST"), a);
console.log("trợ lý hỏi đáp OK");
console.log("\nTẤT CẢ KIỂM THỬ GIAO DIỆN ĐẠT");
