# Web TVDI TP.HCM - hướng dẫn chạy (1 trang)

## 0. Làm ngay, trước mọi việc
1. Đổi mật khẩu CSDL trên Neon, rồi cập nhật `DATABASE_URL` trên Render.
2. Xóa `.env` và thư mục `.git` khỏi thư mục Google Drive đang chia sẻ; đặt thư mục về riêng tư.
3. Bỏ các script chỉnh sửa số liệu dự báo: `tinh_chinh_chuan.py`, `nap_2026.py`, `dong_bo_2026.py`, `cap_nhat_database_co.py`
   và mọi script có ghi cứng mật khẩu hay đường dẫn `C:\Users\...`. Bộ mới này không cần chúng.

## 1. Lấy dữ liệu từ Earth Engine (NDVI, LST, TVDI theo phường/xã, 2016 -> 09/2026)
- Mở `pipeline/01_gee_tvdi_lst_ndvi_phuong_xa.js` trong Code Editor, sửa dòng `ASSET` (và `NAME_FIELD` nếu tên trường khác `fullname`).
- Bấm Run, kiểm tra dòng in "Số phường/xã" ra 167, rồi vào tab Tasks bấm Run cho 11 task.
- Tải 11 file `TVDI_phuongxa_20xx.csv` từ Google Drive (thư mục `TVDI_PhuongXa_v2`) về một thư mục.

## 2. Xử lý và huấn luyện (trên máy, không cần trên Render)
```
pip install -r requirements-pipeline.txt
python pipeline/02_gop_ket_qua_gee.py "<thư mục chứa 11 file csv>"
python pipeline/03_huan_luyen_du_bao.py tvdi_phuong_xa_full.csv
```
Bước 2 ghi 3 file:
- `tvdi_phuong_xa_full.csv`: số liệu THẬT, dùng để học máy (chỉ dòng ảnh dùng được).
- `tvdi_phuong_xa_hienthi.csv`: dành cho WEB. Các tháng thiếu ảnh được lấp bằng số ước lượng (nội suy nếu thiếu tối đa 3 tháng liền,
  lâu hơn thì lấy trung bình nhiều năm) và có cột `nguon` để web ghi rõ "ước lượng". Web nhờ vậy không bị khuyết.
- `thong_so_bien_full.csv`: hệ số cạnh khô/ướt từng tháng.
Bước 3 ghi `du_bao_phuong_xa.csv` (6 tháng sau tháng 9/2026, kèm dự báo kiểm chứng 2026), `ket_qua_so_sanh_mo_hinh.csv`, `kiem_chung_tom_tat.csv`.
Số ước lượng chỉ để hiển thị, tuyệt đối không dùng để huấn luyện mô hình.

Cách đọc kết quả bước 3 (quan trọng khi báo cáo):
- Cột `so_voi_khi_hau` > 0: mô hình tốt hơn việc chỉ dùng TVDI trung bình nhiều năm theo tháng. <= 0: chưa tốt hơn, phải nói đúng như vậy.
- Bảng "KIỂM CHỨNG" so dự báo 2026 (làm khi chưa biết 2026) với TVDI thật của 2026.
- Dự báo được giữ nguyên như mô hình tạo ra. Không kéo giãn, không cộng trừ.

## 3. Nạp vào CSDL (chọn 1 trong 2 cách)
- Cách A (web): đăng nhập Quản trị, tải lần lượt 5 file CSV ở mục "Nạp dữ liệu" (mục Hiện trạng dùng file `tvdi_phuong_xa_hienthi.csv`).
- Cách B (máy): đặt `.env` (xem `.env.example`) rồi chạy
  `python pipeline/04_nap_du_lieu.py --thuc-te tvdi_phuong_xa_hienthi.csv --du-bao du_bao_phuong_xa.csv --mo-hinh ket_qua_so_sanh_mo_hinh.csv --kiem-chung kiem_chung_tom_tat.csv --canh-kho-uot thong_so_bien_full.csv`

Bảng ranh giới `phuong_xa_full` đang dùng được giữ nguyên (đổi tên bằng biến `WARD_TABLE` nếu cần).

## 4. Chạy web
Trên Render đặt các biến môi trường (KHÔNG ghi vào code):
`DATABASE_URL`, `ADMIN_PASSWORD` (dài, khó đoán), `SECRET_KEY` (chuỗi ngẫu nhiên dài), `PYTHON_VERSION`.
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
Kiểm tra: mở `/api/health` phải thấy `"ok": true` và `unmatched_count` bằng 0.
`unmatched_count` > 0 nghĩa là có tên phường/xã trong dữ liệu không khớp ranh giới (xem chi tiết trong Quản trị).

## 5. Cách dùng trên web
- Bấm một tháng trên thanh thời gian: xem bản đồ tháng đó. Vạch đứng ngăn "HIỆN TRẠNG" và "DỰ BÁO".
- "Xem dự báo 6 tháng tới": chạy hoạt ảnh từ tháng hiện trạng mới nhất qua các tháng dự báo. Tab "Tổng quan" có bảng dự báo toàn thành phố.
- Phường/xã màu nhạt (và có chữ "ước lượng" trong bảng xếp hạng) là số liệu thiếu ảnh vệ tinh, đã được ước lượng.
- "Lập bản đồ chuyên đề" (thanh trên cùng): mở hộp thoại cho tháng đang xem; đổi chỉ số hoặc tháng/năm thì bản đồ tự vẽ lại,
  có tọa độ địa lý, la bàn, thước tỷ lệ, tên bản đồ, chú giải, rồi tải ảnh PNG. Ai cũng dùng được (không cần quản trị).

## 6. Phân quyền
- Người dùng thường: xem bản đồ, xếp hạng, lọc, thống kê, bản đồ chuyên đề, mô hình.
- Quản trị viên (đăng nhập bằng `ADMIN_PASSWORD`): xem tình trạng dữ liệu, ảnh/tháng bị loại, và nạp/thay dữ liệu.
- Web không gọi trực tiếp Earth Engine; dữ liệu đi theo đường: Earth Engine -> CSV -> máy -> CSDL.
