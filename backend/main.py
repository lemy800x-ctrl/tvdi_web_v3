"""
Backend web TVDI TP.HCM (FastAPI + PostgreSQL/PostGIS).

Nguyên tắc: KHÔNG tự bịa số liệu. Thiếu dữ liệu hoặc lỗi CSDL thì trả lỗi rõ ràng, không điền giá trị giả.
Người dùng thường chỉ XEM. Mọi thao tác nạp/sửa dữ liệu nằm dưới /api/admin và cần đăng nhập quản trị.

Chạy:   uvicorn backend.main:app --host 0.0.0.0 --port $PORT      (từ thư mục gốc dự án)
Biến môi trường (đặt trong .env hoặc trên Render, KHÔNG đưa lên GitHub/Drive):
    DATABASE_URL    chuỗi kết nối PostgreSQL
    ADMIN_PASSWORD  mật khẩu quản trị (không đặt thì chức năng quản trị bị tắt)
    SECRET_KEY      chuỗi ngẫu nhiên dài để ký phiên đăng nhập
    WARD_TABLE      (tùy chọn) bảng ranh giới, mặc định phuong_xa_full
"""
import hmac
import json
import os
import secrets
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from starlette.middleware.gzip import GZipMiddleware

try:
    from backend import helpers, loader
except ImportError:                      # chạy trực tiếp trong thư mục backend
    import helpers, loader               # type: ignore

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)   # không đặt thì phiên đăng nhập mất khi khởi động lại
WARD_TABLE = os.getenv("WARD_TABLE", "phuong_xa_full")
TOKEN_TTL = 8 * 3600
MAX_UPLOAD = 30 * 1024 * 1024

app = FastAPI(title="TVDI TP.HCM", docs_url=None, redoc_url=None, openapi_url=None)   # ẩn tài liệu API công khai
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    return resp


# ---------------------------------------------------------------- Database
_pool: Optional[ThreadedConnectionPool] = None
_geom_cache: Optional[list] = None
_data_cache: Optional[dict] = None


def get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise HTTPException(503, "Chưa cấu hình DATABASE_URL.")
        try:
            _pool = ThreadedConnectionPool(1, 6, DATABASE_URL)
        except psycopg2.Error:
            raise HTTPException(503, "Không kết nối được cơ sở dữ liệu.")
    return _pool


@contextmanager
def cursor(commit: bool = False):
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
        if commit:
            conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except psycopg2.Error as e:
        conn.rollback()
        raise HTTPException(503, f"Lỗi cơ sở dữ liệu: {e.__class__.__name__}")
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def clear_cache():
    global _geom_cache, _data_cache
    _geom_cache = None
    _data_cache = None


# ---------------------------------------------------------------- Ranh giới
NAME_CANDIDATES = ("fullname", "full_name", "ward_name", "ten_phuong_xa", "ten_px", "name", "ten")


def get_geometry() -> list:
    """Danh sách phường/xã theo thứ tự cố định: [{name, area_km2, geometry}]."""
    global _geom_cache
    if _geom_cache is not None:
        return _geom_cache
    with cursor() as cur:
        cur.execute("SELECT column_name, udt_name FROM information_schema.columns "
                    "WHERE table_name = %s AND table_schema = current_schema()", (WARD_TABLE,))
        cols = cur.fetchall()
        if not cols:
            raise HTTPException(503, f"Không thấy bảng ranh giới '{WARD_TABLE}'.")
        geom_col = next((c["column_name"] for c in cols if c["udt_name"] == "geometry"), None)
        by_lower = {c["column_name"].lower(): c["column_name"] for c in cols}
        name_col = next((by_lower[n] for n in NAME_CANDIDATES if n in by_lower), None)
        if not geom_col or not name_col:
            raise HTTPException(503, f"Bảng '{WARD_TABLE}' thiếu cột hình học hoặc cột tên phường/xã.")
        g, n, t = sql.Identifier(geom_col), sql.Identifier(name_col), sql.Identifier(WARD_TABLE)
        cur.execute(sql.SQL("""
            WITH x AS (SELECT {n} AS name,
                       CASE WHEN ST_SRID({g}) = 0 THEN ST_SetSRID({g}, 4326) ELSE ST_Transform({g}, 4326) END AS geom
                       FROM {t})
            SELECT name, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0004), 4) AS g,
                   ST_Area(geom::geography) / 1e6 AS area
            FROM x WHERE geom IS NOT NULL ORDER BY name
        """).format(n=n, g=g, t=t))
        _geom_cache = [{"name": r["name"], "area_km2": round(float(r["area"]), 2),
                        "geometry": json.loads(r["g"])} for r in cur.fetchall()]
    if not _geom_cache:
        raise HTTPException(503, "Bảng ranh giới đang trống.")
    return _geom_cache


