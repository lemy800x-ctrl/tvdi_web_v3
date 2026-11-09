"""
Nạp dữ liệu vào PostgreSQL. Dùng chung cho backend (trang Quản trị) và script dòng lệnh.
Các hàm prepare_* là hàm thuần (không cần database) nên kiểm thử được.
"""
import csv
import io
import math
from typing import Dict, List, Optional

LOAI_HOP_LE = ("thuc_te", "du_bao", "kiem_chung")


# ---------------- Đọc CSV ----------------
def parse_csv(text: str) -> List[Dict[str, str]]:
    text = text.lstrip("\ufeff")
    rd = csv.DictReader(io.StringIO(text))
    rows = []
    for r in rd:
        rows.append({(k or "").strip().lower(): (v.strip() if isinstance(v, str) else v) for k, v in r.items()})
    return rows


def to_float(v) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in ("", "nan", "none", "null", "-"):
        return None
    try:
        f = float(s.replace(",", ".")) if s.count(",") == 1 and "." not in s else float(s)
    except ValueError:
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def to_int(v) -> Optional[int]:
    f = to_float(v)
    return None if f is None else int(round(f))


def need(rows: List[dict], cols: List[str]):
    if not rows:
        raise ValueError("File rỗng hoặc không đọc được dòng nào.")
    thieu = [c for c in cols if c not in rows[0]]
    if thieu:
        raise ValueError(f"Thiếu cột {thieu}. Các cột có trong file: {list(rows[0].keys())}")


# ---------------- Chuẩn bị dữ liệu từng loại ----------------
def prepare_thuc_te(rows: List[dict]):
    """
    File hiện trạng -> các dòng loai='thuc_te'. Hai dạng file:
      - tvdi_phuong_xa_hienthi.csv (có cột nguon): quan_trac | noi_suy | khi_hau | khong_co. Giá trị ước lượng được
        giữ lại để web không bị khuyết, nhưng đánh dấu trang_thai = NOI_SUY / KHI_HAU.
      - tvdi_phuong_xa_full.csv (có cột trang_thai): dòng không đạt chất lượng bị bỏ giá trị (NULL).
    """
    need(rows, ["fullname", "nam", "thang", "tvdi"])
    has_src = "nguon" in rows[0]
    if not has_src:
        need(rows, ["trang_thai"])
    nguon_to_status = {"quan_trac": "OK", "noi_suy": "NOI_SUY", "khi_hau": "KHI_HAU", "khong_co": "KHONG_CO"}
    out = []
    for r in rows:
        nam, thang = to_int(r["nam"]), to_int(r["thang"])
        if nam is None or thang is None or not r["fullname"]:
            continue
        if has_src:
            status = nguon_to_status.get((r.get("nguon") or "").lower(), "KHONG_CO")
            keep = status != "KHONG_CO"
        else:
            status = r["trang_thai"] or "OK"
            keep = status.upper() == "OK"
        tvdi, lst, ndvi = (to_float(r.get(k)) if keep else None for k in ("tvdi", "lst", "ndvi"))
        out.append((r["fullname"], nam, thang, "thuc_te", tvdi, lst, ndvi,
                    to_int(r.get("so_anh")), to_int(r.get("so_pixel")), status))
    return out


def prepare_forecast(rows: List[dict]):
    """du_bao_phuong_xa.csv -> loai 'du_bao' hoặc 'kiem_chung'."""
    need(rows, ["fullname", "nam", "thang", "tvdi_du_bao"])
    out = []
    for r in rows:
        loai = (r.get("loai") or "du_bao").lower()
        if loai not in ("du_bao", "kiem_chung"):
            raise ValueError(f"Giá trị loai không hợp lệ: {loai}")
        v = to_float(r["tvdi_du_bao"])
        nam, thang = to_int(r["nam"]), to_int(r["thang"])
        if v is None or nam is None or thang is None:
            continue
        out.append((r["fullname"], nam, thang, loai, min(max(v, 0.0), 1.0), None, None, None, None,
                    (r.get("mo_hinh") or "")[:60] or "OK"))   # với dòng dự báo, cột trang_thai lưu tên mô hình
    return out


def prepare_models(rows: List[dict]):
    need(rows, ["mo_hinh", "mae", "rmse", "r2", "mape"])
    return [(r["mo_hinh"], to_float(r["mae"]), to_float(r["rmse"]), to_float(r["r2"]), to_float(r["mape"]),
             to_float(r.get("so_voi_khi_hau"))) for r in rows if r["mo_hinh"]]


def prepare_edge(rows: List[dict]):
    need(rows, ["nam", "thang", "a_dry", "b_dry", "a_wet", "b_wet"])
    return [(to_int(r["nam"]), to_int(r["thang"]), to_float(r["a_dry"]), to_float(r["b_dry"]),
             to_float(r.get("r2_dry")), to_float(r["a_wet"]), to_float(r["b_wet"]), to_float(r.get("r2_wet")),
             to_int(r.get("so_bin") or r.get("n_bins_used")), to_int(r.get("so_anh"))) for r in rows]


def prepare_verify(rows: List[dict]):
    need(rows, ["thang_du_bao", "n", "mae_mo_hinh", "rmse_mo_hinh", "mae_khi_hau", "rmse_khi_hau"])
    return [(to_int(r["thang_du_bao"]), to_int(r["n"]), to_float(r["mae_mo_hinh"]), to_float(r["rmse_mo_hinh"]),
             to_float(r["mae_khi_hau"]), to_float(r["rmse_khi_hau"])) for r in rows]


