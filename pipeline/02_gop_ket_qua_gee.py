import sys
from pathlib import Path
import pandas as pd
import numpy as np

COT_BAT_BUOC = ["ward_uid", "fullname", "nam", "thang", "tvdi_mean", "lst_mean", "ndvi_mean", "trang_thai"]
TVDI_LOP = [0.2, 0.4, 0.6, 0.8]
NHAN_MUC = ["Rất ẩm", "Ẩm", "Trung bình", "Khô", "Rất khô"]


def kiem_tra_dinh_danh(raw: pd.DataFrame, ky_vong: int | None):
    """Kiểm tra toàn vẹn 167 phường/xã: trùng mã, trùng tên, trùng dòng hoặc thiếu tháng đều DỪNG và báo rõ."""
    loi = []
    n_ten = raw["fullname"].nunique()
    if "ward_uid" in raw.columns:
        raw["ward_uid"] = raw["ward_uid"].astype(str).str.strip()
        n_uid = raw["ward_uid"].nunique()
        trung_ten = raw.groupby("fullname")["ward_uid"].nunique()
        print(f"Số mã phường/xã (ward_uid): {n_uid} | Số tên khác nhau: {n_ten}")
        if (trung_ten > 1).any():
            ds = ", ".join(trung_ten[trung_ten > 1].index[:10])
            loi.append(f"{int((trung_ten > 1).sum())} tên dùng chung cho nhiều phường/xã (ví dụ: {ds}).")
        khoa = "ward_uid"
    else:
        print(f"Số tên phường/xã khác nhau: {n_ten} (không có cột ward_uid)")
        khoa = "fullname"

    dup = raw.duplicated([khoa, "nam", "thang"]).sum()
    if dup:
        loi.append(f"Phát hiện {dup} dòng trùng (phường/xã, năm, tháng).")

    if ky_vong and n_ten != ky_vong:
        loi.append(f"Có {n_ten} phường/xã nhưng kỳ vọng {ky_vong}. Kiểm tra lại các file H1/H2 đã tải đủ chưa.")

    per_month = raw.groupby(["nam", "thang"])[khoa].nunique()
    if per_month.nunique() > 1:
        thieu = ", ".join(f"{int(m):02d}/{int(y)}={n}" for (y, m), n in per_month[per_month < per_month.max()].head(8).items())
        loi.append("Số phường/xã mỗi tháng không đều: " + thieu)

    if loi:
        raise SystemExit("DỪNG vì dữ liệu không toàn vẹn:\n - " + "\n - ".join(loi))


def bao_cao_phan_bo(ok: pd.DataFrame):
    """Thống kê phân bố TVDI cấp phường/xã (chỉ tính trên các dòng trạng thái OK)."""
    if len(ok) == 0:
        print("\n! CẢNH BÁO: Không có dòng nào đạt trạng thái OK.")
        return

    q = ok["tvdi_mean"].quantile([0.05, 0.25, 0.5, 0.75, 0.95]).round(3)
    print("\nPhân bố TVDI cấp phường/xã (dòng OK): " + " | ".join(f"p{int(k*100)}={v}" for k, v in q.items()))

    muc = pd.cut(ok["tvdi_mean"], [-0.001] + TVDI_LOP + [1.001], labels=NHAN_MUC)
    print("Tỷ lệ theo mức: " + ", ".join(f"{k} {v:.1%}" for k, v in muc.value_counts(normalize=True).sort_index().items()))

    span = q[0.95] - q[0.05]
    tb = (muc == "Trung bình").mean()
    if span < 0.35 or tb > 0.55:
        print(f"! Lưu ý: TVDI hơi tập trung ở giữa (p95 - p5 = {span:.2f}, {tb:.0%} ở mức Trung bình).")

    sd_ward = ok.groupby("fullname")["tvdi_mean"].mean().std()
    print(f"Độ lệch chuẩn của TVDI trung bình giữa các phường/xã: {sd_ward:.3f}")


def kiem_tra_canh(thu_muc: Path):
    """Gộp 4 file canh_theo_mua_Q1..Q4.csv (hoặc đọc canh_theo_mua.csv) và kiểm tra tham số."""
    q_files = sorted(thu_muc.glob("canh_theo_mua_Q*.csv"))
    single_file = thu_muc / "canh_theo_mua.csv"

    if q_files:
        e = pd.concat([pd.read_csv(f) for f in q_files], ignore_index=True).sort_values("m").reset_index(drop=True)
    elif single_file.exists():
        e = pd.read_csv(single_file).sort_values("m").reset_index(drop=True)
    else:
        print("\n(Chưa thấy file canh_theo_mua*.csv trong thư mục.)")
        return

    e.to_csv("canh_theo_mua_full.csv", index=False)
    xau = e[(e["ok"] != 1) | (e["a_dry"] >= 0) | (e["b_dry"] > 65) | (e["b_wet"] < 18)]
    print(f"\nCạnh khô/ướt theo mùa: {len(e)} tháng, {int((e['ok'] == 1).sum())} tháng đạt kiểm tra vật lý.")
    cols_show = [c for c in ["m", "n_pts", "so_bin", "a_dry", "b_dry", "r2_dry", "rmse_dry", "b_wet", "ok"] if c in e.columns]
    print(e[cols_show].round(3).to_string(index=False))
    if len(xau):
        print("! Tháng cạnh bất thường (đã gắn nhãn CANH_LOI): " + ", ".join(str(int(m)) for m in xau["m"]))


