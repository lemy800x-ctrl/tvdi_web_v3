// =====================================================================
// BƯỚC 1 - Earth Engine: NDVI, LST (°C), TVDI theo THÁNG cho từng PHƯỜNG/XÃ, 2016 -> 09/2026
//
// Mỗi dòng kết quả = 1 phường/xã x 1 tháng, gồm: ndvi_mean, lst_mean, tvdi_mean,
// so_pixel, so_anh, ty_le_hop_le, trang_thai và các hệ số cạnh khô/cạnh ướt của tháng đó.
//
// "Bỏ ảnh hỏng" làm ngay tại đây:
//   - bỏ cả cảnh ảnh có mây > MAX_CLOUD %, và từng điểm ảnh mây/bóng mây/mặt nước
//   - trang_thai = ANH_IT   : tháng có < MIN_SCENES cảnh ảnh sạch
//                  CANH_LOI : không hồi quy được cạnh khô/cạnh ướt
//                  MAY_NHIEU: phường/xã có < MIN_VALID_RATIO điểm ảnh hợp lệ
//                  OK       : dùng được
//   Các bước sau CHỈ dùng dòng trang_thai = OK để học máy.
//
// Cách dùng: dán vào Code Editor, sửa ASSET, bấm Run, rồi qua tab Tasks bấm Run
// cho 11 task (mỗi năm 1 task).
// =====================================================================

// ---------------- THAM SỐ ----------------
var ASSET = 'projects/sapient-visitor-509702-g8/assets/phuong_xa_167'; // <- sửa cho đúng asset của bạn
var NAME_FIELD = 'fullname';   // tên trường chứa tên phường/xã trong asset
var START_YEAR = 2016;
var END_YEAR = 2026;
var END_MONTH = 9;             // năm cuối chỉ lấy đến hết tháng này (tháng 10/2026 chưa đủ)

var MAX_CLOUD = 60;            // bỏ cảnh ảnh có mây > 60 %
var MIN_SCENES = 2;            // tháng có < 2 cảnh ảnh sạch -> ANH_IT
var MIN_VALID_RATIO = 0.3;     // phường/xã có < 30 % điểm ảnh hợp lệ -> MAY_NHIEU

var N_BINS = 10;               // số khoảng chia NDVI để tìm cạnh khô/ướt
var MIN_PX = 30;               // số điểm ảnh tối thiểu của 1 khoảng NDVI
var EDGE_SCALE = 100;          // độ phân giải (m) khi tìm cạnh khô/ướt
var ZONE_SCALE = 100;          // độ phân giải (m) khi lấy trung bình theo phường/xã
                               // (nếu báo "Computation timed out" thì tăng lên 200)

// ---------------- RANH GIỚI ----------------
var wards = ee.FeatureCollection(ASSET);
var region = wards.geometry();
Map.centerObject(region, 9);
Map.addLayer(wards.style({color: 'red', fillColor: '00000000'}), {}, 'Phường/xã');
print('Số phường/xã:', wards.size());   // phải ra 167

// ---------------- LANDSAT 8 + 9: lọc mây, tính NDVI + LST (°C) ----------------
function prep(img) {
  var qa = img.select('QA_PIXEL');
  // bit 1: viền mây, bit 2: ti (cirrus), bit 3: mây, bit 4: bóng mây
  var clear = qa.bitwiseAnd(30).eq(0);
  // Landsat Collection 2: phải nhân hệ số và trừ 0,2 trước khi tính chỉ số
  var sr = img.select(['SR_B4', 'SR_B5']).multiply(0.0000275).add(-0.2);
  var ndvi = sr.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
  var lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15).rename('LST'); // °C
  var valid = clear.and(lst.gt(-10));
  return ndvi.addBands(lst).updateMask(valid)
             .copyProperties(img, ['system:time_start']);
}

var landsat = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(region)
  .filterDate(START_YEAR + '-01-01', (END_YEAR + 1) + '-01-01')
  .filter(ee.Filter.lt('CLOUD_COVER', MAX_CLOUD))   // bỏ cả cảnh ảnh nhiều mây
  .map(prep);