@app.get("/api/geometry")
def geometry():
    geoms = get_geometry()
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": i, "geometry": g["geometry"],
         "properties": {"idx": i, "name": g["name"], "area_km2": g["area_km2"]}}
        for i, g in enumerate(geoms)]}


# ---------------------------------------------------------------- Bộ dữ liệu cho bản đồ
def build_dataset() -> dict:
    geoms = get_geometry()
    find = helpers.build_lookup([g["name"] for g in geoms])
    n = len(geoms)
    with cursor() as cur:
        cur.execute("SELECT ward_code, nam, thang, loai, tvdi_mean, lst_mean, ndvi_mean, trang_thai FROM tvdi_by_ward "
                    "WHERE loai IN ('thuc_te', 'du_bao', 'kiem_chung')")
        rows = cur.fetchall()
        cur.execute("SELECT DISTINCT trang_thai FROM tvdi_by_ward WHERE loai = 'du_bao' AND trang_thai IS NOT NULL")
        models = [r["trang_thai"] for r in cur.fetchall() if r["trang_thai"] != "OK"]
    if not rows:
        raise HTTPException(503, "CSDL chưa có dữ liệu. Quản trị viên cần nạp dữ liệu.")

    # Mỗi tháng là 'thuc_te' nếu có ảnh thật, ngược lại là 'du_bao'. Không suy từ năm.
    month_loai = {}
    for r in rows:
        k = (r["nam"], r["thang"])
        if r["loai"] == "thuc_te" or (r["loai"] == "du_bao" and k not in month_loai):
            month_loai[k] = r["loai"]
    months = sorted(month_loai)
    midx = {k: i for i, k in enumerate(months)}
    v_months = sorted({(r["nam"], r["thang"]) for r in rows if r["loai"] == "kiem_chung"})
    vidx = {k: i for i, k in enumerate(v_months)}

    tvdi = [[None] * len(months) for _ in range(n)]
    lst = [[None] * len(months) for _ in range(n)]
    ndvi = [[None] * len(months) for _ in range(n)]
    ver = [[None] * len(v_months) for _ in range(n)]
    est = [[0] * len(months) for _ in range(n)]        # 0 = ảnh thật, 1 = nội suy, 2 = trung bình nhiều năm
    lost = set()
    for r in rows:
        w = find(r["ward_code"])
        if w is None:
            lost.add(r["ward_code"])
            continue
        k = (r["nam"], r["thang"])
        if r["loai"] == "kiem_chung":
            ver[w][vidx[k]] = helpers.round_or_none(r["tvdi_mean"], 4)
        elif r["loai"] == month_loai.get(k) and k in midx:
            i = midx[k]
            tvdi[w][i] = helpers.round_or_none(r["tvdi_mean"], 4)
            lst[w][i] = helpers.round_or_none(r["lst_mean"], 2)
            ndvi[w][i] = helpers.round_or_none(r["ndvi_mean"], 4)
            if r["loai"] == "thuc_te":
                est[w][i] = {"NOI_SUY": 1, "KHI_HAU": 2}.get(r["trang_thai"], 0)
    return {
        "months": [{"nam": a, "thang": b, "loai": month_loai[(a, b)]} for a, b in months],
        "wards": [g["name"] for g in geoms],
        "tvdi": tvdi, "lst": lst, "ndvi": ndvi, "est": est,
        "verify": {"months": [{"nam": a, "thang": b} for a, b in v_months], "tvdi": ver},
        "forecast_model": ", ".join(sorted(models)) or None,
        "unmatched": sorted(lost)[:20], "unmatched_count": len(lost),
    }


def get_dataset() -> dict:
    global _data_cache
    if _data_cache is None:
        _data_cache = build_dataset()
    return _data_cache


@app.get("/api/dataset")
def dataset():
    d = get_dataset()
    return {k: v for k, v in d.items() if k not in ("unmatched", "unmatched_count")}


@app.get("/api/models")
def models():
    with cursor() as cur:
        cur.execute("SELECT mo_hinh, mae, rmse, r2, mape, so_voi_khi_hau FROM model_evaluation ORDER BY rmse")
        return cur.fetchall()


