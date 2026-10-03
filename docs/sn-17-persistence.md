# SN-17: Hồ sơ người dùng lưu trong PostgreSQL

Ứng dụng NestJS inject `UserRepository` vào `UsersService`. Đọc và ghi tài khoản
đi thẳng vào bảng `users`, không nạp lại tài khoản mẫu mỗi lần khởi động.
Nếu database không kết nối được hoặc thiếu migration, ứng dụng dừng khởi động;
không tự chuyển sang dữ liệu trong bộ nhớ.

## Chạy trên máy mới

1. Cài và khởi động PostgreSQL, tạo `.env` từ `.env.example` rồi điền
   `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`.
2. Chạy `npm ci`.
3. Chạy `npm run db:create` nếu database chưa tồn tại. Tài khoản PostgreSQL
   cần quyền tạo database cho bước này.
4. Chạy `npm run db:migrate`. Lệnh này hiện áp dụng migration **001 và 008**
   cho tài khoản/hồ sơ, chưa phải toàn bộ schema bán hàng và kho.
   Nếu đã cài schema master, vẫn chạy lệnh này để bổ sung migration 008.
5. Chỉ với môi trường phát triển cần tài khoản mẫu, chạy
   `npm run db:seed-users`. Lệnh bỏ qua tài khoản đã có, không đặt lại mật khẩu
   hay ghi đè hồ sơ. Các tài khoản mẫu có mật khẩu `123456`.
6. Chạy `npm run start:dev`.

Không commit `.env`. Không chạy seed mẫu trên môi trường dữ liệu thật.
Không xóa database/data directory khi khởi động lại ứng dụng.

## Dữ liệu được lưu

- Tài khoản mới, tên đăng nhập/email, mật khẩu băm.
- Họ tên, số điện thoại, vai trò, trạng thái, kho/địa bàn trong trường
  `assignedWarehouse` hiện tại.
- Đường dẫn avatar, lý do khóa, mã đặt lại mật khẩu và số lần đăng nhập sai.

File avatar vẫn nằm trong `uploads/avatars`; cần giữ thư mục này khi triển khai.
Migration không thể khôi phục các thay đổi RAM đã mất trước đó.
Các phiên refresh token, token khôi phục mật khẩu và các phân hệ khác chưa được
chuyển sang PostgreSQL trong SN-17; sau restart có thể cần đăng nhập lại.

## API và kiểm thử

`GET /api/users/me` và `PATCH /api/users/me` yêu cầu Bearer token.
PATCH chỉ nhận `fullName` và `phone`; các trường phân quyền không được cập nhật.

```sh
npm run build
npm run test:profile
npm run test:profile:postgres
```

Kiểm thử PostgreSQL tạo tài khoản tạm riêng, đăng nhập và sửa hồ sơ qua HTTP,
đóng ứng dụng, tạo lại ứng dụng rồi đăng nhập và đọc lại hồ sơ.
Tài khoản kiểm thử được xóa khi kết thúc; không sửa tài khoản đang sử dụng.
