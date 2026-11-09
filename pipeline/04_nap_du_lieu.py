"""
BƯỚC 4 - Nạp kết quả vào PostgreSQL (cách thay thế cho trang Quản trị trên web).

Chạy trong thư mục gốc dự án (nơi có file .env chứa DATABASE_URL):
    python pipeline/04_nap_du_lieu.py --thuc-te tvdi_phuong_xa_hienthi.csv --du-bao du_bao_phuong_xa.csv ^
        --mo-hinh ket_qua_so_sanh_mo_hinh.csv --canh-kho-uot thong_so_bien_full.csv --kiem-chung kiem_chung_tom_tat.csv

Mỗi tham số đều tùy chọn. Nạp lại sẽ thay toàn bộ dữ liệu cùng loại.
Cài:  pip install psycopg2-binary python-dotenv
"""
import argparse
import os
import sys
from pathlib import Path

from dotenv import find_dotenv, load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import loader  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    for kind in loader.KINDS:
        ap.add_argument(f"--{kind}", help=f"File CSV loại '{kind}'")
    args = vars(ap.parse_args())

    import psycopg2
    load_dotenv(find_dotenv(usecwd=True))
    url = os.getenv("DATABASE_URL")
    if not url:
        raise SystemExit("Không thấy DATABASE_URL. Chạy trong thư mục có file .env.")

    conn = psycopg2.connect(url)
    try:
        for kind in loader.KINDS:
            path = args[kind.replace("-", "_")]
            if not path:
                continue
            text = Path(path).read_text(encoding="utf-8-sig")
            with conn.cursor() as cur:
                n = loader.load_text(cur, kind, text)
            conn.commit()
            print(f"[{kind}] đã nạp {n:,} dòng từ {path}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