@app.get("/api/verify")
def verify():
    with cursor() as cur:
        cur.execute("SELECT thang_du_bao, n, mae_mo_hinh, rmse_mo_hinh, mae_khi_hau, rmse_khi_hau "
                    "FROM kiem_chung_tom_tat ORDER BY thang_du_bao")
        return cur.fetchall()


@app.get("/api/edge-r2")
def edge_r2():
    with cursor() as cur:
        cur.execute("SELECT thang, AVG(r2_dry)::float AS r2_dry, AVG(r2_wet)::float AS r2_wet, "
                    "AVG(a_dry)::float AS a_dry FROM tvdi_edge_params WHERE r2_dry IS NOT NULL AND r2_dry >= 0 "
                    "GROUP BY thang ORDER BY thang")
        return cur.fetchall()


@app.get("/api/health")
def health():
    d = get_dataset()
    return {"ok": True, "wards": len(d["wards"]), "months": len(d["months"]),
            "unmatched_count": d["unmatched_count"]}


# ---------------------------------------------------------------- Quản trị
class LoginBody(BaseModel):
    password: str


def require_admin(authorization: Optional[str] = Header(None)):
    if not ADMIN_PASSWORD:
        raise HTTPException(503, "Chức năng quản trị chưa được bật.")
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token or not helpers.verify_token(SECRET_KEY, token):
        raise HTTPException(401, "Cần đăng nhập quản trị.")


@app.post("/api/admin/login")
def admin_login(body: LoginBody):
    if not ADMIN_PASSWORD:
        raise HTTPException(503, "Chức năng quản trị chưa được bật.")
    if not hmac.compare_digest(body.password.encode(), ADMIN_PASSWORD.encode()):
        time.sleep(1.0)                    # làm chậm việc dò mật khẩu
        raise HTTPException(401, "Sai mật khẩu.")
    return {"token": helpers.make_token(SECRET_KEY, TOKEN_TTL), "expires_in": TOKEN_TTL}


@app.get("/api/admin/status", dependencies=[Depends(require_admin)])
def admin_status():
    d = get_dataset()
    with cursor() as cur:
        cur.execute("SELECT loai, COUNT(*) AS so_dong, MIN(nam * 100 + thang) AS tu, MAX(nam * 100 + thang) AS den "
                    "FROM tvdi_by_ward GROUP BY loai ORDER BY loai")
        by_loai = cur.fetchall()
        cur.execute("SELECT COALESCE(trang_thai, 'KHONG_RO') AS trang_thai, COUNT(*) AS so_dong "
                    "FROM tvdi_by_ward WHERE loai = 'thuc_te' GROUP BY 1 ORDER BY 2 DESC")
        quality = cur.fetchall()
    return {"wards_geometry": len(d["wards"]), "months": len(d["months"]), "by_loai": by_loai,
            "quality": quality, "unmatched_count": d["unmatched_count"], "unmatched": d["unmatched"]}


@app.get("/api/admin/quality", dependencies=[Depends(require_admin)])
def admin_quality():
    """Các tháng có phường/xã thiếu ảnh (số liệu trên web là ước lượng) để quản trị viên xem lại."""
    with cursor() as cur:
        cur.execute("""SELECT nam, thang, COUNT(*) AS tong,
                              COUNT(*) FILTER (WHERE trang_thai <> 'OK') AS uoc_luong,
                              MIN(so_anh) AS so_anh
                       FROM tvdi_by_ward WHERE loai = 'thuc_te'
                       GROUP BY nam, thang HAVING COUNT(*) FILTER (WHERE trang_thai <> 'OK') > 0
                       ORDER BY nam, thang""")
        return cur.fetchall()


@app.post("/api/admin/upload/{kind}", dependencies=[Depends(require_admin)])
async def admin_upload(kind: str, request: Request):
    if kind not in loader.KINDS:
        raise HTTPException(404, f"Loại dữ liệu không hợp lệ: {kind}")
    body = await request.body()
    if len(body) > MAX_UPLOAD:
        raise HTTPException(413, "File quá lớn (tối đa 30 MB).")
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "File phải lưu ở dạng UTF-8.")

    def work():
        with cursor(commit=True) as cur:
            return loader.load_text(cur, kind, text)
    try:
        n = await run_in_threadpool(work)
    except ValueError as e:
        raise HTTPException(400, str(e))
    clear_cache()
    return {"kind": kind, "rows": n}


# ---------------------------------------------------------------- Giao diện (đặt SAU các route /api)
app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="frontend")
