"""Kiểm thử logic backend không cần FastAPI/PostgreSQL thật (chạy: python tests/test_backend.py)."""
import json
import sys
import types
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# ---- Thư viện web/CSDL giả chỉ đủ để nạp được main.py ----
class HTTPException(Exception):
    def __init__(self, status_code, detail=None):
        self.status_code, self.detail = status_code, detail
for name in ("fastapi", "fastapi.staticfiles", "starlette", "starlette.concurrency", "starlette.middleware",
             "starlette.middleware.gzip", "psycopg2", "psycopg2.extras", "psycopg2.pool", "dotenv", "pydantic"):
    sys.modules[name] = MagicMock()
sys.modules["fastapi"].HTTPException = HTTPException


class StubApp:
    """FastAPI giả: các decorator trả lại đúng hàm gốc để kiểm thử được."""
    def _deco(self, *a, **k): return lambda f: f
    get = post = middleware = _deco
    def add_middleware(self, *a, **k): pass
    def mount(self, *a, **k): pass


sys.modules["fastapi"].FastAPI = lambda **k: StubApp()
sys.modules["psycopg2"].Error = type("PgError", (Exception,), {})
sys.modules["psycopg2"].sql = MagicMock()
class BaseModel: pass
sys.modules["pydantic"].BaseModel = BaseModel
sys.modules["psycopg2"].__dict__["extras"] = sys.modules["psycopg2.extras"]

from backend import main  # noqa: E402


class FakeCur:
    """Trả kết quả theo từ khóa trong câu SQL."""
    def __init__(self, script): self.script, self.rows = script, []
    def execute(self, q, params=None):
        text = q if isinstance(q, str) else str(q)
        for key, rows in self.script:
            if key in text:
                self.rows = rows; return
        self.rows = []
    def fetchall(self): return self.rows


def fake_cursor(script):
    @contextmanager
    def cur(commit=False): yield FakeCur(script)
    return cur


# ---- 1. build_dataset ----
geoms = [{"name": "Phường An Đông", "area_km2": 4.0, "geometry": {"type": "Polygon", "coordinates": []}},
         {"name": "Xã Đất Đỏ", "area_km2": 9.0, "geometry": {"type": "Polygon", "coordinates": []}},
         {"name": "Xã An Phú", "area_km2": 5.0, "geometry": {"type": "Polygon", "coordinates": []}},
         {"name": "Phường An Phú", "area_km2": 6.0, "geometry": {"type": "Polygon", "coordinates": []}}]
main._geom_cache = geoms
R = lambda w, y, m, loai, tv=None, lst=None, nd=None, st="OK": {"ward_code": w, "nam": y, "thang": m, "loai": loai, "tvdi_mean": tv, "lst_mean": lst, "ndvi_mean": nd, "trang_thai": st}
rows = [
    R("Phường An Đông", 2026, 8, "thuc_te", 0.51234, 36.123, 0.31),
    R("Xã Đất Đỏ", 2026, 8, "thuc_te", 0.42, 35.5, 0.28, "NOI_SUY"),       # thiếu ảnh -> số nội suy, đánh dấu ước lượng
    R("Xã Đất Đỏ", 2026, 9, "thuc_te", 0.43, 36.0, 0.27, "KHI_HAU"),
    R("phuong an dong", 2026, 9, "thuc_te", 0.6, 37.0, 0.3),               # khớp không phân biệt dấu/hoa thường
    R("Phường An Đông", 2026, 10, "du_bao", 0.7),
    R("Xã Đất Đỏ", 2026, 10, "du_bao", 0.45),
    R("Phường An Đông", 2026, 9, "du_bao", 0.99),                          # trùng tháng thật: phải bỏ, ưu tiên thực tế
    R("Phường An Đông", 2026, 3, "kiem_chung", 0.4),
    R("An Phú", 2026, 8, "thuc_te", 0.5),                                  # mơ hồ (Xã An Phú / Phường An Phú) -> không đoán
    R("Phường Không Tồn Tại", 2026, 8, "thuc_te", 0.5),
]
script = [("FROM tvdi_by_ward WHERE loai IN", rows),
          ("SELECT DISTINCT trang_thai", [{"trang_thai": "Random Forest"}, {"trang_thai": "OK"}])]
