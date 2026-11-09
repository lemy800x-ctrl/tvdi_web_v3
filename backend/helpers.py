"""Hàm thuần của backend (không cần database/web) để kiểm thử được."""
import base64
import hashlib
import hmac
import json
import re
import time
import unicodedata
from typing import Dict, List, Optional

PREFIXES = ("phuong", "xa", "thi tran", "dac khu")


def norm(s: str) -> str:
    """Chuẩn hóa tên để so khớp: bỏ dấu, chữ thường, gọn khoảng trắng."""
    t = unicodedata.normalize("NFD", str(s or "")).lower().replace("đ", "d")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", t).strip()


def clean(s: str) -> str:
    """Bỏ tiền tố Phường/Xã/Đặc khu khỏi tên đã chuẩn hóa."""
    t = norm(s)
    for p in PREFIXES:
        if t.startswith(p + " "):
            return t[len(p) + 1:].strip()
    return t


def build_lookup(names: List[str]):
    exact: Dict[str, int] = {}
    by_clean: Dict[str, List[int]] = {}
    for i, n in enumerate(names):
        exact.setdefault(norm(n), i)
        by_clean.setdefault(clean(n), []).append(i)

    def find(name: str) -> Optional[int]:
        k = norm(name)
        if k in exact:
            return exact[k]
        c = clean(name)
        hit = by_clean.get(c, [])
        return hit[0] if len(hit) == 1 else None      # trùng tên sau khi bỏ tiền tố -> không đoán
    return find


def level_of(v: Optional[float]) -> Optional[int]:
    if v is None:
        return None
    for i, up in enumerate((0.2, 0.4, 0.6, 0.8)):
        if v < up:
            return i
    return 4


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(secret: str, ttl: int, now: Optional[float] = None) -> str:
    payload = _b64(json.dumps({"exp": int((now or time.time()) + ttl), "role": "admin"}).encode())
    sig = _b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_token(secret: str, token: str, now: Optional[float] = None) -> bool:
    try:
        payload, sig = token.split(".", 1)
        good = _b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return False
        data = json.loads(_unb64(payload))
        return data.get("role") == "admin" and data.get("exp", 0) > (now or time.time())
    except Exception:
        return False


def round_or_none(v, d):
    return None if v is None else round(float(v), d)