var EMPTY = ee.Image.constant([0, 0]).rename(['NDVI', 'LST']).selfMask();

function monthlyComposite(year, month) {
  var start = ee.Date.fromYMD(year, month, 1);
  var col = landsat.filterDate(start, start.advance(1, 'month'));
  var comp = ee.Image(ee.Algorithms.If(col.size().gt(0), col.median(), EMPTY));
  comp = comp.updateMask(comp.select('NDVI').gte(0));   // loại mặt nước
  return {img: comp, n: col.size()};
}

// ---------------- CẠNH KHÔ / CẠNH ƯỚT ----------------
function edgeParams(comp) {
  var bin = comp.select('NDVI').multiply(N_BINS).floor()
                .clamp(0, N_BINS - 1).toInt().rename('bin');
  var img = comp.select('LST').addBands(bin);
  var reducer = ee.Reducer.max()
      .combine(ee.Reducer.min(), '', true)
      .combine(ee.Reducer.count(), '', true)
      .group({groupField: 1, groupName: 'bin'});
  var res = ee.Dictionary(img.reduceRegion({
    reducer: reducer, geometry: region, scale: EDGE_SCALE, maxPixels: 1e10, tileScale: 4
  }));
  var groups = ee.List(ee.Algorithms.If(res.contains('groups'), res.get('groups'), []));
  var bins = ee.FeatureCollection(groups.map(function (g) {
    g = ee.Dictionary(g);
    return ee.Feature(null, {
      x: ee.Number(g.get('bin')).add(0.5).divide(N_BINS),
      hi: g.get('max'), lo: g.get('min'), n: g.get('count')
    });
  })).filter(ee.Filter.gte('n', MIN_PX));

  var nOk = bins.size();
  var fitHi = ee.Dictionary(bins.reduceColumns(ee.Reducer.linearFit(), ['x', 'hi']));
  var fitLo = ee.Dictionary(bins.reduceColumns(ee.Reducer.linearFit(), ['x', 'lo']));
  var corHi = ee.Dictionary(bins.reduceColumns(ee.Reducer.pearsonsCorrelation(), ['x', 'hi']));
  var corLo = ee.Dictionary(bins.reduceColumns(ee.Reducer.pearsonsCorrelation(), ['x', 'lo']));

  var good = ee.Dictionary({
    ok: 1, n_bins_used: nOk,
    a_dry: fitHi.get('scale'), b_dry: fitHi.get('offset'),
    r2_dry: ee.Number(corHi.get('correlation')).pow(2),
    a_wet: fitLo.get('scale'), b_wet: fitLo.get('offset'),
    r2_wet: ee.Number(corLo.get('correlation')).pow(2)
  });
  var bad = ee.Dictionary({
    ok: 0, n_bins_used: nOk,
    a_dry: 0, b_dry: 0, r2_dry: -1, a_wet: 0, b_wet: 0, r2_wet: -1
  });
  return ee.Dictionary(ee.Algorithms.If(nOk.gte(3), good, bad));
}

// ---------------- TVDI CHO TỪNG ĐIỂM ẢNH ----------------
function tvdiImage(comp, p) {
  var ndvi = comp.select('NDVI');
  var lst = comp.select('LST');
  var dry = ndvi.multiply(ee.Number(p.get('a_dry'))).add(ee.Number(p.get('b_dry')));
  var wet = ndvi.multiply(ee.Number(p.get('a_wet'))).add(ee.Number(p.get('b_wet')));
  var tvdi = lst.subtract(wet).divide(dry.subtract(wet))
                .updateMask(dry.gt(wet)).clamp(0, 1).rename('TVDI');
  return ee.Image(ee.Algorithms.If(ee.Number(p.get('ok')).eq(1), tvdi, tvdi.updateMask(0)));
}