main.cursor = fake_cursor(script)
d = main.build_dataset()
months = [(m["nam"], m["thang"], m["loai"]) for m in d["months"]]
assert months == [(2026, 8, "thuc_te"), (2026, 9, "thuc_te"), (2026, 10, "du_bao")], months
assert d["wards"] == [g["name"] for g in geoms]
assert d["tvdi"][0] == [0.5123, 0.6, 0.7], d["tvdi"][0]           # tháng 9 lấy thực tế 0.6, KHÔNG phải dự báo 0.99
assert d["lst"][0] == [36.12, 37.0, None] and d["ndvi"][0][2] is None
assert d["tvdi"][1] == [0.42, 0.43, 0.45]
assert d["est"][1] == [1, 2, 0], d["est"][1]                       # 1 = nội suy, 2 = trung bình nhiều năm, 0 = ảnh thật/dự báo
assert d["est"][0] == [0, 0, 0] and len(d["est"]) == 4
assert d["tvdi"][2] == [None, None, None] and d["tvdi"][3] == [None, None, None]
assert d["verify"]["months"] == [{"nam": 2026, "thang": 3}] and d["verify"]["tvdi"][0] == [0.4]
assert d["forecast_model"] == "Random Forest"
assert d["unmatched_count"] == 2 and "Phường Không Tồn Tại" in d["unmatched"] and "An Phú" in d["unmatched"]
print("build_dataset OK: thực tế ưu tiên hơn dự báo, ảnh hỏng để trống, tên mơ hồ không đoán")

# ---- 2. Bảng trống -> báo lỗi rõ ràng, KHÔNG trả dữ liệu giả ----
main.cursor = fake_cursor([("FROM tvdi_by_ward WHERE loai IN", [])])
try:
    main.build_dataset(); raise SystemExit("LỖI: phải báo lỗi khi CSDL trống")
except HTTPException as e:
    assert e.status_code == 503 and "chưa có dữ liệu" in e.detail.lower(); print("CSDL trống -> 503:", e.detail)

# ---- 3. Phân quyền ----
main.ADMIN_PASSWORD, main.SECRET_KEY = "mk-dung", "khoa-bi-mat"
def must_fail(auth, code):
    try:
        main.require_admin(auth); raise SystemExit(f"LỖI: '{auth}' phải bị chặn")
    except HTTPException as e:
        assert e.status_code == code, (auth, e.status_code)
must_fail(None, 401); must_fail("", 401); must_fail("Bearer rac", 401); must_fail("Bearer " + main.helpers.make_token("khoa-khac", 60), 401)
must_fail("Bearer " + main.helpers.make_token("khoa-bi-mat", -5), 401)       # hết hạn
assert main.require_admin("Bearer " + main.helpers.make_token("khoa-bi-mat", 60)) is None
main.ADMIN_PASSWORD = ""
must_fail("Bearer " + main.helpers.make_token("khoa-bi-mat", 60), 503)        # không đặt mật khẩu -> tắt hẳn quản trị
print("phân quyền OK: không token/sai khóa/hết hạn bị chặn; chưa đặt ADMIN_PASSWORD thì tắt quản trị")

# ---- 4. Đăng nhập ----
main.ADMIN_PASSWORD = "mk-dung"
main.time.sleep = lambda s: None
body = types.SimpleNamespace(password="sai")
try:
    main.admin_login(body); raise SystemExit("LỖI: sai mật khẩu phải bị từ chối")
except HTTPException as e: assert e.status_code == 401
tok = main.admin_login(types.SimpleNamespace(password="mk-dung"))["token"]
assert main.helpers.verify_token("khoa-bi-mat", tok)
print("đăng nhập OK")

# ---- 5. Mã nguồn không còn số bịa / đường dẫn cá nhân ----
import re
for f in list((ROOT / "backend").glob("*.py")) + list((ROOT / "frontend").glob("*")) + list((ROOT / "pipeline").glob("*")):
    if not f.is_file():
        continue
    t = f.read_text(encoding="utf-8")
    assert not re.search(r"C:\\\\Users|C:\\Users|password\s*=\s*['\"]\.|0\.892|except Exception:\s*\n\s*pass", t), f"nghi vấn tồn dư trong {f.name}"
print("không có đường dẫn cá nhân, mật khẩu ghi cứng hay số bịa trong mã nguồn")
print("\nTẤT CẢ KIỂM THỬ BACKEND ĐẠT")
