# SN-17 — Hồ sơ cá nhân lưu trong PostgreSQL

## Khởi chạy

Điền `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` vào `.env`
theo `.env.example`. Không commit `.env`.

```sh
npm ci
npm run db:create
npm run db:migrate
# Chỉ dùng cho môi trường phát triển cần tài khoản mẫu:
npm run db:seed-users
npm run start:dev
```

`db:create` tạo database cấu hình nếu chưa có (cần quyền CREATEDB).
`db:migrate` cài cấu trúc tài khoản bằng migration 001 và bổ sung trường bằng 008;
không xóa dữ liệu hoặc đặt lại mật khẩu. Các phân hệ khác vẫn dùng migrations riêng.
`db:seed-users` chỉ thêm vai trò/tài khoản mẫu chưa tồn tại, mật khẩu mẫu `123456`.
Không chạy lại seeder SQL cũ `001_seed_initial_data.sql` để bảo toàn hồ sơ:
seeder cũ có câu lệnh ghi đè họ tên/mật khẩu khi trùng tài khoản.

Ứng dụng đọc và ghi tài khoản vào bảng `users` PostgreSQL, dùng UUID theo schema
hiện có. Nếu trước đây đăng nhập bằng tài khoản RAM có ID `usr-...`, cần đăng nhập
lại. Dữ liệu RAM của tiến trình đã tắt không thể tự khôi phục.

Không seed dữ liệu khi server khởi động. Database không truy cập được hoặc thiếu
migration làm khởi động thất bại; lỗi đọc/ghi lúc chạy trả về HTTP 503.
Map mẫu chỉ còn dùng cho các unit test khởi tạo `UsersService` trực tiếp, không
được sử dụng bởi ứng dụng NestJS chạy thật.

## API

- `GET /api/users/me`: đọc hồ sơ từ database theo người dùng trong JWT.
- `PATCH /api/users/me`: cập nhật `fullName` và/hoặc `phone`.
- Họ tên được trim, bắt buộc có nội dung nếu gửi lên, tối đa 100 ký tự.
- Điện thoại: số di động 10 chữ số bắt đầu 03/05/07/08/09 hoặc số cố định 11 chữ
  số bắt đầu 02; có thể dùng `+84` thay cho `0`, lưu chuẩn hóa về `0`.
- Không sửa username, email, mật khẩu, vai trò, kho, địa bàn qua API hồ sơ.
  Các trường ngoài DTO bị loại bỏ theo ValidationPipe hiện tại. Body không có
  trường cập nhật hoặc dữ liệu không hợp lệ trả HTTP 400.
- Câu UPDATE chỉ ghi trường được gửi lên; cập nhật tên và điện thoại đồng thời
  không ghi đè lẫn nhau. SQL sử dụng tham số bind.

## Phạm vi lưu bền vững

Tài khoản mới tạo, hồ sơ, mật khẩu, vai trò, trạng thái khóa, số lần đăng nhập sai,
mã đặt lại mật khẩu và đường dẫn avatar được lưu trong PostgreSQL. File avatar
vẫn nằm trong thư mục `uploads/avatars`, cần giữ thư mục này khi triển khai.
Refresh token, token quên mật khẩu và dữ liệu mô phỏng ở các phân hệ khác chưa
được chuyển sang database trong SN-17.

## Kiểm thử

```sh
npm run build
npm run test:profile
npm run test:profile:postgres
```

Test PostgreSQL cần cấu hình `.env` và quyền tạo database. Test tạo database riêng
`sn17_test_<uuid>`, khởi động server con, sửa hồ sơ, tắt tiến trình rồi khởi động
tiến trình mới để đăng nhập/đọc lại. Đồng thời kiểm tra cập nhật song song và lỗi
ghi database không làm đổi dữ liệu. Test xóa đúng database tạm trong `finally`,
không sửa tài khoản ở database ứng dụng.
