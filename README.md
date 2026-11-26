# Chạy ứng dụng quản lý rạp chiếu phim

Dùng Node.js 24 và MySQL từ 8.0.16. Chạy các lệnh PowerShell tại thư mục gốc của repository.

## Chuẩn bị cơ sở dữ liệu

Trong MySQL Workbench, chọn schema sẽ dùng cho `DB_NAME` và chạy toàn bộ từng file trong `sqlCode/` theo thứ tự dưới đây.

### Tạo schema mới

Tạo một schema trống và chọn schema đó trước khi chạy các file. Ví dụ:

```sql
CREATE DATABASE quan_ly_rap_chieu_phim CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE quan_ly_rap_chieu_phim;
```

1. `createTable.sql` tạo các bảng nghiệp vụ, khóa ngoại và dãy mã hóa đơn.
2. `addSample.sql` nạp dữ liệu mẫu nếu cần. Chạy bước này trước khi cài trigger để nạp được lịch chiếu và vé lịch sử.
3. `create_trigger.sql` tạo cấu hình thời hạn bán, đổi, hủy vé và các trigger kiểm tra vé, ghế, lịch chiếu.
4. `create_tai_khoan.sql` tạo bảng tài khoản để đăng ký và đăng nhập.
5. `create_procedure.sql` tạo thủ tục tìm suất chiếu theo phim và ngày.
6. `create_function.sql` tạo hàm `fn_SoGheTrong` mà trang **Bán vé** dùng để hiển thị số ghế trống của suất được chọn.

### Nâng cấp schema đã có dữ liệu

1. Dừng ứng dụng và chọn đúng schema đang dùng. Với cơ sở dữ liệu cũ còn lưu hóa đơn theo từng dòng trong `HoaDon`, chạy `migrate_invoice_headers.sql` nếu phần đầu hóa đơn hoặc dãy mã chưa được cài. Script lấy ngày chứng từ từ dòng mua sớm nhất, tạo một đầu chứng từ cho mỗi mã và giữ nguyên các dòng hóa đơn.
2. Cài các thành phần còn thiếu theo thứ tự. Chạy `create_trigger.sql` cho cấu hình và quy tắc bán vé, rồi `create_tai_khoan.sql` nếu chưa có bảng tài khoản. Chạy `create_function.sql` nếu schema chưa có hàm `fn_SoGheTrong`.

Các file `createTable.sql` và `addSample.sql` dành cho khởi tạo schema mới.

## Khởi động ứng dụng

