"""
BƯỚC 2 - Gộp 11 file CSV (TVDI_phuongxa_2016.csv ... TVDI_phuongxa_2026.csv) từ Earth Engine.

Tải 11 file từ Google Drive (thư mục TVDI_PhuongXa_v2) về cùng 1 thư mục, rồi chạy:
    python 02_gop_ket_qua_gee.py "D:\\duong_dan\\thu_muc_chua_csv"

Kết quả (ghi vào thư mục hiện tại):
    tvdi_phuong_xa_full.csv     DỮ LIỆU THẬT (quan trắc): dùng để học máy, chỉ dòng trang_thai = OK được dùng
    tvdi_phuong_xa_hienthi.csv  DÙNG CHO WEB: giống file trên nhưng các tháng thiếu ảnh được LẤP bằng số ước lượng
                                và có cột nguon = quan_trac | noi_suy | khi_hau để web ghi rõ là ước lượng
    thong_so_bien_full.csv      hệ số cạnh khô/ướt và R² từng tháng

Cách lấp chỗ trống (chỉ để hiển thị, KHÔNG dùng để huấn luyện):
    noi_suy : thiếu <= MAX_GAP tháng liên tiếp -> nội suy tuyến tính phần lệch so với trung bình nhiều năm
    khi_hau : thiếu lâu hơn -> dùng trung bình nhiều năm của đúng phường/xã đó, đúng tháng đó

Cài thư viện:  pip install numpy pandas
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

MAX_GAP = 3        # nội suy nếu thiếu tối đa 3 tháng liên tiếp
COT_BAT_BUOC = ["fullname", "nam", "thang", "tvdi_mean", "lst_mean", "ndvi_mean", "trang_thai"]


def lap_day(M, moy, lo, hi, max_gap=MAX_GAP):
    """
    M: ma trận (phường/xã x tháng) giá trị quan trắc, NaN nếu thiếu; moy: tháng trong năm (0..11) của từng cột.
    Trả về (ma trận đã lấp, nguồn) với nguồn: 0 = quan trắc, 1 = nội suy, 2 = trung bình nhiều năm, -1 = không có.
    """
    n, T = M.shape
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            clim = np.full((n, 12), np.nan)
            for k in range(12):
                cols = np.where(moy == k)[0]
                if len(cols):
                    clim[:, k] = np.nanmean(M[:, cols], axis=1)
            mean_w = np.nanmean(M, axis=1)
    clim = np.where(np.isnan(clim), mean_w[:, None], clim)
    A = M - clim[:, moy]
    out, src = M.copy(), np.zeros((n, T), dtype=int)
    for i in range(n):
        valid = np.where(~np.isnan(M[i]))[0]
        if len(valid) == 0:
            src[i, :] = -1
            continue
        for t in np.where(np.isnan(M[i]))[0]:
            prev, nxt = valid[valid < t], valid[valid > t]
            if len(prev) and len(nxt) and (nxt[0] - prev[-1] - 1) <= max_gap:
                p, q = prev[-1], nxt[0]
                a = A[i, p] + (A[i, q] - A[i, p]) * (t - p) / (q - p)
                src[i, t] = 1
            else:
                a, src[i, t] = 0.0, 2
            out[i, t] = np.clip(clim[i, moy[t]] + a, lo, hi)
    return out, src


def tao_file_hien_thi(out):
    """Từ bảng đã gộp, tạo bảng đầy đủ mọi phường/xã x mọi tháng, lấp tháng thiếu và ghi rõ nguồn."""
    keys = sorted(set(zip(out["nam"], out["thang"])))
    (y0, m0), (y1, m1) = keys[0], keys[-1]
    months = [(y, m) for y in range(y0, y1 + 1) for m in range(1, 13) if (y0, m0) <= (y, m) <= (y1, m1)]
    midx = {k: i for i, k in enumerate(months)}
    wards = sorted(out["fullname"].unique())
    widx = {w: i for i, w in enumerate(wards)}
    moy = np.array([m - 1 for _, m in months])
    wi = out["fullname"].map(widx).to_numpy()
    mi = np.array([midx[(a, b)] for a, b in zip(out["nam"], out["thang"])])
    ok = ((out["trang_thai"] == "OK") & out["tvdi"].notna()).to_numpy()      # chỉ ảnh dùng được mới là quan trắc

    filled, src = {}, None
    for col, lo, hi in (("tvdi", 0.0, 1.0), ("lst", -10.0, 70.0), ("ndvi", -0.2, 1.0)):
        M = np.full((len(wards), len(months)), np.nan)
        M[wi[ok], mi[ok]] = out[col].to_numpy(dtype=float)[ok]
        filled[col], s_ = lap_day(M, moy, lo, hi)
        src = s_ if src is None else src            # cả 3 biến có cùng mẫu thiếu nên nguồn giống nhau

    info = out.drop_duplicates(["fullname", "nam", "thang"]).set_index(["fullname", "nam", "thang"])
    rows = []
    nguon_ten = {0: "quan_trac", 1: "noi_suy", 2: "khi_hau", -1: "khong_co"}
    for i, w in enumerate(wards):
        for t, (y, m) in enumerate(months):
            r = info.loc[(w, y, m)] if (w, y, m) in info.index else None
            k = src[i, t]
            rows.append({"fullname": w, "nam": y, "thang": m,
                         "ndvi": None if k == -1 else round(float(filled["ndvi"][i, t]), 4),
                         "lst": None if k == -1 else round(float(filled["lst"][i, t]), 2),
                         "tvdi": None if k == -1 else round(float(filled["tvdi"][i, t]), 4),
                         "nguon": nguon_ten[k],
                         "so_anh": None if r is None else r.get("so_anh"), "so_pixel": None if r is None else r.get("so_pixel"),
                         "trang_thai_goc": None if r is None else r.get("trang_thai")})
    return pd.DataFrame(rows)


def main(thu_muc):
    files = sorted(Path(thu_muc).glob("TVDI_phuongxa_*.csv"))
    if not files:
        raise SystemExit(f"Không thấy file TVDI_phuongxa_*.csv trong: {thu_muc}")
    print(f"Đọc {len(files)} file: " + ", ".join(f.stem[-4:] for f in files))
    raw = pd.concat([pd.read_csv(f, dtype={"fullname": str}) for f in files], ignore_index=True)

    thieu = [c for c in COT_BAT_BUOC if c not in raw.columns]
    if thieu:
        raise SystemExit(f"Thiếu cột {thieu}. Các cột hiện có: {list(raw.columns)}")

    raw["nam"] = raw["nam"].astype(float).astype(int)
    raw["thang"] = raw["thang"].astype(float).astype(int)
    raw["fullname"] = raw["fullname"].str.strip()

    out = pd.DataFrame({
        "fullname": raw["fullname"], "nam": raw["nam"], "thang": raw["thang"],
        "ndvi": raw["ndvi_mean"].round(4), "lst": raw["lst_mean"].round(2), "tvdi": raw["tvdi_mean"].round(4),
        "so_pixel": raw.get("so_pixel"), "so_anh": raw.get("so_anh"),
        "ty_le_hop_le": raw.get("ty_le_hop_le", pd.Series(dtype=float)).round(3),
        "trang_thai": raw["trang_thai"],
    }).sort_values(["fullname", "nam", "thang"])

    trung = out.duplicated(["fullname", "nam", "thang"]).sum()
    if trung:
        print(f"! Có {trung} dòng trùng (phường/xã, tháng): giữ dòng đầu.")
        out = out.drop_duplicates(["fullname", "nam", "thang"])
    out.to_csv("tvdi_phuong_xa_full.csv", index=False, encoding="utf-8")

    cot_bien = [c for c in ["nam", "thang", "so_anh", "so_bin", "a_dry", "b_dry", "r2_dry",
                            "a_wet", "b_wet", "r2_wet"] if c in raw.columns]
    bien = raw[cot_bien].drop_duplicates(["nam", "thang"]).sort_values(["nam", "thang"])
    bien.to_csv("thong_so_bien_full.csv", index=False, encoding="utf-8")

    hien_thi = tao_file_hien_thi(out)
    hien_thi.to_csv("tvdi_phuong_xa_hienthi.csv", index=False, encoding="utf-8")
    dem = hien_thi["nguon"].value_counts()

    # ---------------- Báo cáo kiểm tra ----------------
    n_ward = out["fullname"].nunique()
    n_thang = out[["nam", "thang"]].drop_duplicates().shape[0]
    print(f"\nSố phường/xã: {n_ward} | số tháng: {n_thang} | số dòng: {len(out):,}")
    print("Phân loại chất lượng (trang_thai):")
    print(out["trang_thai"].value_counts().to_string())
    ok = out[out["trang_thai"] == "OK"]
    print(f"\nDòng dùng được: {len(ok):,} / {len(out):,} ({len(ok) / len(out):.1%})")
    thang_xau = (out.groupby(["nam", "thang"])["trang_thai"].apply(lambda s: (s != "OK").mean())
                 .loc[lambda s: s > 0.5])
    if len(thang_xau):
        print("Tháng có hơn 50% phường/xã không dùng được:",
              ", ".join(f"{m:02d}/{y}" for (y, m) in thang_xau.index))
    if {"a_dry", "r2_dry"} <= set(bien.columns):
        print(f"\nHệ số a_dry (cạnh khô, lý thuyết phải ÂM): âm ở "
              f"{(bien['a_dry'] < 0).mean():.0%} số tháng; R² cạnh khô trung bình {bien['r2_dry'].mean():.3f}")
    print("\nBảng cho web (lấp tháng thiếu ảnh): " + ", ".join(f"{k} {v:,}" for k, v in dem.items()))
    print("  quan_trac = ảnh thật | noi_suy = nội suy từ tháng lân cận | khi_hau = trung bình nhiều năm | khong_co = phường/xã không có dữ liệu nào")
    print("\nĐã ghi: tvdi_phuong_xa_full.csv (học máy), tvdi_phuong_xa_hienthi.csv (web), thong_so_bien_full.csv")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit('Cách dùng: python 02_gop_ket_qua_gee.py "<thư mục chứa 11 file csv>"')
    main(sys.argv[1])
