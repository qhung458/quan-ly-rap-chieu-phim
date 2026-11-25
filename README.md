# Chạy ứng dụng quản lý rạp chiếu phim

Dùng Node.js 24 và MySQL 8.0. Mở PowerShell tại thư mục `quanLyRapChieuPhim`.

1. Trong MySQL Workbench, chọn schema đồ án đã có các bảng và dữ liệu mẫu. Chạy `sqlCode/create_tai_khoan.sql` trên schema đó để thêm bảng tài khoản. Với schema đã tạo trước G2, dừng ứng dụng rồi chạy toàn bộ `sqlCode/migrate_G2.sql` trên schema đã chọn trước khi dùng phiên bản này.
2. Chạy `npm ci` để cài đúng phiên bản thư viện trong `package-lock.json`.
3. Tạo `.env` từ `.env.example` nếu máy anh chưa có file này.

   ```powershell
   Copy-Item .env.example .env
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. Điền `DB_NAME`, `DB_USER`, `DB_PASSWORD` theo kết nối Workbench. Dán chuỗi ngẫu nhiên vào `SESSION_SECRET`. Dùng dấu nháy kép quanh mật khẩu nếu chứa dấu `#` hoặc khoảng trắng. Giữ `.env` ở máy anh.
5. Chạy `npm start`, rồi mở [trang đăng nhập](http://127.0.0.1:3000). Giao diện tải Bootstrap và jQuery qua CDN. Mở [trang kiểm tra kết nối](http://127.0.0.1:3000/api/health) để xác nhận API trả `{"ok":true}`.

## Tài khoản demo

Đăng ký trên giao diện để tạo tài khoản nhân viên quầy. Dùng tên 3–50 ký tự gồm chữ Latin, số hoặc gạch dưới. Mật khẩu cần ít nhất 12 ký tự.

Nhân viên có thể xem, tìm kiếm, thêm, sửa và xem lịch sử mua vé. Để thử Xóa, tạo một tài khoản riêng rồi cấp vai trò quản trị trong Workbench.

```sql
UPDATE TaiKhoan
SET VaiTro = 'QuanTriVien'
WHERE TenDangNhap = 'admin_demo';
```

Đăng nhập lại sau khi cấp quyền. Khách hàng có vé hoặc hóa đơn sẽ được MySQL giữ lại theo khóa ngoại.

## Phòng chiếu và ghế

Sau khi đăng nhập, chọn **Phòng chiếu và ghế** trong thanh điều hướng. Nhân viên có thể thêm và sửa phòng hoặc ghế. Quản trị viên có thêm quyền xóa.

- Khi tạo phòng, nhập **Ghế mỗi hàng** để chia ghế theo hàng A, B, …, Z, AA, … Để trống để xếp tất cả ghế vào hàng A. Số ghế của phòng được cập nhật khi thêm hoặc xóa ghế.
- Ghế tạo tự động và ghế thêm thủ công đều dùng chung dãy mã `G001`, `G002`, … cho toàn bộ rạp. Mã mới tiếp theo mã số lớn nhất đang có.
- Số ghế trống được tính theo vé của từng suất chiếu. Vé đã hủy giải phóng chỗ.
- Phòng đã có suất chiếu không thể xóa. Ghế đã có lịch sử vé không thể xóa hoặc đổi vị trí.

## Bán vé

Sau khi đăng nhập, mở **Bán vé**, chọn phim rồi chọn một suất còn mở bán của phim đó. Chọn khách hàng và một ghế trống rồi lưu. Nhập mã, tên (có dấu hoặc không dấu) hoặc số điện thoại vào **Tìm khách hàng** để lọc danh sách chọn. Sơ đồ lấy ghế của phòng trong MySQL. Vé đã bán có thể tra cứu theo mã vé hoặc mã khách hàng trong suất đang chọn.

- **Đổi vé** cho phép chọn ghế mới hoặc suất khác còn mở bán. Đổi ghế trong cùng suất giữ giá đã lưu. Đổi sang suất khác dùng giá của suất mới.
- **Hủy vé** giữ bản ghi lịch sử và giải phóng ghế. Thời hạn bán, đổi và hủy lấy từ `CauHinhHeThong`, mặc định là 5 phút trước giờ chiếu để bán và 60 phút để đổi hoặc hủy.
- Schema cần có các quy tắc trong `sqlCode/create_trigger.sql`. Danh sách chọn chỉ hiện suất `SapChieu` còn thời hạn bán. Có thể xem vé của các suất đã qua trong lịch sử mua vé ở trang **Khách hàng**.

## Bắp nước và hóa đơn

Mở **Bắp nước và hóa đơn** trong thanh điều hướng. Nhân viên thêm và sửa combo, lập hóa đơn và xem chi tiết. Quản trị viên có thêm quyền xóa combo và xóa hóa đơn.

- Bảng `DauHoaDon` lưu một khách cho mỗi mã hóa đơn. Bảng `HoaDon` lưu từng dòng combo và có khóa ngoại theo mã hóa đơn và mã khách. Mã hóa đơn tự tăng theo dạng `HD001`, `HD002`, … và ứng dụng giữ số đã cấp khi hóa đơn bị xóa.
- Máy chủ tự tính `TongTien` = giá combo trong MySQL × số lượng. Đổi giá combo sau đó không làm thay đổi hóa đơn cũ.
- Combo đã có trong hóa đơn không thể xóa (khóa ngoại). Hóa đơn nhập trùng combo được gộp số lượng.
- Ngày chứng từ của hóa đơn trước G2 lấy theo dòng có thời điểm mua sớm nhất. Danh sách hóa đơn phân trang. Excel Combo và Hóa đơn lấy đủ các bản ghi khớp theo đúng dữ liệu và thứ tự của lần áp dụng truy vấn đang xem.

## Thống kê

Mở **Thống kê**, chọn khoảng ngày (tối đa 366 ngày, mặc định 30 ngày gần nhất). Trang hiển thị tổng doanh thu vé và bắp nước, doanh thu theo ngày hoặc tháng, theo phim và theo combo.

- Doanh thu vé tính theo ngày chiếu, loại vé đã hủy và suất bị hủy (cùng quy ước với `NormalQuery.sql`). Toàn bộ doanh thu bắp nước của một hóa đơn thuộc ngày chứng từ của hóa đơn đó.

## Dựng schema mới để thử

Tạo một schema mới nếu cần thử toàn bộ bộ dữ liệu. Chạy theo thứ tự:

1. `createTable.sql`
2. `addSample.sql`
3. `seed_T26.sql`
4. `create_trigger.sql`
5. `create_procedure.sql`
6. `create_function.sql`
7. `create_tai_khoan.sql`

Chạy `test_function.sql` để đối chiếu T26 trên schema mới và `NormalQuery.sql` để đối chiếu T33. Nếu dùng dữ liệu mẫu từ phiên bản trước, suất `T26_DAY` có thể vẫn còn 1 ghế trống theo dữ liệu vé đã nạp. Cấu hình ứng dụng chạy cục bộ trên `127.0.0.1`. Phiên đăng nhập sẽ hết khi khởi động lại Node.js.

Kiểm thử tích hợp G2 dùng kết nối MySQL cục bộ từ `.env`. Bộ kiểm thử tạo và dọn các schema thử riêng.

```powershell
$env:G2_TEST_MYSQL = '1'
node --env-file=.env --test test/g2.integration.test.cjs
```