def tao_file_hien_thi(out: pd.DataFrame) -> pd.DataFrame:
    """Xuất đúng 10 cột chuẩn khớp schema Database của Website & nội suy/lấp khí hậu tháng thiếu ảnh."""
    df = out.copy()

    # 1. Đổi tên cột sang đúng schema 10 cột của Backend Web
    df = df.rename(columns={
        "tvdi_mean": "tvdi",
        "lst_mean": "lst",
        "ndvi_mean": "ndvi",
        "so_pixel_hop_le": "so_pixel",
        "trang_thai": "trang_thai_goc",
    })

    # 2. Chỉ giữ lại giá trị quan trắc thật ở các dòng trang_thai_goc == 'OK'
    ok_mask = df["trang_thai_goc"] == "OK"
    for col in ["ndvi", "lst", "tvdi"]:
        df[col] = np.where(ok_mask, df[col], np.nan)

    # 3. Bước A: Nội suy tuyến tính theo thời gian trong từng phường/xã (giới hạn tối đa 2 tháng liên tiếp)
    khoa = "ward_uid" if "ward_uid" in df.columns else "fullname"
    df = df.sort_values([khoa, "nam", "thang"]).reset_index(drop=True)
    interp_df = df.groupby(khoa)[["ndvi", "lst", "tvdi"]].transform(
        lambda s: s.interpolate(method="linear", limit=2, limit_area="inside")
    )
    interp_mask = (~ok_mask) & interp_df["tvdi"].notna()

    for col in ["ndvi", "lst", "tvdi"]:
        df[col] = np.where(interp_mask, interp_df[col], df[col])

    # 4. Bước B: Các tháng khuyết dài hơn (chưa nội suy được) -> lấp bằng trung bình khí hậu cùng tháng
    clim_mask = df["tvdi"].isna()
    for col in ["ndvi", "lst", "tvdi"]:
        clim_m = df[ok_mask].groupby([khoa, "thang"])[col].mean()
        clim_w = df[ok_mask].groupby(khoa)[col].mean()
        fallback = df.set_index([khoa, "thang"]).index.map(clim_m).to_numpy()
        fallback_w = df[khoa].map(clim_w).to_numpy()
        fallback = np.where(np.isnan(fallback), fallback_w, fallback)
        df[col] = np.where(df[col].isna(), fallback, df[col])

    # 5. Gán cột 'nguon' chuẩn theo quy ước của Website ('quan_trac' | 'noi_suy' | 'khi_hau')
    df["nguon"] = np.select(
        [ok_mask, interp_mask, clim_mask],
        ["quan_trac", "noi_suy", "khi_hau"],
        default="khi_hau"
    )

    # 6. Làm tròn & sắp xếp đúng thứ tự 10 cột chuẩn của Database
    df["ndvi"] = df["ndvi"].round(4)
    df["lst"] = df["lst"].round(2)
    df["tvdi"] = df["tvdi"].round(4)
    df["so_anh"] = df["so_anh"].fillna(0).astype(int)
    df["so_pixel"] = df["so_pixel"].fillna(0).astype(int)

    cot_web = ["fullname", "nam", "thang", "ndvi", "lst", "tvdi", "nguon", "so_anh", "so_pixel", "trang_thai_goc"]
    return df.sort_values(["fullname", "nam", "thang"])[cot_web].reset_index(drop=True)


def main(thu_muc_str: str, ky_vong: int | None = None):
    thu_muc = Path(thu_muc_str)
    if not thu_muc.is_dir():
        raise SystemExit(f"Không tìm thấy thư mục: {thu_muc}")

    files = sorted(thu_muc.glob("TVDI_phuongxa_*.csv"))
    if not files:
        raise SystemExit(f"Không tìm thấy file TVDI_phuongxa_*.csv nào trong {thu_muc}")

    print(f"Đang đọc {len(files)} file CSV từ: {thu_muc}")
    raw = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)

    thieu_cot = [c for c in COT_BAT_BUOC if c not in raw.columns]
    if thieu_cot:
        raise SystemExit(f"Thiếu các cột bắt buộc: {thieu_cot}")

    raw["nam"] = raw["nam"].astype(float).astype(int)
    raw["thang"] = raw["thang"].astype(float).astype(int)

    kiem_tra_dinh_danh(raw, ky_vong)

    # Sắp xếp chuẩn theo mã phường/xã, năm, tháng
    out = raw.sort_values(["ward_uid", "nam", "thang"]).reset_index(drop=True)

    # Thống kê trạng thái dữ liệu toàn bộ tập dữ liệu
    print(f"\nTổng số bản ghi: {len(out):,} ({out['nam'].min()}-{out['nam'].max()})")
    print("Thống kê trạng thái dữ liệu:")
    for st, cnt in out["trang_thai"].value_counts().items():
        print(f"  - {st}: {cnt:,} dòng ({cnt / len(out):.1%})")

    out.to_csv("tvdi_phuong_xa_full.csv", index=False, encoding="utf-8-sig")

    hien_thi = tao_file_hien_thi(out)
    hien_thi.to_csv("tvdi_phuong_xa_hienthi.csv", index=False, encoding="utf-8-sig")

    ok = out[out["trang_thai"] == "OK"].copy()
    bao_cao_phan_bo(ok)
    kiem_tra_canh(thu_muc)

    print("\nĐã ghi thành công:")
    print("  1. tvdi_phuong_xa_full.csv     (dữ liệu đầy đủ cho phân tích / học máy)")
    print("  2. tvdi_phuong_xa_hienthi.csv  (10 cột chuẩn schema Web, đã nội suy & lấp khí hậu)")
    print("  3. canh_theo_mua_full.csv      (bảng tham số cạnh 12 tháng đã gộp)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit('Cách dùng: python 02_gop_ket_qua_gee.py "<thư mục chứa các file csv>" 167')
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None)