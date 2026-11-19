# Chạy phần Đăng nhập và Khách hàng

Dùng Node.js 24 và MySQL 8.0. Mở PowerShell tại thư mục `quanLyRapChieuPhim`.

1. Trong MySQL Workbench, chọn schema đồ án đã có các bảng và dữ liệu mẫu. Chạy `sqlCode/create_tai_khoan.sql` trên schema đó để thêm bảng tài khoản.
2. Chạy `npm ci` để cài đúng phiên bản thư viện trong `package-lock.json`.
3. Tạo `.env` từ `.env.example` nếu máy anh chưa có file này.

   ```powershell
   Copy-Item .env.example .env
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. Điền `DB_NAME`, `DB_USER`, `DB_PASSWORD` theo kết nối Workbench. Dán chuỗi ngẫu nhiên vào `SESSION_SECRET`. Dùng dấu nháy kép quanh mật khẩu nếu chứa dấu `#` hoặc khoảng trắng. Giữ `.env` ở máy anh.
5. Chạy `npm start`, rồi mở [trang đăng nhập](http://127.0.0.1:3000). Hai trang tải Bootstrap và jQuery qua CDN. Mở [trang kiểm tra kết nối](http://127.0.0.1:3000/api/health) để xác nhận API trả `{"ok":true}`.

## Tài khoản demo

Đăng ký trên giao diện để tạo tài khoản nhân viên quầy. Dùng tên 3–50 ký tự gồm chữ Latin, số hoặc gạch dưới. Mật khẩu cần ít nhất 12 ký tự.

Nhân viên có thể xem, tìm kiếm, thêm, sửa và xem lịch sử mua vé. Để thử Xóa, tạo một tài khoản riêng rồi cấp vai trò quản trị trong Workbench.

```sql
UPDATE TaiKhoan
SET VaiTro = 'QuanTriVien'
WHERE TenDangNhap = 'admin_demo';
```

Đăng nhập lại sau khi cấp quyền. Khách hàng có vé hoặc hóa đơn sẽ được MySQL giữ lại theo khóa ngoại.

## Dựng schema mới để thử

Tạo một schema mới nếu cần thử toàn bộ bộ dữ liệu. Chạy theo thứ tự:

1. `createTable.sql`
2. `addSample.sql`
3. `seed_T26.sql`
4. `create_trigger.sql`
5. `create_procedure.sql`
6. `create_function.sql`
7. `create_tai_khoan.sql`

Chạy `test_function.sql` để đối chiếu T26 và `NormalQuery.sql` để đối chiếu T33. Cấu hình ứng dụng chạy cục bộ trên `127.0.0.1`. Phiên đăng nhập sẽ hết khi khởi động lại Node.js.