// ---------------- TỔNG HỢP THEO PHƯỜNG/XÃ CHO 1 THÁNG ----------------
function monthFeatures(year, month) {
  var c = monthlyComposite(year, month);
  var p = edgeParams(c.img);
  var all = c.img.addBands(tvdiImage(c.img, p))
                 .addBands(ee.Image.constant(1).rename('ALL'));
  var stats = all.reduceRegions({
    collection: wards,
    reducer: ee.Reducer.mean().combine(ee.Reducer.count(), '', true),
    scale: ZONE_SCALE, tileScale: 4
  });
  var nScenes = ee.Number(c.n);
  var edgeOk = ee.Number(p.get('ok'));

  return stats.map(function (f) {
    var nValid = ee.Number(ee.Algorithms.If(f.get('TVDI_count'), f.get('TVDI_count'), 0));
    var nAll = ee.Number(ee.Algorithms.If(f.get('ALL_count'), f.get('ALL_count'), 1));
    var ratio = nValid.divide(nAll.max(1));
    var status = ee.String(ee.Algorithms.If(nScenes.lt(MIN_SCENES), 'ANH_IT',
                   ee.Algorithms.If(edgeOk.neq(1), 'CANH_LOI',
                     ee.Algorithms.If(ratio.lt(MIN_VALID_RATIO), 'MAY_NHIEU', 'OK'))));
    return ee.Feature(null, {
      fullname: f.get(NAME_FIELD), nam: year, thang: month,
      ndvi_mean: f.get('NDVI_mean'), lst_mean: f.get('LST_mean'), tvdi_mean: f.get('TVDI_mean'),
      so_pixel: nValid, so_anh: nScenes, ty_le_hop_le: ratio, trang_thai: status,
      so_bin: p.get('n_bins_used'),
      a_dry: p.get('a_dry'), b_dry: p.get('b_dry'), r2_dry: p.get('r2_dry'),
      a_wet: p.get('a_wet'), b_wet: p.get('b_wet'), r2_wet: p.get('r2_wet')
    });
  });
}

// ---------------- XUẤT: mỗi năm 1 task = 1 file CSV ----------------
var COLUMNS = ['fullname', 'nam', 'thang', 'ndvi_mean', 'lst_mean', 'tvdi_mean',
               'so_pixel', 'so_anh', 'ty_le_hop_le', 'trang_thai',
               'so_bin', 'a_dry', 'b_dry', 'r2_dry', 'a_wet', 'b_wet', 'r2_wet'];

for (var y = START_YEAR; y <= END_YEAR; y++) {
  var lastMonth = (y === END_YEAR) ? END_MONTH : 12;
  var yearFC = monthFeatures(y, 1);
  for (var m = 2; m <= lastMonth; m++) {
    yearFC = yearFC.merge(monthFeatures(y, m));
  }
  Export.table.toDrive({
    collection: yearFC,
    description: 'TVDI_phuongxa_v2_' + y,
    folder: 'TVDI_PhuongXa_v2',
    fileNamePrefix: 'TVDI_phuongxa_' + y,
    fileFormat: 'CSV',
    selectors: COLUMNS
  });
}

// ---------------- XEM THỬ 1 THÁNG TRÊN BẢN ĐỒ (không tốn task) ----------------
var test = monthlyComposite(2026, 3);
var pTest = edgeParams(test.img);
print('Cạnh khô/ướt tháng 3/2026:', pTest, 'Số cảnh ảnh sạch:', test.n);
Map.addLayer(tvdiImage(test.img, pTest).clip(region),
  {min: 0, max: 1, palette: ['#066b00', '#0bc400', '#0ce100', '#00ff00', '#ffff00', '#ffcc00', '#ff6600', '#ff0000']},
  'TVDI 03/2026');
Map.addLayer(test.img.select('LST').clip(region),
  {min: 20, max: 45, palette: ['#0000FF', '#0066FF', '#00FFFF', '#00FF00', '#FFFF00', '#FFCC00', '#FF6600', '#FF0000']},
  'LST 03/2026 (°C)', false);
Map.addLayer(test.img.select('NDVI').clip(region),
  {min: -0.2, max: 1, palette: ['#FF0000', '#FF7F00', '#FFFF00', '#ADFF2F', '#00FF00', '#00FFFF', '#007FFF', '#0000FF']},
  'NDVI 03/2026', false);