# ---------------- Ghi vào PostgreSQL ----------------
SCHEMA_SQL = [
    """CREATE TABLE IF NOT EXISTS tvdi_by_ward (
         ward_code VARCHAR(255) NOT NULL, nam SMALLINT NOT NULL, thang SMALLINT NOT NULL,
         loai VARCHAR(12) NOT NULL, tvdi_mean REAL, tvdi_min REAL, tvdi_max REAL, n_cells INTEGER)""",
    "ALTER TABLE tvdi_by_ward ALTER COLUMN ward_code TYPE VARCHAR(255)",
    "ALTER TABLE tvdi_by_ward DROP CONSTRAINT IF EXISTS tvdi_by_ward_loai_check",
    "ALTER TABLE tvdi_by_ward DROP CONSTRAINT IF EXISTS tvdi_by_ward_ward_code_fkey",
    "ALTER TABLE tvdi_by_ward ADD COLUMN IF NOT EXISTS lst_mean REAL",
    "ALTER TABLE tvdi_by_ward ADD COLUMN IF NOT EXISTS ndvi_mean REAL",
    "ALTER TABLE tvdi_by_ward ADD COLUMN IF NOT EXISTS so_anh INTEGER",
    "ALTER TABLE tvdi_by_ward ADD COLUMN IF NOT EXISTS so_pixel INTEGER",
    "ALTER TABLE tvdi_by_ward ADD COLUMN IF NOT EXISTS trang_thai VARCHAR(60)",
    "ALTER TABLE tvdi_by_ward ALTER COLUMN trang_thai TYPE VARCHAR(60)",
    "CREATE INDEX IF NOT EXISTS by_ward_period ON tvdi_by_ward (nam, thang, loai)",
    """CREATE TABLE IF NOT EXISTS model_evaluation (
         mo_hinh VARCHAR(80) PRIMARY KEY, mae DOUBLE PRECISION, rmse DOUBLE PRECISION,
         r2 DOUBLE PRECISION, mape DOUBLE PRECISION)""",
    "ALTER TABLE model_evaluation ADD COLUMN IF NOT EXISTS so_voi_khi_hau DOUBLE PRECISION",
    """CREATE TABLE IF NOT EXISTS tvdi_edge_params (
         nam SMALLINT NOT NULL, thang SMALLINT NOT NULL, a_dry DOUBLE PRECISION, b_dry DOUBLE PRECISION,
         r2_dry DOUBLE PRECISION, a_wet DOUBLE PRECISION, b_wet DOUBLE PRECISION, r2_wet DOUBLE PRECISION,
         n_bins_used INTEGER)""",
    "ALTER TABLE tvdi_edge_params ADD COLUMN IF NOT EXISTS so_anh INTEGER",
    """CREATE TABLE IF NOT EXISTS kiem_chung_tom_tat (
         thang_du_bao INTEGER PRIMARY KEY, n INTEGER, mae_mo_hinh DOUBLE PRECISION, rmse_mo_hinh DOUBLE PRECISION,
         mae_khi_hau DOUBLE PRECISION, rmse_khi_hau DOUBLE PRECISION)""",
]


def ensure_schema(cur):
    for sql in SCHEMA_SQL:
        cur.execute(sql)


def _insert(cur, sql, rows, page=2000):
    from psycopg2.extras import execute_values
    for i in range(0, len(rows), page):
        execute_values(cur, sql, rows[i:i + page])


BY_WARD_COLS = ("ward_code, nam, thang, loai, tvdi_mean, lst_mean, ndvi_mean, so_anh, so_pixel, trang_thai")


def save_thuc_te(cur, rows):
    cur.execute("DELETE FROM tvdi_by_ward WHERE loai = 'thuc_te'")
    _insert(cur, f"INSERT INTO tvdi_by_ward ({BY_WARD_COLS}) VALUES %s", rows)
    return len(rows)


def save_forecast(cur, rows):
    cur.execute("DELETE FROM tvdi_by_ward WHERE loai IN ('du_bao', 'kiem_chung')")
    _insert(cur, f"INSERT INTO tvdi_by_ward ({BY_WARD_COLS}) VALUES %s", rows)
    return len(rows)


def save_models(cur, rows):
    cur.execute("DELETE FROM model_evaluation")
    _insert(cur, "INSERT INTO model_evaluation (mo_hinh, mae, rmse, r2, mape, so_voi_khi_hau) VALUES %s", rows)
    return len(rows)


def save_edge(cur, rows):
    cur.execute("DELETE FROM tvdi_edge_params")
    _insert(cur, "INSERT INTO tvdi_edge_params (nam, thang, a_dry, b_dry, r2_dry, a_wet, b_wet, r2_wet, "
                 "n_bins_used, so_anh) VALUES %s", rows)
    return len(rows)


def save_verify(cur, rows):
    cur.execute("DELETE FROM kiem_chung_tom_tat")
    _insert(cur, "INSERT INTO kiem_chung_tom_tat (thang_du_bao, n, mae_mo_hinh, rmse_mo_hinh, mae_khi_hau, "
                 "rmse_khi_hau) VALUES %s", rows)
    return len(rows)


# kind (dùng trong URL và trong script) -> (hàm chuẩn bị, hàm ghi)
KINDS = {
    "thuc-te": (prepare_thuc_te, save_thuc_te),
    "du-bao": (prepare_forecast, save_forecast),
    "mo-hinh": (prepare_models, save_models),
    "canh-kho-uot": (prepare_edge, save_edge),
    "kiem-chung": (prepare_verify, save_verify),
}


def load_text(cur, kind: str, text: str) -> int:
    if kind not in KINDS:
        raise ValueError(f"Loại dữ liệu không hợp lệ: {kind}")
    prepare, save = KINDS[kind]
    rows = prepare(parse_csv(text))
    if not rows:
        raise ValueError("Không có dòng hợp lệ nào để nạp.")
    ensure_schema(cur)
    return save(cur, rows)