1. Chạy `npm ci` để cài đúng phiên bản thư viện trong `package-lock.json`.
2. Tạo `.env` từ `.env.example` nếu chưa có.

   ```powershell
   Copy-Item .env.example .env
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Điền `DB_NAME`, `DB_USER`, `DB_PASSWORD` theo kết nối Workbench. Dán chuỗi ngẫu nhiên vào `SESSION_SECRET`. Dùng dấu nháy kép quanh mật khẩu nếu chứa dấu `#` hoặc khoảng trắng.
4. Chạy `npm start`, rồi mở [trang đăng nhập](http://127.0.0.1:3000). Giao diện tải Bootstrap và jQuery qua CDN. Mở [trang kiểm tra kết nối](http://127.0.0.1:3000/api/health) để xác nhận API trả `{"ok":true}`. Phiên đăng nhập sẽ hết khi khởi động lại Node.js.

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

- Lọc danh sách phòng theo loại 2D/3D và khoảng sức chứa thực, rồi sắp theo mã phòng hoặc số ghế.
- Chọn phòng để tra mã ghế chính xác hoặc vị trí theo hàng và số. Có thể lọc nhiều hàng và loại ghế. Danh sách ghế hiển thị số ghế khớp và tổng sức chứa của phòng.
- Khi tạo phòng, nhập **Ghế mỗi hàng** để chia ghế theo hàng A, B, …, Z, AA, … Để trống để xếp tất cả ghế vào hàng A. Số ghế của phòng được cập nhật khi thêm hoặc xóa ghế.
- Ghế tạo tự động và ghế thêm thủ công đều dùng chung dãy mã `G001`, `G002`, … cho toàn bộ rạp. Mã mới tiếp theo mã số lớn nhất đang có.
- Số ghế trống được tính theo vé của từng suất chiếu. Vé đã hủy giải phóng chỗ.
- Phòng đã có suất chiếu không thể xóa. Ghế đã có lịch sử vé không thể xóa hoặc đổi vị trí.

## Bán vé

Sau khi đăng nhập, mở **Bán vé**, chọn phim rồi chọn một suất còn mở bán của phim đó. Chọn khách hàng và một ghế trống rồi lưu. Nhập mã, tên (có dấu hoặc không dấu) hoặc số điện thoại vào **Tìm khách hàng** để tra cứu theo trang. Bảng vé của suất có bộ lọc riêng theo khách, mã vé, ghế, ngày đặt và trạng thái. Sơ đồ vẫn thể hiện tình trạng của toàn bộ ghế trong phòng.

- **Đổi vé** cho phép chọn ghế mới hoặc suất khác còn mở bán. Đổi ghế trong cùng suất giữ giá đã lưu. Đổi sang suất khác dùng giá của suất mới.
- **Hủy vé** giữ bản ghi lịch sử và giải phóng ghế. Thời hạn bán, đổi và hủy lấy từ `CauHinhHeThong`, mặc định là 5 phút trước giờ chiếu để bán và 60 phút để đổi hoặc hủy.
- **Số ghế trống** cạnh sơ đồ lấy từ `fn_SoGheTrong` và được tải lại sau khi bán, đổi hoặc hủy vé. Ghế mới chọn vẫn được tính là trống cho đến khi lưu vé.
- Schema cần có các quy tắc trong `sqlCode/create_trigger.sql`. Danh sách chọn chỉ hiện suất `SapChieu` còn thời hạn bán. Có thể xem vé của các suất đã qua trong lịch sử mua vé ở trang **Khách hàng**.
- Quản trị viên có thể mở **Xem vé** tại **Quản lý suất chiếu** để tra cả suất đã qua hoặc đã hủy. Excel lấy toàn bộ vé khớp từ bản chốt đang xem theo đúng thứ tự, với mã vé, mã suất, ghế, ngày đặt, giá, trạng thái và mã khách.

## Bắp nước và hóa đơn

Mở **Bắp nước và hóa đơn** trong thanh điều hướng. Nhân viên thêm và sửa combo, lập hóa đơn và xem chi tiết. Quản trị viên có thêm quyền xóa combo và xóa hóa đơn.

- Bảng `DauHoaDon` lưu một khách cho mỗi mã hóa đơn. Bảng `HoaDon` lưu từng dòng combo và có khóa ngoại theo mã hóa đơn và mã khách. Mã hóa đơn tự tăng theo dạng `HD001`, `HD002`, … và ứng dụng giữ số đã cấp khi hóa đơn bị xóa.
- Máy chủ tự tính `TongTien` = giá combo trong MySQL × số lượng. Đổi giá combo sau đó không làm thay đổi hóa đơn cũ.
- Combo đã có trong hóa đơn không thể xóa (khóa ngoại). Hóa đơn nhập trùng combo được gộp số lượng.
- Khi chuyển dữ liệu hóa đơn cũ sang đầu chứng từ, ngày chứng từ lấy theo dòng có thời điểm mua sớm nhất. Danh sách hóa đơn phân trang. Excel Combo và Hóa đơn lấy đủ các bản ghi khớp theo đúng dữ liệu và thứ tự của lần áp dụng truy vấn đang xem.

## Thống kê

Mở **Thống kê**, chọn khoảng ngày (tối đa 366 ngày, mặc định 30 ngày gần nhất). Trang hiển thị tổng doanh thu vé và bắp nước, doanh thu theo ngày hoặc tháng, theo phim và theo combo.

- Hai bảng phim và combo có điều kiện tìm kiếm, ngưỡng số lượng và doanh thu, thứ tự sắp xếp và trang riêng. Bấm **Xem thống kê** để tải lại số liệu của kỳ.
- Excel gồm bốn sheet **Tổng quan**, **Theo ngày** hoặc **Theo tháng**, **Theo phim** và **Theo combo**. Hai sheet xếp hạng lấy đủ các dòng khớp theo điều kiện và thứ tự đang áp dụng, kể cả khi đang xem trang sau.
- Doanh thu vé tính theo ngày chiếu, loại vé đã hủy và suất bị hủy (cùng quy ước với `NormalQuery.sql`). Toàn bộ doanh thu bắp nước của một hóa đơn thuộc ngày chứng từ của hóa đơn đó.

## Kiểm thử

### Kiểm tra bằng SQL

Trên schema thử đã được khởi tạo đầy đủ và nạp dữ liệu mẫu, chạy theo thứ tự sau.

1. `seed_T26.sql` nạp thêm dữ liệu kiểm thử ghế và suất chiếu. Chạy một lần trên schema thử.
2. `test_function.sql` đối chiếu số ghế trống.
3. `test_rules.sql` kiểm tra các quy tắc bán vé, đổi vé và lịch chiếu. Script tạo thủ tục kiểm tra tạm và hoàn tác các giao dịch thử.

Có thể chạy `kiemTraDuLieu.sql` để rà dữ liệu hoặc `NormalQuery.sql` để đối chiếu doanh thu vé theo ngày chiếu.

### Kiểm thử ứng dụng

`npm test` chạy kiểm thử mặc định. Để chạy cả kiểm thử tích hợp, bật cờ dưới đây. Bộ kiểm thử dùng kết nối MySQL cục bộ trong `.env` và tự tạo, dọn các schema thử riêng.

```powershell
$env:MYSQL_INTEGRATION_TESTS = '1'
node --env-file=.env --test 'test/*.test.cjs'
Remove-Item Env:MYSQL_INTEGRATION_TESTS
```

Muốn chạy riêng một chức năng, thay mẫu `test/*.test.cjs` bằng tên file tương ứng, ví dụ `test/invoices-and-combos.integration.test.cjs` cho hóa đơn và combo.
