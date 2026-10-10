# NHẬT KÝ PHÁT TRIỂN HỆ THỐNG BÁN HÀNG & KHO (LOG.MD)

> **Dự án:** Hệ Thống Quản Lý Bán Hàng & Kho Doanh Nghiệp B2B  
> **Quy mô:** 8 Sprints (1 tuần/sprint, hạ tầng từ Sprint 1) | 76 User Stories | 350 Story Points  
> **Velocity mục tiêu:** 42 – 45 Story Points / Sprint  
> **Múi giờ chuẩn:** `Asia/Ho_Chi_Minh` (UTC+7) | **Ngôn ngữ hiển thị:** 100% Tiếng Việt  

---

## 1. NGUYÊN TẮC VẬN HÀNH & QUY TRÌNH TASK
1. **Đầu vào của mỗi Task:**
   - Luôn đọc file `log.md` để nắm bắt hiện trạng hệ thống, các module, entity, DTO và API đã hoàn thiện.
   - Đối chiếu quy chuẩn kỹ thuật (Strict TypeScript, Enum, ACID Transaction, Zero `any`).
2. **Đầu ra của mỗi Task:**
   - Cập nhật nhật ký vào `log.md` theo cấu trúc chuẩn:
     - Tên Task / User Story / Mã Jira
     - Danh sách file tạo mới / thay đổi (đường dẫn chi tiết)
     - Chi tiết kỹ thuật: Schema/Entity, DTOs, Endpoints, Business Logic, Locking/Transaction
     - Ghi chú kỹ thuật & lưu ý cho task tiếp theo.
3. **Quy tắc Code Convention:**
   - File & Thư mục: `kebab-case` 100% cho cả Backend và Frontend.
   - Biến & Hàm: `camelCase` (hàm bắt đầu bằng động từ).
   - Class, Component, DTO, Entity: `PascalCase`.
   - Hằng số & Enum: `UPPER_SNAKE_CASE` (tuyệt đối không dùng Magic Numbers/Strings).
   - TypeScript: **Strict mode - TUYỆT ĐỐI KHÔNG DÙNG `any`**.
   - Định dạng: Thụt lề 2 spaces, bắt buộc có Trailing Comma.
   - Hàm không quá 30–50 dòng, tuân thủ DRY & Single Responsibility.

---

## 2. BẢNG THEO DÕI TIẾN ĐỘ TỔNG THỂ (8 SPRINTS)

| Sprint | Mục tiêu chính / Epics trọng tâm | Story Points | Trạng thái | Ghi chú |
| :---: | :--- | :---: | :---: | :--- |
| **Sprint 1** | Khởi tạo hạ tầng, Auth & RBAC (EP-01), Danh mục Sản phẩm & Bảng giá cơ sở (EP-02) | ~44 | 🚀 Đang chuẩn bị | Khởi tạo khung dự án, JWT, 7 Roles |
| **Sprint 2** | Hoàn thiện Bảng giá đa cấp (EP-02), Quản lý Đại lý & Hạn mức nợ (EP-03) | ~45 | ⏳ Chưa bắt đầu | Bậc chiết khấu, tuyến bán hàng |
| **Sprint 3** | Multi-Warehouse, Danh mục Kho & Tồn kho 3 cột (EP-05) | ~44 | ⏳ Chưa bắt đầu | Thực tế - Giữ chỗ - Khả dụng |
| **Sprint 4** | Đặt hàng & Auto-Pricing, Kiểm tra hạn mức & Tồn kho real-time (EP-04) | ~45 | ⏳ Chưa bắt đầu | Core Epic, ACID Transaction, Locking |
| **Sprint 5** | Phê duyệt đơn hàng ngoại lệ (EP-04), Quản lý Lô & Hạn dùng, Soạn hàng FEFO (EP-06) | ~44 | ⏳ Chưa bắt đầu | Luồng duyệt nợ/giá, thuật toán FEFO |
| **Sprint 6** | Xuất kho, Phân chuyến giao hàng & POD (EP-06), Hóa đơn bán hàng (EP-07) | ~44 | ⏳ Chưa bắt đầu | Giao từng phần, sinh hóa đơn thực xuất |
| **Sprint 7** | Quản lý Thu tiền, Cấn trừ công nợ, Báo cáo Tuổi nợ Aging (EP-07), Trả hàng RMA (EP-08) | ~44 | ⏳ Chưa bắt đầu | Giảm trừ công nợ, đối soát |
| **Sprint 8** | Kiểm kê & Cân bằng kho (EP-08), Dashboard Quản trị & Báo cáo KPI, Tồn kho (EP-09) | ~40 | ⏳ Chưa bắt đầu | Write-off hàng hỏng, Dashboard real-time |

---

## 3. MA TRẬN 7 VAI TRÒ HỆ THỐNG (RBAC - DENY BY DEFAULT)

| Mã Vai Trò | Tên Vai Trò (Tiếng Việt) | Quyền hạn & Phạm vi cốt lõi |
| :--- | :--- | :--- |
| `ADMIN` | Quản trị hệ thống | Toàn quyền cấu hình, tài khoản, phân quyền, cấu hình hệ thống, Audit Log |
| `SALES_REP` | Nhân viên kinh doanh | Quản lý đại lý phụ trách, tạo đơn đặt hàng, xem tồn khả dụng, theo dõi giao hàng |
| `SALES_MANAGER` | Quản lý kinh doanh | Phê duyệt đơn vượt hạn mức/chiết khấu đặc biệt, xem COGS/biên lợi nhuận, giao KPI |
| `WAREHOUSE_KEEPER` | Thủ kho | Nhập kho, chuyển kho, soạn hàng FEFO theo picking list, xác nhận xuất kho |
| `WAREHOUSE_MANAGER` | Quản lý kho | Duyệt phiếu kiểm kê, phê duyệt write-off hàng hỏng, quản lý đa kho & định mức tồn |
| `ACCOUNTANT` | Kế toán | Quản lý hạn mức công nợ, hóa đơn, phiếu thu, đối soát & báo cáo tuổi nợ (Aging) |
| `CUSTOMER` | Đại lý (B2B) | Đặt hàng portal, theo dõi trạng thái đơn hàng, tra cứu công nợ & lịch sử mua |

---

## 4. QUY CHUẨN KIẾN TRÚC KỸ THUẬT

### A. Backend (NestJS + TypeScript)
```
src/
├── common/             # Guards (JwtAuthGuard, RolesGuard), Interceptors, Exception Filters, Decorators
├── config/             # Environment configs (database, jwt, mailer)
└── modules/            # Feature-Module Architecture
    ├── auth/           # JWT, Refresh Token, Password Reset
    ├── users/          # Quản lý tài khoản, hồ sơ, phân quyền RBAC
    ├── products/       # SKU, đơn vị quy đổi, danh mục cây
    ├── price-books/    # Bảng giá sỉ/lẻ, ma trận chiết khấu theo SL
    ├── customers/      # Hồ sơ đại lý, hạn mức nợ, địa điểm giao
    ├── orders/         # Đặt hàng, duyệt ngoại lệ, auto-pricing
    ├── warehouses/     # Đa kho, nhà cung cấp, tồn kho 3 cột
    ├── inventory/      # Nhập/chuyển kho, Lot/Batch, HSD, FEFO
    ├── deliveries/     # Soạn hàng, chuyến giao, POD
    ├── invoices/       # Hóa đơn, thanh toán, sổ nợ, aging report
    ├── returns/        # RMA trả hàng, điều chỉnh công nợ
    └── reports/        # KPI, Dashboard chỉ số real-time
```
- **Xử lý lỗi:** Không sử dụng try-catch tùy tiện trong Controller; giao Exception Filters toàn cục xử lý.
- **Tính toàn vẹn dữ liệu:** Tồn kho (Thực tế, Giữ chỗ, Khả dụng) và Công nợ luôn chạy trong Database Transaction (ACID) có Pessimistic/Optimistic Lock. Mọi biến động quy đổi về đơn vị nhỏ nhất (Base Unit).

### B. Frontend (React + TypeScript + Vite)
```
src/
├── components/         # Reusable UI components (Input, Button, Toast, Modal...) - Không gọi API trực tiếp
├── pages/              # Màn hình chức năng hoàn chỉnh gắn với React Router
├── layouts/            # Layouts chuẩn (DashboardLayout, AuthLayout) kèm Dynamic Sidebar theo RBAC
├── services/           # Gọi API tập trung bằng Axios (Try-catch xử lý Toast/Alert, mapping DTO)
├── types/              # Type/Interface đồng bộ chuẩn với Backend
├── hooks/              # Custom hooks nghiệp vụ và giao diện
└── utils/              # Helper functions (format currency VNĐ, date-time UTC+7, base-unit calculation)
```

---

## 5. NHẬT KÝ CHI TIẾT TỪNG TASK (TASK EXECUTION LOGS)

<!-- 
MẪU GHI NHẬT KÝ TASK (BẮT BUỘC SỬ DỤNG CHO MỌI TASK HOÀN THÀNH):

### [Sprint X] - [MÃ_TASK/US]: <Tên Task / Chức năng>
- **Thời gian hoàn thành:** YYYY-MM-DD
- **Mã Jira / US:** US-XX
- **Danh sách file thay đổi / tạo mới:**
  - `path/to/file-name.ts` (Tạo mới/Cập nhật)
- **Chi tiết kỹ thuật:**
  - *Schema / Migration:* Cấu trúc bảng, quan hệ, index.
  - *DTOs & Validation:* Các DTO request/response, validation rules.
  - *Endpoints / Service Logic:* Danh sách API method, routing, xử lý transaction/locking.
  - *Frontend Integration (nếu có):* Component, state, routing, UI interactions.
- **Ghi chú kỹ thuật & Lưu ý cho task kế tiếp:**
  - Các ràng buộc cần chú ý, biến môi trường hoặc các module liên đới.
-->

### [Sprint 1] - SETUP-01: Khởi tạo Cấu trúc & Quy chuẩn Dự án (Project Kickoff)
- **Thời gian hoàn thành:** 2026-10-01
- **Mã Jira / US:** SETUP-01
- **Danh sách file thay đổi / tạo mới:**
  - [`log.md`](./log.md) (Tạo mới khung quản trị tiến độ dự án)
- **Chi tiết kỹ thuật:**
  - Nắm bắt và thiết lập quy chuẩn cho toàn bộ 8 Sprint (76 US, 350 SP).
  - Định hình cấu trúc Feature-Module cho Backend (NestJS) và Clean UI/Service cho Frontend (React).
  - Thiết lập quy tắc kiểm soát kiểu dữ liệu nghiêm ngặt (Strict TypeScript, Enum, Base Unit, ACID Transaction).
  - Xác lập bảng ma trận 7 vai trò người dùng (RBAC - deny by default).
- **Ghi chú kỹ thuật & Lưu ý cho task kế tiếp:**
  - Chuẩn bị bước vào Sprint 1: Thiết lập cấu trúc hạ tầng NestJS cho Backend và hoàn thiện layout phân quyền động (Dynamic Role-based Sidebar) cho Frontend.

### [Sprint 1] - SETUP-02: Khởi tạo Cấu trúc Dự án NestJS theo mô hình Feature-Module
- **Thời gian hoàn thành:** 2026-10-01
- **Mã Jira / US:** SETUP-02
- **Mục tiêu:** Khởi tạo cấu trúc dự án NestJS theo mô hình Feature-Module, bao quát 9 Epics của hệ thống, chuẩn hóa theo Code Convention (Strict TypeScript, 100% `kebab-case`, Zero `any`).
- **Danh sách file thay đổi / tạo mới:**
  - `src/config/`: `app.config.ts`, `database.config.ts`, `jwt.config.ts`, `index.ts`
  - `src/common/decorators/`: `current-user.decorator.ts`, `roles.decorator.ts`, `public.decorator.ts`, `index.ts`
  - `src/common/guards/`: `jwt-auth.guard.ts`, `roles.guard.ts`, `index.ts`
  - `src/common/interceptors/`: `logging.interceptor.ts`, `transform.interceptor.ts`, `index.ts`
  - `src/common/filters/`: `http-exception.filter.ts`, `all-exceptions.filter.ts`, `index.ts`
  - `src/common/constants/`: `app.constant.ts`, `index.ts`
  - `src/common/enums/`: `user-role.enum.ts`, `order-status.enum.ts`, `index.ts`
  - `src/common/interfaces/`: `api-response.interface.ts`, `pagination.interface.ts`, `index.ts`
  - `src/database/`: `database.config.ts`, `index.ts`, `migrations/.gitkeep`, `seeders/.gitkeep`
  - `src/modules/` (12 modules: `auth`, `users`, `products`, `price-books`, `customers`, `orders`, `inventory`, `shipments`, `invoices`, `returns`, `reports`, `audit-logs`):
    - Mỗi module bao gồm `dto/.gitkeep`, `entities/.gitkeep`, `<ten-module>.controller.ts`, `<ten-module>.service.ts`, `<ten-module>.module.ts`
  - `src/app.module.ts`: Root module kết nối 12 feature modules
  - `src/main.ts`: Khung khởi động NestJS Application
- **Chi tiết kỹ thuật:**
  - Tổ chức cấu trúc phân lớp rõ ràng: Configuration, Common Cross-cutting Concerns (Guards, Decorators, Interceptors, Filters, Enums, Interfaces), Database và Feature Modules.
  - 100% tên file và thư mục tuân thủ nghiêm ngặt quy tắc `kebab-case`.
  - Bộ khung mã nguồn sạch, typed tường minh, không sử dụng `any`, thụt lề 2 spaces kèm trailing commas.
- **Trạng thái & Lưu ý cho task kế tiếp:**
  - ✅ Hoàn thành khởi tạo khung cấu trúc mã nguồn Backend.
  - 🚀 Sẵn sàng cho Sprint 1: Bắt đầu triển khai chi tiết cho các module cốt lõi đầu tiên (`auth` và `users`).

### [Sprint 1] - SN-109: [BE] API Đăng nhập, Xác thực JWT & Logic Khóa Tài Khoản (US: SN-1 / S1-01)
- **Thời gian hoàn thành:** 2026-10-01
- **Mã Jira / US:** SN-109 (User Story SN-1 / S1-01 - Sprint 1)
- **Trạng thái:** ✅ Hoàn thành (Đã kiểm thử unit test logic toàn bộ các ca thành công, nhập sai, khóa 15 phút, chống timing attack)
- **Danh sách file tạo mới / thay đổi:**
  - `src/common/enums/user-role.enum.ts`: Bổ sung đầy đủ 7 vai trò chuẩn và alias (`ADMIN`, `SALES_REP`, `SALES_MANAGER`, `WAREHOUSE`, `WAREHOUSE_KEEPER`, `WH_MANAGER`, `WAREHOUSE_MANAGER`, `ACCOUNTANT`, `CUSTOMER`).
  - `src/common/enums/user-status.enum.ts`: Tạo Enum trạng thái tài khoản (`ACTIVE`, `LOCKED`, `INACTIVE`).
  - `src/common/enums/index.ts`: Export tập trung các Enums.
  - `src/common/constants/auth.constant.ts`: Định nghĩa các hằng số không dùng magic numbers (`MAX_FAILED_LOGIN_ATTEMPTS = 5`, `LOCK_TIME_MINUTES = 15`, `LOCK_TIME_MS`, `BCRYPT_SALT_ROUNDS = 10`, `AUTH_ERROR_MESSAGES`).
  - `src/modules/users/entities/user.entity.ts`: User Entity với các trường bảo mật (`id`, `email`, `username`, `fullName`, `passwordHash`, `role`, `status`, `failedAttempts`, `lockedUntil`).
  - `src/modules/users/users.service.ts`: Quản lý danh sách tài khoản, seed sẵn 7 tài khoản test chuẩn hóa với mật khẩu `123456`, cập nhật và reset `failedAttempts`, `lockedUntil`.
  - `src/modules/users/users.module.ts`: Export `UsersService` cho `AuthModule`.
  - `src/modules/auth/dto/login.dto.ts`: DTO kiểm tra đầu vào email/username, mật khẩu (ràng buộc `class-validator`).
  - `src/modules/auth/dto/login-response.dto.ts`: DTO phản hồi trả về `accessToken`, `refreshToken` và `SafeUser` (tuyệt đối loại bỏ `passwordHash`).
  - `src/modules/auth/interfaces/jwt-payload.interface.ts`: Interface định kiểu payload JWT (`sub`, `email`, `role`).
  - `src/modules/auth/jwt.strategy.ts`: Passport JWT Strategy trích xuất Bearer token và xác thực request context an toàn.
  - `src/modules/auth/auth.service.ts`: Xử lý 4 bước xác thực, băm bcrypt, đếm sai -> khóa 15p, chống timing attack và user enumeration.
  - `src/modules/auth/auth.controller.ts`: Endpoint `POST /auth/login` chuẩn RESTful, trả HTTP 200 OK.
  - `src/modules/auth/auth.module.ts`: Đóng gói `PassportModule`, `JwtModule`, `UsersModule`.
  - `src/common/guards/jwt-auth.guard.ts`: Guard tích hợp Passport JWT.
  - `src/common/filters/http-exception.filter.ts`: Exception filter chuẩn hóa cấu trúc lỗi trả về cho client.
  - `src/config/jwt.config.ts`: Cấu hình secret và thời hạn token (`expiresIn: 3600`, `refreshExpiresIn: 604800`).
  - `package.json`, `tsconfig.json`, `.gitignore`: Khởi tạo môi trường NestJS đầy đủ dependency.
- **Chi tiết kỹ thuật & Nghiệp vụ bảo mật:**
  - *Endpoint:* `POST /api/v1/auth/login` (Body: `{ email, password }` hoặc `{ username, password }`).
  - *Bước 1 (Kiểm tra khóa tạm):* Nếu `lockedUntil > now`, chặn ngay và trả thông báo: `"Tài khoản tạm thời bị khóa do nhập sai nhiều lần. Vui lòng thử lại sau 15 phút."`. Nếu đã hết 15 phút, tự động reset `failedAttempts = 0`, `lockedUntil = null`.
  - *Bước 2 (Xác thực mật khẩu):* So khớp mật khẩu với `passwordHash` bằng `bcrypt.compare`.
  - *Bước 3 (Xử lý khi sai):*
    - Khi sai: tăng `failedAttempts += 1`.
    - Nếu `failedAttempts >= 5`: kích hoạt khóa 15 phút (`lockedUntil = now + 15m`).
    - An toàn thông tin: Luôn trả thông báo chung `"Tài khoản hoặc mật khẩu không chính xác"`, thực hiện so sánh dummy hash khi email không tồn tại nhằm ngăn chặn timing attack và user enumeration.
  - *Bước 4 (Xử lý khi đúng):*
    - Reset `failedAttempts = 0`, `lockedUntil = null`.
    - Ký và phát hành `accessToken` (1 giờ) và `refreshToken` (7 ngày).
    - Trả về đối tượng `SafeUser` (tuyệt đối không để lộ hash mật khẩu).
- **Ghi chú kỹ thuật & Lưu ý cho task kế tiếp:**
  - Biên dịch TypeScript (`tsc --noEmit`): Đạt 0 lỗi, 100% Type-safe (Zero `any`).
  - Tất cả các file/thư mục tuân thủ nghiêm ngặt `kebab-case`.
  - Đã tích hợp sẵn 7 tài khoản test chuẩn nghiệp vụ (mật khẩu chung: `123456`) tương thích hoàn toàn với frontend.
  - Sẵn sàng chuyển tiếp sang task **SN-110** (Refresh Token & Cơ chế gia hạn phiên tự động) hoặc Guard phân quyền chi tiết (RolesGuard).

### [Sprint 1] - HOTFIX-01: Sửa Lỗi Khóa Tài Khoản Bền Vững Qua Reload Trang (Persistence Lockout)
- **Thời gian hoàn thành:** 2026-10-01
- **Vấn đề đã xử lý:** Trước đó, số lần nhập sai và trạng thái khóa 15 phút được lưu tạm trong bộ nhớ RAM (In-memory Map) của trình duyệt ở client service, dẫn đến khi người dùng ấn F5 / reload lại trang web thì bộ đếm bị giải phóng, cho phép nhập lại mật khẩu đúng để vào hệ thống.
- **Giải pháp kỹ thuật:**
  - Thay thế biến tạm `Map` bằng cơ chế lưu trữ bền vững `localStorage` (`STORAGE_LOCK_PREFIX = 'loha_failed_attempts_'`).
  - Kiểm tra `lockedUntil > Date.now()` ngay tại bước đầu tiên của hàm `login()` trước khi xử lý bất kỳ logic xác thực nào.
  - Cho dù người dùng reload trang, tắt tab hoặc mở lại trình duyệt, trạng thái khóa vẫn được duy trì kiên quyết đủ 15 phút.
  - Sau khi hết thời gian 15 phút, hệ thống tự động cho phép thử lại và xóa khóa khi đăng nhập thành công.
- **File cập nhật:**
  - [`HTBH_Frontend/src/services/auth.service.ts`](file:///d:/D%E1%BB%B1%20%C3%A1n%20TTCS/HTBH_Frontend/src/services/auth.service.ts)

### [Sprint 1] - [SN-112]: API Refresh Token, Blacklist & Revoke Session khi Logout
- **Thời gian hoàn thành:** 2026-10-01
- **Mã Jira / US:** SN-112 (Parent: SN-7 / S1-02: Duy trì phiên đăng nhập & đăng xuất an toàn)
- **Mục tiêu:** Cung cấp cơ chế duy trì phiên đăng nhập an toàn với API Refresh Token (Refresh Token Rotation), thu hồi session và đưa token vào Blacklist khi đăng xuất.
- **Danh sách file thay đổi / tạo mới:**
  - `src/modules/auth/constants/auth.constant.ts` (Tạo mới: Hằng số token, thời hạn, thông báo lỗi/thành công)
  - `src/modules/auth/interfaces/jwt-payload.interface.ts` (Tạo mới: Typed JWT payload với sub, roles, jti)
  - `src/modules/auth/interfaces/current-user.interface.ts` (Tạo mới: Typed User context cho request)
  - `src/modules/auth/entities/refresh-token.entity.ts` (Tạo mới: Entity lưu phiên refresh token và trạng thái revoked)
  - `src/modules/auth/dto/login.dto.ts` (Tạo mới: Request DTO đăng nhập)
  - `src/modules/auth/dto/refresh-token.dto.ts` (Tạo mới: Request DTO refresh token)
  - `src/modules/auth/dto/logout.dto.ts` (Tạo mới: Request DTO logout)
  - `src/modules/auth/dto/token-response.dto.ts` (Tạo mới: Response DTO cho token và logout)
  - `src/modules/auth/dto/index.ts` (Tạo mới: Barrel export DTO)
  - `src/modules/auth/strategies/jwt.strategy.ts` (Tạo mới: Passport Strategy xác thực Bearer token)
  - `src/common/guards/jwt-auth.guard.ts` (Cập nhật: Guard kế thừa AuthGuard('jwt') hỗ trợ @Public())
  - `src/common/decorators/public.decorator.ts` (Cập nhật: Decorator @Public() đánh dấu route công khai)
  - `src/common/decorators/current-user.decorator.ts` (Cập nhật: Decorator @CurrentUser() trích xuất thông tin user)
  - `src/config/jwt.config.ts` (Cập nhật: Cấu hình secret và thời hạn token chuẩn StringValue)
  - `src/modules/auth/auth.service.ts` (Cập nhật: Business logic Refresh Token Rotation, Blacklist và Revoke Session)
  - `src/modules/auth/auth.controller.ts` (Cập nhật: Endpoints /auth/login, /auth/refresh, /auth/logout, /auth/me)
  - `src/modules/auth/auth.module.ts` (Cập nhật: Tích hợp PassportModule, JwtModule, JwtStrategy, JwtAuthGuard)
  - `test/auth-refresh-logout.spec.ts` (Tạo mới: Integration test suite đạt 13/13 test cases pass)
- **Chi tiết kỹ thuật:**
  - *Endpoints*:
    - `POST /api/auth/login`: Cấp cặp Access Token (1h) & Refresh Token (7d) theo thông tin xác thực.
    - `POST /api/auth/refresh`: Nhận `refreshToken`, kiểm tra Blacklist O(1), giải mã chữ ký, thu hồi token cũ và phát hành cặp Access Token & Refresh Token mới (Refresh Token Rotation chống Replay Attack).
    - `POST /api/auth/logout`: Thu hồi token, đánh dấu `isRevoked: true` và đưa vào Blacklist O(1), ngăn chặn triệt để tái sử dụng token.
    - `GET /api/auth/me`: Protected route trích xuất thông tin tài khoản qua `@CurrentUser()`.
  - *Data Contract*: Khớp 100% với Frontend (`accessToken`, `tokenType: 'Bearer'`, `refreshToken`, `message`, `user`).
  - *Code Convention*: 100% `kebab-case`, Zero `any`, TypeScript Strict Mode, không Magic Strings/Numbers.
- **Trạng thái & Lưu ý cho task kế tiếp:**
  - ✅ Hoàn thành 100% yêu cầu Subtask SN-112, 13/13 test cases pass.
  - 🚀 Sẵn sàng cho các task tiếp theo của Sprint 1 (RBAC Roles Guard chi tiết theo 7 vai trò, Module Users/Quản lý tài khoản).

### [Sprint 1] - [SN-144]: Xây Dựng API Upload Ảnh Đại Diện (Avatar Upload)
- **Thời gian hoàn thành:** 2026-10-02
- **Mã Jira / US:** SN-144 (Parent: SN-18 - Upload ảnh đại diện)
- **Mục tiêu:** Xây dựng API tải lên và cập nhật ảnh đại diện người dùng, kiểm duyệt nghiêm ngặt định dạng (JPG/PNG), giới hạn dung lượng tối đa 2MB, sinh tên file ngẫu nhiên duy nhất tránh trùng lặp/lộ tên gốc, lưu trữ tại thư mục cục bộ phục vụ static file và tự động dọn dẹp ảnh cũ.
- **Danh sách file thay đổi / tạo mới:**
  - `src/modules/users/constants/avatar.constant.ts` (Tạo mới: Hằng số `MAX_AVATAR_SIZE = 2MB`, `ALLOWED_AVATAR_MIME_TYPES`, `ALLOWED_AVATAR_EXTENSIONS`, thông báo lỗi chuẩn)
  - `src/modules/users/dto/avatar-response.dto.ts` (Tạo mới: DTO phản hồi trả về `statusCode`, `message`, `data: { avatarUrl }`)
  - `src/modules/users/dto/index.ts` (Cập nhật: Barrel export `AvatarResponseDto`)
  - `src/modules/users/decorators/uploaded-avatar-file.decorator.ts` (Tạo mới: Custom Decorator `@UploadedAvatarFile()` trích xuất linh hoạt file từ form-data với trường `file` hoặc `avatar`)
  - `src/modules/users/pipes/avatar-validation.pipe.ts` (Tạo mới: Validation Pipe kiểm tra bắt buộc có file, dung lượng <= 2MB, định dạng chuẩn JPG/PNG)
  - `src/modules/users/entities/user.entity.ts` (Cập nhật: Bổ sung trường `avatarUrl` vào `SafeUser` và `UserEntity`, hỗ trợ `toSafeUser()`)
  - `src/modules/auth/interfaces/current-user.interface.ts` (Cập nhật: Thêm `avatarUrl` vào `ICurrentUser`)
  - `src/modules/auth/strategies/jwt.strategy.ts` (Cập nhật: Trích xuất `avatarUrl` đồng bộ vào `req.user` khi giải mã token)
  - `src/modules/users/users.service.ts` (Cập nhật: Thêm hàm `uploadAvatar` ghi đĩa, dọn dẹp file cũ trên server và cập nhật DB; thêm hàm `removeAvatar`)
  - `src/modules/users/users.controller.ts` (Cập nhật: Thêm route `POST /api/users/me/avatar` và `DELETE /api/users/me/avatar` cho cả 7 vai trò người dùng)
  - `src/modules/auth/auth.controller.ts` (Cập nhật: Thêm route `POST /api/auth/avatar` alias thuận tiện cho frontend)
  - `src/common/decorators/current-user.decorator.ts` (Cập nhật: Bổ sung kiểu `null` cho return type decorator)
  - `src/common/filters/http-exception.filter.ts` (Cập nhật: Bắt và chuẩn hóa `MulterError` về HTTP 400 Bad Request)
  - `src/main.ts` (Cập nhật: Đảm bảo thư mục `uploads/avatars` luôn tồn tại và cấu hình `app.useStaticAssets` phục vụ static file tại `/uploads/` & `/api/uploads/`)
  - `.gitignore` (Cập nhật: Bỏ qua các file ảnh upload thực tế nhưng giữ nguyên thư mục qua `.gitkeep`)
  - `uploads/avatars/.gitkeep` (Tạo mới: Giữ thư mục uploads/avatars trên Git)
  - `test/avatar-upload-sn144.spec.ts` (Tạo mới: Test suite tích hợp kiểm thử toàn diện 20/20 test cases pass)
- **Chi tiết kỹ thuật:**
  - *Endpoints:*
    - `POST /api/users/me/avatar` & `POST /api/auth/avatar`: Protected bởi `JwtAuthGuard`, nhận `multipart/form-data` chứa trường `file` hoặc `avatar`.
    - `DELETE /api/users/me/avatar`: Xóa ảnh đại diện cá nhân và xóa file vật lý trên đĩa.
  - *Cơ chế Validation:*
    - File bắt buộc: Nếu không đính kèm file ném `BadRequestException('Vui lòng chọn file ảnh để tải lên.')`.
    - Định dạng: Chỉ chấp nhận `image/jpeg`, `image/png` (đuôi `.jpg`, `.jpeg`, `.png`), nếu sai ném `BadRequestException('Chỉ chấp nhận file ảnh định dạng JPG hoặc PNG')`.
    - Dung lượng: Tối đa 2MB (`2,097,152 bytes`), nếu vượt quá ném `BadRequestException('Dung lượng ảnh không được vượt quá 2MB')`.
  - *Lưu trữ & Bảo mật:*
    - Tên file sinh ngẫu nhiên theo công thức `avatar-${userId}-${Date.now()}-${randomHash}${ext}` để tránh trùng lặp, chống lộ tên file gốc nhạy cảm và chống browser caching sai lệch.
    - Tự động kiểm tra và xóa file avatar cũ trên đĩa cứng trước khi gán avatar mới nhằm giải phóng bộ nhớ lưu trữ server.
    - Cập nhật trường `avatarUrl` dạng URL tương đối `/uploads/avatars/xxxx.png`, đồng bộ vào `SafeUser` và session của user.
  - *Phân quyền RBAC:*
    - Route `me/avatar` áp dụng `@Roles(...Object.values(UserRole))` cho phép tất cả 7 vai trò người dùng (ADMIN, SALES_REP, SALES_MANAGER, WAREHOUSE_KEEPER, WAREHOUSE_MANAGER, ACCOUNTANT, CUSTOMER) đều được quyền cập nhật ảnh đại diện của chính mình.
- **Trạng thái & Lưu ý cho task kế tiếp:**
  - ✅ Hoàn thành 100% yêu cầu Subtask SN-144, 20/20 test cases pass, 0 lỗi biên dịch TypeScript.
  - 🚀 Sẵn sàng tích hợp sang Frontend (gọi API upload ảnh đại diện).

### [Sprint 1] - [SN-144 / SN-145 Hotfix]: Đồng Bộ Data Contract Upload Avatar & Bảo Toàn Profile State
- **Thời gian hoàn thành:** 2026-10-03
- **Mã Jira / US:** SN-144, SN-145 (Parent: SN-18 - Upload ảnh đại diện)
- **Vấn đề xử lý:** Khắc phục lỗi mất thông tin người dùng (Họ tên, Email, Role hiển thị `—`) sau khi upload avatar thành công do ghi đè state; khắc phục lỗi 404 khi F5/reload trang do thiếu route `GET /api/users/me`; khắc phục lỗi hiển thị ảnh do thiếu proxy `/uploads` ở Vite.
- **Danh sách file thay đổi:**
  - *Backend:*
    - `src/modules/auth/dto/token-response.dto.ts`: Bổ sung `avatarUrl?: string | null` vào `IAuthUserInfo`.
    - `src/modules/auth/auth.service.ts`: Gán `avatarUrl` trong `userInfo` khi login và refresh token.
    - `src/modules/auth/auth.controller.ts`: Endpoint `GET /api/auth/me` trả về `SafeUser` đầy đủ từ database qua `findSafeById`.
    - `src/modules/users/users.controller.ts`: Thêm route `GET /api/users/me` trước `:id` trả về `SafeUser` của người dùng hiện tại.
  - *Frontend:*
    - `src/services/users.service.ts`: Định nghĩa interface `AvatarUploadResponse` chuẩn theo DTO của Backend, sửa return type của `uploadAvatar`.
    - `src/utils/avatar.ts`: Tạo mới tiện ích `resolveAvatarUrl()` chuẩn hóa đường dẫn tương đối `/uploads/...` thành URL backend hợp lệ.
    - `src/pages/profile-page.tsx`: Áp dụng Merge state bảo toàn thông tin `user` sau khi upload và khi fetch profile; dùng `resolveAvatarUrl` cho thẻ `<img>`.
    - `src/layouts/header.tsx`: Dùng `resolveAvatarUrl(avatarUrl)` cho thẻ `<img>` avatar ở Header.
    - `src/components/avatar-upload-modal.tsx`: Dùng `resolveAvatarUrl` cho thumbnail preview hiện tại.
    - `vite.config.ts`: Bổ sung proxy `/uploads` trỏ về backend `http://localhost:3000`.
- **Trạng thái:**
  - ✅ Type-check và Build thành công 100% ở cả Backend (`nest build`) và Frontend (`tsc -b && vite build`), 0 lỗi biên dịch.
  - ✅ Sẵn sàng kiểm thử giao diện thực tế.

### [Sprint 1] - [SN-145 Extension]: Đồng Bộ Hiển Thị Avatar Toàn Diện (Sidebar & Bảng Quản Lý Người Dùng)
- **Thời gian hoàn thành:** 2026-10-03
- **Mã Jira / US:** SN-145 (Parent: SN-18 - Upload ảnh đại diện)
- **Vấn đề xử lý:** Khắc phục tình trạng Sidebar User Widget góc dưới bên trái vẫn hiển thị avatar chữ cái mặc định ("N") sau khi đổi ảnh; khắc phục Bảng Quản lý Người dùng (`/users`) luôn hiển thị chữ cái cho tất cả nhân sự thay vì hiển thị ảnh đại diện thật của đồng nghiệp/bản thân.
- **Danh sách file thay đổi:**
  - `src/types/user.ts`: Bổ sung `avatarUrl?: string | null` vào interface `UserManagementItem`.
  - `src/layouts/sidebar.tsx`: Lắng nghe sự kiện `avatar-updated` và `storage`, hiển thị ảnh đại diện với `resolveAvatarUrl()`, bổ sung click chuyển nhanh tới `/profile`.
  - `src/pages/users-page.tsx`: Cột Nhân sự kiểm tra và render ảnh đại diện qua `resolveAvatarUrl()` (kèm fallback chữ cái), tự động fetch lại danh sách khi có sự kiện đổi avatar.
- **Trạng thái:**
  - ✅ Build Frontend và Backend thành công 100%, 0 lỗi TypeScript.
  - ✅ Đảm bảo tính nhất quán trên toàn bộ ứng dụng (Header, Sidebar, Profile, User Table).

### [Sprint 1] - [PERSISTENCE-01]: Cấu Hình Bền Vững Dữ Liệu Avatar Khi Restart Server
- **Thời gian hoàn thành:** 2026-10-03
- **Mã Jira / US:** Yêu cầu ngoài sprint (Persistence Configuration)
- **Vấn đề xử lý:**
  - Backend sử dụng **In-memory Map** làm nơi lưu trữ tạm thời (chưa kết nối PostgreSQL thực sự qua TypeORM).
  - Khi restart server (`nest start --watch`), toàn bộ dữ liệu user bao gồm `avatarUrl` bị mất vì seed function khởi tạo lại Map với `avatarUrl: null`.
  - Tuy nhiên, file ảnh avatar vật lý vẫn tồn tại bền vững trên đĩa tại `uploads/avatars/` (nằm ngoài `dist/`, dùng `process.cwd()`).
- **Giải pháp kỹ thuật:**
  - Thêm hàm `restoreAvatarsFromDisk()` vào `UsersService`, được gọi tự động sau `seedInitialUsersSync()`.
  - Hàm này quét thư mục `uploads/avatars/`, parse tên file theo pattern `avatar-{userId}-{timestamp}-{hash}.{ext}`, match userId với Map hiện tại.
  - Nếu 1 user có nhiều file avatar (do upload nhiều lần), chọn file mới nhất dựa trên `mtime` (thời gian chỉnh sửa cuối).
  - Gán lại `avatarUrl` cho user entity trong Map, đảm bảo avatar hiển thị đúng ngay khi server khởi động lại.
- **Kiểm tra cấu hình khác:**
  - ✅ `synchronize: false` đã được đặt đúng trong `src/database/database.config.ts`.
  - ✅ `main.ts` sử dụng `process.cwd()` cho static assets (ngoài `dist/`), không có seed function ở bootstrap.
  - ✅ `.gitignore` đã cấu hình đúng: `uploads/*` + `!uploads/**/.gitkeep`.
  - ✅ `.gitkeep` tồn tại ở cả `uploads/` và `uploads/avatars/`.
- **Danh sách file thay đổi:**
  - `src/modules/users/users.service.ts`: Thêm hàm `restoreAvatarsFromDisk()` và gọi trong `seedInitialUsersSync()`.
  - `uploads/.gitkeep`: Tạo mới.
- **Trạng thái:**
  - ✅ Build Backend (`nest build`) thành công, 0 lỗi biên dịch.
  - ✅ Avatar đã upload sẽ tự động khôi phục khi restart server dev.
  - ⚠️ **Lưu ý quan trọng:** Backend hiện dùng In-memory Map, nghĩa là dữ liệu user khác (password đã đổi, status, v.v.) vẫn bị reset về seed mặc định khi restart. Cần migrate sang PostgreSQL + TypeORM trong các sprint tiếp theo để đảm bảo persistence hoàn toàn.

---

### [Sprint 1] - [SN-147]: BE: Xây dựng API xử lý tệp Excel, validate dữ liệu từng dòng, tạo tài khoản hàng loạt và trả về báo cáo tổng kết.
- **Thời gian hoàn thành:** 2026-10-03
- **Mã Jira / Task:** `SN-147`
- **Dự án / Space:** `SOFTWARE N3`
- **Parent Epic / US:** `SN-16` (Import Excel)
- **Tiêu đề công việc:** BE: Xây dựng API xử lý tệp Excel, validate dữ liệu từng dòng, tạo tài khoản hàng loạt và trả về báo cáo tổng kết.
- **Trạng thái:** ✅ Hoàn thành 100% (Biên dịch TypeScript `tsc --noEmit` 0 lỗi, 22/22 Test Cases Jest PASS, tuân thủ 100% `CODE_CONVENTION.docx`).
- **Mục tiêu:** Xây dựng API nhận file Excel (.xlsx / .xls), trích xuất dữ liệu vào bộ nhớ đệm (memory buffer), thẩm định (validate) từng dòng độc lập bằng `class-validator`, tạo tài khoản nhân sự hàng loạt, hash mật khẩu bảo mật, phân bổ kho theo quy chuẩn RBAC, cách ly lỗi (lỗi một dòng không làm gián đoạn toàn bộ batch) và xuất báo cáo tổng kết chi tiết từng dòng (thành công/thất bại kèm nguyên nhân).

#### 📁 1. Danh sách file tạo mới / thay đổi:

| File | Hành động | Mô tả chi tiết |
|:---|:---:|:---|
| `src/modules/users/constants/excel-import.constant.ts` | **Tạo mới** | Hằng số cấu hình import: Dung lượng tối đa (`5MB`), số dòng tối đa (`500`), MIME types (`.xlsx`, `.xls`), header bắt buộc, thông báo lỗi chuẩn hóa |
| `src/modules/users/dto/excel-user-row.dto.ts` | **Tạo mới** | DTO thẩm định dữ liệu từng dòng qua `class-validator`: `@IsNotEmpty`, `@IsEmail`, `@Length`, `@Matches` |
| `src/modules/users/dto/import-users-report.dto.ts` | **Tạo mới** | DTO phản hồi báo cáo kết quả tổng kết (`ImportUsersReportDto`, `ImportRowResult`, từ điển ánh xạ alias tiếng Việt `ROLE_ALIAS_MAP`) |
| `src/modules/users/excel-import.service.ts` | **Tạo mới** | Service nghiệp vụ lõi: Đọc buffer Excel (`xlsx`), validate độc lập từng dòng, ủy quyền tạo user cho `UsersService.create()`, cách ly lỗi, ghi log và tổng hợp báo cáo |
| `src/modules/users/dto/index.ts` | **Cập nhật** | Barrel export xuất bản `ExcelUserRowDto`, `ImportUsersReportDto`, `ImportRowResult` |
| `src/modules/users/users.controller.ts` | **Cập nhật** | Thêm endpoint `POST /api/users/import-excel`, cấu hình `FileInterceptor('file')`, phân quyền `@Roles(UserRole.ADMIN)` |
| `src/modules/users/users.module.ts` | **Cập nhật** | Đăng ký `ExcelImportService` vào `providers` và `exports` của module |
| `test/excel-import-sn147.spec.ts` | **Tạo mới** | Bộ kiểm thử tích hợp Jest với **22 test cases** bao phủ 7 kịch bản từ validation file đến batch processing |
| `package.json` | **Cập nhật** | Thêm devDependencies Jest (`jest`, `ts-jest`, `@types/jest`), cấu hình script `npm test`, `npm run test:watch`, `npm run test:cov` |
| `log.md` | **Cập nhật** | Ghi nhật ký tiến độ chi tiết, rõ ràng cho task SN-147 |

---

#### 🔌 2. Đặc tả Endpoint API:

- **Method & URL:** `POST /api/users/import-excel`
- **Xác thực & Phân quyền:** Bearer Token JWT, chỉ cấp quyền cho vai trò Quản trị viên (`@Roles(UserRole.ADMIN)`).
- **Content-Type:** `multipart/form-data`
- **Form-data Field:** `file` (File Excel có đuôi `.xlsx` hoặc `.xls`, dung lượng tối đa 5MB, tối đa 500 dòng).

**Response Thành Công (HTTP 200 OK):**
```json
{
  "statusCode": 200,
  "message": "Import hoàn tất: Tạo thành công 47 tài khoản, 3 dòng thất bại.",
  "data": {
    "totalRows": 50,
    "successCount": 47,
    "failedCount": 3,
    "results": [
      {
        "row": 2,
        "status": "SUCCESS",
        "createdUser": {
          "id": "usr_9b1deb4d",
          "username": "nguyenvana",
          "email": "nvana@loha.vn",
          "fullName": "Nguyễn Văn A",
          "role": "SALES_REP",
          "status": "ACTIVE",
          "phone": "0901234567",
          "assignedWarehouse": null,
          "createdAt": "2026-10-03T12:00:00.000Z"
        },
        "temporaryPassword": "Loha@123456"
      },
      {
        "row": 5,
        "status": "FAILED",
        "errors": [
          "Email \"khong-hop-le\" không đúng định dạng email."
        ]
      }
    ],
    "createdUsers": [ /* Danh sách SafeUser */ ],
    "summary": "Import hoàn tất: Tạo thành công 47 tài khoản, 3 dòng thất bại."
  }
}
```

---

#### 📋 3. Quy chuẩn Cấu trúc File Excel mẫu:

| Cột (Header) | Bắt buộc | Kiểu dữ liệu | Ràng buộc / Mô tả | Ví dụ |
|:---|:---:|:---|:---|:---|
| `fullName` | **Có** | Chuỗi (2-100 ký tự) | Họ và tên đầy đủ | `Nguyễn Văn A` |
| `username` | **Có** | Chuỗi (3-30 ký tự) | Chỉ gồm chữ thường, số, dấu gạch dưới | `nguyenvana` |
| `email` | **Có** | Chuỗi (Email hợp lệ) | Định dạng RFC 5322, duy nhất toàn hệ thống | `nvana@loha.vn` |
| `role` | **Có** | Chuỗi (Enum / Alias) | 7 vai trò hệ thống hoặc alias tiếng Việt | `SALES_REP` hoặc `thủ kho` |
| `phone` | Không | Chuỗi (Số ĐT VN) | Bắt đầu bằng 0 hoặc +84, 10-11 chữ số | `0901234567` |
| `password` | Không | Chuỗi (≥6 ký tự) | Nếu bỏ trống: Tự sinh mật khẩu tạm ngẫu nhiên | `Loha@Secure123` |
| `assignedWarehouse` | Có điều kiện | Chuỗi | **Bắt buộc** nếu là `WAREHOUSE_KEEPER` / `WAREHOUSE_MANAGER` | `Kho Tổng Miền Nam` |

- **Bản đồ ánh xạ Alias Vai trò Tiếng Việt (`ROLE_ALIAS_MAP`):**
  - `"thủ kho"`, `"thu kho"`, `"thukho"` ➔ `WAREHOUSE_KEEPER`
  - `"quản lý kho"`, `"quan ly kho"`, `"ql kho"` ➔ `WAREHOUSE_MANAGER`
  - `"kế toán"`, `"ke toan"`, `"ketoan"` ➔ `ACCOUNTANT`
  - `"nhân viên kinh doanh"`, `"kinh doanh"`, `"sales"` ➔ `SALES_REP`
  - `"quản lý kinh doanh"`, `"trưởng phòng kinh doanh"` ➔ `SALES_MANAGER`
  - `"quản trị viên"`, `"admin"`, `"quantrivien"` ➔ `ADMIN`
  - `"khách hàng"`, `"đại lý"`, `"customer"` ➔ `CUSTOMER`

---

#### ⚙️ 4. Chi tiết Kiến trúc & Luồng xử lý Kỹ thuật:

1. **Giai đoạn 1 – Thẩm định File Đầu vào (Pre-validation):**
   - Kiểm tra `file` có tồn tại trong `Express.Multer.File`.
   - Kiểm tra định dạng qua MIME type và phần mở rộng (`.xlsx`, `.xls`).
   - Kiểm tra giới hạn dung lượng `file.size <= 5MB` (`5 * 1024 * 1024` bytes).
2. **Giai đoạn 2 – Đọc và Phân tích Memory Buffer (Parsing):**
   - Dùng thư viện `xlsx` (SheetJS) đọc trực tiếp từ `file.buffer`.
   - Lấy `SheetNames[0]`, chuyển đổi sang mảng object qua `XLSX.utils.sheet_to_json`.
   - Kiểm tra file rỗng và xác minh sự hiện diện của 4 header bắt buộc: `fullName`, `username`, `email`, `role`.
   - Kiểm tra giới hạn số lượng dòng `totalRows <= 500`.
3. **Giai đoạn 3 – Thẩm định & Khởi tạo Từng Dòng Độc lập (Per-row Execution):**
   - Ánh xạ từng dòng sang instance của `ExcelUserRowDto` bằng `plainToInstance`.
   - Chạy hàm `validate()` của `class-validator`.
   - Chuẩn hóa vai trò qua hàm `resolveRole()` kết hợp Enum và `ROLE_ALIAS_MAP`.
   - Gọi `UsersService.create()`:
     - Kiểm tra trùng lặp `username` hoặc `email` trong CSDL.
     - Kiểm tra ràng buộc nhân sự kho bắt buộc phải gắn `assignedWarehouse`.
     - Tự động băm mật khẩu bằng `bcrypt` (10 salt rounds).
     - Giả lập gửi email kích hoạt tài khoản kèm mật khẩu tạm.
   - **Cơ chế Cách ly Lỗi (Error Isolation):** Nếu dòng thứ $i$ bị lỗi (sai định dạng, trùng email, thiếu kho...), hệ thống ghi nhận `status: FAILED` cho dòng đó, ghi log cảnh báo và **tiếp tục xử lý ngay dòng $i+1$** mà không làm dừng toàn bộ batch.
4. **Giai đoạn 4 – Tổng hợp Báo cáo & Ghi Log:**
   - Trả về đối tượng `ImportUsersReportDto` chứa `totalRows`, `successCount`, `failedCount`, danh sách chi tiết `results` và `createdUsers` (dạng `SafeUser`, tuyệt đối không để lộ `passwordHash`).
   - Tích hợp NestJS `Logger`: Ghi log chi tiết tiến trình đọc file, log từng dòng thành công `[LOG]` / thất bại `[WARN]` kèm nguyên nhân, và log tóm tắt cuối cùng.

---

#### 🧪 5. Kết quả Kiểm thử Tự động (Automated Jest Test Suite):

- **File kiểm thử:** `test/excel-import-sn147.spec.ts`
- **Bộ công cụ:** Jest v30 + `ts-jest` v29 (Strict TypeScript, Zero `any`).
- **Tổng số test cases:** **22 / 22 PASS (100%)** – Thời gian thực thi: **~4.2 giây**.

```
PASS test/excel-import-sn147.spec.ts
  [SN-147] Excel Import – Tao Tai Khoan Hang Loat
    Validate file dau vao
      √ TC-01: Nem BadRequestException khi khong co file (null)
      √ TC-02: Nem BadRequestException khi MIME type khong hop le (.pdf)
      √ TC-03: Nem BadRequestException khi file qua dung luong (> 5MB)
      √ TC-04: Nem BadRequestException khi file Excel rong (khong co dong nao)
      √ TC-05: Nem BadRequestException khi thieu cot bat buoc (thieu email)
    Validate tung dong du lieu
      √ TC-06: Dong thieu fullName -> status = FAILED, co thong bao loi ro rang
      √ TC-07: Dong co vai tro khong hop le -> status = FAILED
      √ TC-08: Dong co email sai dinh dang -> status = FAILED
      √ TC-09: Dong thieu username -> status = FAILED
    Tao tai khoan thanh cong
      √ TC-10: 1 dong hop le -> successCount = 1, tra ve user va temporaryPassword
      √ TC-11: 3 dong hop le -> successCount = 3, bao cao day du
      √ TC-12: Bao cao summary chua so tai khoan tao thanh cong
      √ TC-13: Tai khoan duoc tao khong lo passwordHash (SafeUser)
    Xu ly loi trung lap (username / email)
      √ TC-14: Import cung username 2 lan -> dong 2 FAILED do trung username
      √ TC-15: Import cung email 2 lan -> dong 2 FAILED do trung email
    Ho tro alias vai tro tieng Viet
      √ TC-16: "thu kho" duoc phan giai thanh WAREHOUSE_KEEPER va tao thanh cong
      √ TC-17: "ketoan" duoc phan giai thanh ACCOUNTANT va tao thanh cong
      √ TC-18: "quantrivien" duoc phan giai thanh ADMIN
    Batch processing – loi 1 dong khong dung ca batch
      √ TC-19: 5 dong, dong 2 loi role, cac dong con lai van duoc xu ly thanh cong
      √ TC-20: 10 dong tat ca hop le -> successCount = 10
    Rang buoc kho bat buoc voi vai tro WAREHOUSE_KEEPER / WAREHOUSE_MANAGER
      √ TC-21: WAREHOUSE_KEEPER khong co assignedWarehouse -> FAILED
      √ TC-22: WAREHOUSE_KEEPER co assignedWarehouse -> SUCCESS

Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
```

---

#### ⚠️ 6. Phân tích Xung đột Git & Phương án Giải quyết (Conflict Analysis - PR #5):

Trên Git / GitHub Pull Request #5 có 4 file xung đột cần xử lý khi merge vào nhánh `develop`:

| File xung đột | Nguyên nhân | Phương án giải quyết chính xác |
|:---|:---|:---|
| `log.md` | Nhánh `develop` có log của các task khác; nhánh feature có log của SN-147 | **Giữ cả hai**, ghép nối theo thứ tự thời gian. Tuyệt đối không ghi đè mất log của đồng đội. |
| `package-lock.json` | Nhánh feature cài đặt thêm `xlsx` | **Giữ phiên bản của nhánh feature** (có dependency `xlsx`) hoặc chạy lại `npm install` sau khi merge. |
| `src/modules/users/users.controller.ts` | Nhánh `develop` có thêm routes từ task khác; nhánh feature thêm route `POST /api/users/import-excel` | **Gộp cả hai**: Giữ toàn bộ routes từ `develop`, bổ sung endpoint import Excel và inject `ExcelImportService`. |

---

### Task [Sprint 2] - [SN-23]: Đơn Vị Tính Quy Đổi & Ghi Sổ Kho Chuẩn Đơn Vị Cơ Sở (Lon / Lốc / Thùng)

> **Mã công việc:** `SN-23` (Thuộc Epic `SN-21: Quản lý Kho & Tồn Kho Hàng Hóa`)  
> **Người thực hiện:** AI Assistant (Pair Programming)  
> **Thời gian hoàn thành:** 05/10/2026  
> **Trạng thái:** ✅ **HOÀN THÀNH 100% (Backend + Frontend + Test Suite)**  
> **Tuân thủ quy chuẩn:** `CODE_CONVENTION.docx` & `CODE_CONVENTION.md` (Strict TypeScript, Zero `any`, 100% `kebab-case`, Trailing Comma, 2 spaces indentation)

---

#### 🎯 1. Yêu cầu Nghiệp vụ & Tiêu chí Chấp nhận (Acceptance Criteria):

* **User Story:**
  > *"Là Nhân viên kho, tôi muốn có đơn vị tính quy đổi đúng theo cách kho đang gọi hàng, để nhập xuất theo thùng mà sổ sách vẫn ghi đúng số lon."*

* **3 Tiêu chí nghiệm thu cốt lõi:**
  1. **AC-1 - Khai báo đa đơn vị:** Mỗi SKU khai báo được nhiều đơn vị (vd: Lon, Lốc, Thùng) kèm hệ số quy đổi về đơn vị cơ sở (`conversionRate > 0`). Đơn vị cơ sở (`baseUnit`) luôn được bảo đảm tồn tại với hệ số quy đổi mặc định bằng 1 (`isBaseUnit = true`).
  2. **AC-2 - Tự động quy đổi khi ghi sổ:** Phiếu kho (nhập, xuất, điều chỉnh) nhập theo bất kỳ đơn vị nào (Thùng, Lốc, Lon...) đều được tự động quy về đơn vị cơ sở (`baseQuantityChange = quantity * conversionRate`) khi cập nhật thẻ kho và sổ cái tồn kho.
  3. **AC-3 - Bất biến lịch sử giao dịch (Snapshot Immutability):** Việc sửa đổi hệ số quy đổi của SKU trong tương lai (ví dụ: đổi quy cách từ 24 lon/thùng lên 30 lon/thùng) tuyệt đối **KHÔNG** làm sai lệch các bút toán giao dịch đã ghi nhận trong quá khứ. Toàn bộ các dòng sổ kho lưu trữ snapshot bất biến của `conversionRate` và `baseQuantityChange` tại thời điểm phát sinh.

---

#### 📁 2. Danh mục File Thay đổi & Tạo mới:

##### A. Backend (NestJS):
* **Tạo mới:**
  * `src/modules/products/entities/product-unit.entity.ts`: Entity đại diện cho đơn vị quy đổi của SKU (`unitName`, `conversionRate`, `isBaseUnit`, `barcode`, `price`, `costPrice`).
  * `src/modules/products/dto/product-unit.dto.ts`: DTO kiểm thực dữ liệu đầu vào cho đơn vị tính (`unitName` non-empty, `conversionRate >= 1`, boolean `isBaseUnit`).
  * `src/modules/inventory/entities/inventory-transaction.entity.ts`: Entity sổ cái kho (Transaction Ledger) lưu trữ bất biến các giao dịch (`inputQuantity`, `inputUnit`, snapshot `conversionRate`, `baseQuantityChange`, `baseUnit`, `previousStock`, `newStock`, `referenceCode`).
  * `test/product-units-conversion-sn23.spec.ts`: Bộ kiểm thử tự động 11 Test Cases bao phủ trọn vẹn 3 tiêu chí AC-1, AC-2, AC-3.
* **Cập nhật:**
  * `src/modules/products/entities/product.entity.ts`: Bổ sung trường `units: ProductUnitEntity[]`, tự động đồng bộ `baseUnit` vào danh sách đơn vị, serialize đầy đủ trong `toJSON()`.
  * `src/modules/products/dto/create-product.dto.ts` & `src/modules/products/dto/index.ts`: Bổ sung `@ValidateNested()` cho mảng `ProductUnitDto`.
  * `src/modules/products/products.service.ts`:
    * Cập nhật Seed Data 11 sản phẩm FMCG với đa đơn vị tính chuẩn (Lon/Lốc/Thùng, Hộp/Lốc/Thùng, Chai/Thùng, Gói/Thùng).
    * Bổ sung logic kiểm tra trùng lặp tên đơn vị, kiểm tra `conversionRate > 0`, hàm tiện ích `findUnitConversion(product, unitName)`.
  * `src/modules/inventory/dto/adjust-stock.dto.ts`: Bổ sung trường tùy chọn `unit?: string` và `referenceCode?: string`.
  * `src/modules/inventory/inventory.service.ts`:
    * Tích hợp cơ chế tính toán quy đổi theo đơn vị nhập/xuất trước khi ghi sổ tồn kho.
    * Cơ chế **chống tồn kho âm tuyệt đối** (chặn giao dịch nếu tồn sau quy đổi < 0).
    * Ghi nhận dòng giao dịch bất biến vào sổ cái kho (`inventoryTransactions`).
    * Bổ sung hàm `getTransactions(sku?: string, limit?: number)`.
  * `src/modules/inventory/inventory.controller.ts`: Bổ sung endpoint `GET /inventory/transactions` để truy vấn sổ kho.

##### B. Frontend (React + TypeScript):
* **Cập nhật:**
  * `src/types/products.ts`: Bổ sung interface `ProductUnit`, `InventoryTransaction`, mở rộng `Product`, `CreateProductPayload`, `AdjustStockPayload`, `StockAdjustmentResponse`.
  * `src/services/products.service.ts`: Cấu hình danh sách 11 mock products FMCG có đầy đủ `units`, export danh sách dùng chung.
  * `src/services/inventory.service.ts`: Triển khai hàm `adjustStock()` hỗ trợ quy đổi đơn vị, lưu trữ sổ kho vào `localStorage` (fallback demo), và hàm `getTransactions(sku)`.
  * `src/components/product-form-modal.tsx`:
    * Tích hợp UI khối **"Khai báo đơn vị tính quy đổi kho (Lon / Lốc / Thùng)"** ngay dưới mục quy cách đóng gói.
    * Gợi ý chọn nhanh các quy cách phổ biến: `+ Lốc (x6)`, `+ Lốc (x4)`, `+ Thùng (x24)`, `+ Thùng (x30)`.
    * Form thêm / xóa đơn vị quy đổi trực quan, kiểm tra hợp lệ: không trùng đơn vị cơ sở, hệ số > 1.
    * Gắn toàn bộ `units` vào payload gửi lên server khi tạo mới hoặc cập nhật SKU.
  * `src/pages/products-page.tsx`:
    * **Bảng danh mục (Desktop & Mobile):** Hiển thị tag ĐVT cơ sở kèm huy hiệu các đơn vị quy đổi (`Thùng x24`, `Lốc x6`...).
    * **Thao tác hàng:** Bổ sung nút mở **Sổ kho & Lịch sử quy đổi** (`BookOpen`).
    * **Header actions:** Bổ sung nút truy cập nhanh **Sổ kho quy đổi**.
    * **Modal Điều chỉnh / Nhập Xuất Tồn Kho:** Cho phép chọn đơn vị tính (Dropdown gồm ĐVT cơ sở và các đơn vị quy đổi), nhập số lượng, nhập mã chứng từ/phiếu kho (`referenceCode`). Hiển thị hộp tính toán quy đổi thời gian thực: `Số lượng x Hệ số = SL cơ sở ghi sổ` và cảnh báo ngăn chặn xuất âm kho.
    * **Modal Sổ Kho & Lịch Sử Bút Toán (Ledger Modal):** Hiển thị bảng chi tiết các bút toán lịch sử, giải thích rõ ràng tính chất **Snapshot Immutability (AC-3)** bảo đảm không bao giờ sai lệch quá khứ khi đổi hệ số quy đổi.

---

#### 🧪 3. Kết Quả Kiểm Thử (Test Suite Execution):

##### A. Backend Test Suite (`test/product-units-conversion-sn23.spec.ts`):
```text
PASS test/product-units-conversion-sn23.spec.ts
  [SN-23] Đơn Vị Tính Quy Đổi & Ghi Sổ Kho Chuẩn Đơn Vị Cơ Sở
    1. Khai báo Đơn vị tính quy đổi đa cấp cho SKU (Lon, Lốc, Thùng)
      √ TC-01: Sản phẩm ban đầu (Seed Data) có sẵn danh sách đơn vị quy đổi chuẩn FMCG (3 ms)
      √ TC-02: Tạo mới SKU khai báo nhiều đơn vị quy đổi thành công (baseUnit + conversion units) (1 ms)
      √ TC-03: Tự động đảm bảo đơn vị cơ sở (baseUnit) luôn có mặt trong units với conversionRate = 1 (1 ms)
      √ TC-04: Từ chối tạo SKU nếu có đơn vị quy đổi bị trùng lặp tên (11 ms)
      √ TC-05: Từ chối tạo SKU nếu hệ số quy đổi <= 0 (1 ms)
    2. Nhập/Xuất kho theo thùng/lốc đều quy về đơn vị cơ sở khi ghi sổ
      √ TC-06: Nhập kho 5 Thùng (hệ số 24) -> Tồn kho tăng chính xác +120 Lon cơ sở (1 ms)
      √ TC-07: Xuất kho 2 Lốc (hệ số 6) -> Tồn kho giảm chính xác -12 Lon cơ sở
      √ TC-08: Nếu không truyền unit -> Mặc định là đơn vị cơ sở (conversionRate = 1) (1 ms)
      √ TC-09: Báo lỗi nếu chọn đơn vị không tồn tại trong danh mục của SKU (2 ms)
      √ TC-10: Ràng buộc chống tồn kho âm tuyệt đối khi xuất vượt quá tồn cơ sở (1 ms)
    3. Đổi hệ số quy đổi KHÔNG làm sai lệch các giao dịch đã ghi trước đó (Snapshot bất biến)
      √ TC-11: Bản ghi sổ kho lưu cứng Snapshot conversionRate và baseQuantityChange tại thời điểm phát sinh (1 ms)

Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
Snapshots:   0 total
Time:        1.783 s
```

##### B. Frontend & Backend Build Verification:
* **Frontend:** `npm run build` (`tsc -b && vite build`) -> **Exit code 0** (0 lỗi TypeScript, 0 cảnh báo type).
* **Backend:** `npm run build` (`nest build`) -> **Exit code 0** (Biên dịch sạch sẽ).
* **Regression Test:** `npm run test` (`excel-import-sn147.spec.ts`) -> **22/22 PASS**.

---

#### 📌 4. Ghi Chú Kỹ Thuật & Bàn Giao:
1. **Bảo mật và toàn vẹn dữ liệu:** Không lưu tham chiếu động hệ số quy đổi trong bảng giao dịch kho; luôn lưu giá trị tĩnh tại thời điểm phát sinh giao dịch.
2. **Quy tắc đặt tên:** 100% tuân thủ `CODE_CONVENTION.docx` và `CODE_CONVENTION.md` (kebab-case file, PascalCase entity/class, camelCase hàm, zero any).
3. **Mở rộng tương lai:** Khi tích hợp Module Đơn Hàng (Order & Pricing), line-item trong đơn hàng cũng sẽ áp dụng `findUnitConversion` để tự động tính giá và trừ giữ chỗ theo đơn vị cơ sở.


---

### [Sprint 2] - [SN-150]: Quản Lý Nhóm Hàng Đa Cấp (Tree Structure) & Ràng Buộc Toàn Vẹn Dữ Liệu
- **Thời gian hoàn thành:** 2026-10-03
- **Mã Jira / US:** SN-150 (User Story SN-22 / S2-06 - Sprint 2)
- **Mục tiêu nghiệp vụ:** Cho phép Quản lý kinh doanh (`SALES_MANAGER`) và Quản trị viên (`ADMIN`) quản lý nhóm hàng theo cấu trúc cây (tối thiểu 3 cấp), hỗ trợ chuyển sản phẩm giữa các nhóm và thực thi nghiêm ngặt ràng buộc toàn vẹn chống xóa nhóm còn sản phẩm hoặc nhóm con.
- **Danh sách file tạo mới / thay đổi:**
  - *Tạo mới:*
    - `src/common/enums/category-status.enum.ts`: Enum `CategoryStatus` (`ACTIVE` | `INACTIVE`).
    - `src/modules/categories/interfaces/category-tree.interface.ts`: Interface `CategoryTreeNode` (hỗ trợ phân cấp đệ quy và `productCount`).
    - `src/modules/categories/entities/category.entity.ts`: Thực thể `CategoryEntity` (`id`, `code`, `name`, `parentId`, `level`, `status`, `productCount`, `children`, aliases snake_case `parent_id`, `product_count`, v.v.).
    - `src/modules/categories/dto/create-category.dto.ts`: DTO tạo nhóm hàng mới (validate `name`, `code`, `parentId`, `description`, `status`).
    - `src/modules/categories/dto/update-category.dto.ts`: DTO cập nhật nhóm hàng (`PartialType(CreateCategoryDto)`).
    - `src/modules/categories/dto/move-products.dto.ts`: DTO di chuyển sản phẩm giữa các nhóm hàng (`sourceCategoryId`, `targetCategoryId`, `productIds`).
    - `src/modules/categories/categories.service.ts`: Xử lý toàn bộ logic nghiệp vụ (build cây đệ quy, tính toán level tự động, chống vòng lặp vô tận, di chuyển sản phẩm, ràng buộc xóa cứng).
    - `src/modules/categories/categories.controller.ts`: Các endpoints RESTful bảo vệ bởi `JwtAuthGuard` & `RolesGuard` (`ADMIN`, `SALES_MANAGER`).
    - `src/modules/categories/categories.module.ts`: Đăng ký module và liên kết hai chiều với `ProductsModule`.
    - `test/categories-tree-sn150.spec.ts`: Bộ kiểm thử tự động toàn diện 41/41 test case.
  - *Chỉnh sửa:*
    - `src/common/enums/index.ts`: Export `category-status.enum`.
    - `src/modules/products/entities/product.entity.ts`: Bổ sung thuộc tính `categoryId` và alias getter `category_id`.
    - `src/modules/products/products.service.ts`: Bổ sung các phương thức tra cứu và di chuyển sản phẩm theo nhóm hàng (`findProductsByCategoryId`, `countProductsByCategoryId`, `moveProductsBetweenCategories`).
    - `src/app.module.ts`: Đăng ký `CategoriesModule`.
- **Chi tiết kỹ thuật & nghiệp vụ đã triển khai:**
  1. **Schema & Cây Danh Mục (Tree Structure):**
     - Mô hình Adjacency List với `parent_id` tự liên kết, tính toán tự động `level` (`level = parent.level + 1`; nếu không có cha mặc định `level = 1`).
     - Đã khởi tạo bộ dữ liệu mẫu chuẩn hóa 3 cấp cho ngành FMCG & Thực phẩm Đồ uống (Ngành hàng cha -> Nhóm phụ -> Phân loại con).
     - Tự động đếm và hiển thị `productCount` tương ứng trên từng node nhóm hàng.
  2. **Chống Vòng Lặp Vô Tận (Circular Dependency Protection):**
     - Khi cập nhật `parentId`, hệ thống chủ động kiểm tra bằng thuật toán duyệt ngược tổ tiên (`isDescendant`):
       - Chặn chọn chính mình làm nhóm cha (`BadRequestException: "Không thể chọn chính nhóm hàng làm nhóm cha (vòng lặp vô tận)"`).
       - Chặn chọn con hoặc cháu làm nhóm cha (`BadRequestException: "Không thể chọn nhóm con/cháu làm nhóm cha (vòng lặp vô tận)"`).
     - Khi đổi nhóm cha, hệ thống cập nhật đệ quy `level` của toàn bộ cây con bên dưới.
  3. **Di Chuyển Sản Phẩm Giữa Các Nhóm (`POST /api/categories/move-products`):**
     - Kiểm tra nhóm nguồn và nhóm đích hợp lệ, bắt buộc khác nhau.
     - Cho phép di chuyển theo danh sách `productIds` chỉ định hoặc chuyển toàn bộ sản phẩm của nhóm nguồn sang nhóm đích.
  4. **Ràng Buộc Toàn Vẹn Cứng Khi Xóa (`DELETE /api/categories/:id`):**
     - Ràng buộc 1: Nếu nhóm đang chứa nhóm con (`children`), từ chối xóa: `"Nhóm hàng đang chứa nhóm hàng con. Vui lòng chuyển hoặc xóa nhóm con trước."`
     - Ràng buộc 2: Nếu nhóm đang chứa sản phẩm (`products`), từ chối xóa: `"Nhóm còn sản phẩm thì không xoá được. Vui lòng chuyển sản phẩm sang nhóm khác trước khi xoá."`
     - Chỉ cho phép xóa khi nhóm hoàn toàn rỗng.
  5. **Phân Quyền RBAC (Deny by default):**
     - `GET /api/categories/tree`, `GET /api/categories`, `GET /api/categories/:id`: Mọi người dùng đã đăng nhập (`JwtAuthGuard`).
     - `POST`, `PATCH`, `DELETE`, `POST /move-products`: Giới hạn nghiêm ngặt chỉ `@Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)` kèm `RolesGuard`.
- **Trạng thái:**
  - ✅ Build Backend (`nest build`) thành công 100%, 0 lỗi TypeScript, tuyệt đối không dùng `any`.
  - ✅ Test Suite `test/categories-tree-sn150.spec.ts`: **41/41 PASSED, 0 FAILED**.
  - ✅ Hồi quy toàn diện: Test Suite SN-138 (62/62) và SN-10 (25/25) tiếp tục pass 100%.
  - 🚀 Sẵn sàng tích hợp sang các tính năng Bảng giá đa cấp (EP-02 / Sprint 2).

---

### [TASK TIẾP THEO] ĐỒNG BỘ TOÀN DIỆN HAI CHIỀU: CÂY NHÓM HÀNG & DANH MỤC SẢN PHẨM (CATEGORY TREE & PRODUCT CATALOG SYNC)
- **Mục tiêu:**
  1. Phân cấp ở Danh mục sản phẩm và Cây nhóm hàng phải đồng nhất 100% theo cùng một cấu trúc chuẩn (3 cấp: Cấp 1 > Cấp 2 > Cấp 3).
  2. Khi thêm/sửa sản phẩm, sản phẩm thuộc nhánh nào phải về chính xác nhánh đó trên cây; cây nhóm hàng tự động cập nhật số lượng sản phẩm (`productCount`) của nhánh con và rollup lên các nhánh cha.
  3. Hai mục Cây sản phẩm và Danh mục sản phẩm phải đồng nhất, thay đổi ở mục này sẽ lập tức phản ánh sang mục kia.
- **Danh sách file thay đổi:**
  - **Backend (`HTBH_Backend`):**
    - `src/modules/products/dto/create-product.dto.ts`: Bổ sung trường `categoryId?: string;` hỗ trợ gán trực tiếp ID nhóm hàng khi tạo SKU.
    - `src/modules/products/dto/get-products-filter.dto.ts`: Bổ sung bộ lọc `categoryId?: string;`.
    - `src/modules/products/entities/product.entity.ts`: Bổ sung `categoryId`, alias `category_id`, constructor normalization, và serializer `toJSON()`.
    - `src/modules/products/products.service.ts`:
      + Gán `categoryId` cho các sản phẩm khởi tạo mẫu và sản phẩm tạo mới/cập nhật.
      + Triển khai `countDirectProductsByCategoryId()` để đếm chính xác sản phẩm trực tiếp thuộc node mà không trùng lặp khi rollup cây.
      + Triển khai `findProductsByBranch()` để lấy sản phẩm thuộc toàn bộ nhánh (bao gồm các nhóm con/cháu).
      + Bổ sung lọc `categoryId` trong `findAllPaginated()`.
    - `src/modules/categories/categories.service.ts`:
      + Nâng cấp thuật toán `getCategoryTree()` tính `productCount = directCount + sum(child.productCount)` bảo đảm rollup chính xác từ lá lên gốc.
      + Bổ sung `getProductsByCategoryId(idOrCode)` tra cứu sản phẩm theo nhánh.
      + Bổ sung `getDescendantIds(categoryId)`.
    - `src/modules/categories/categories.controller.ts`:
      + Bổ sung endpoint `GET /api/categories/:id/products` (quyền: mọi vai trò đăng nhập).
  - **Frontend (`HTBH_Frontend`):**
    - `src/types/products.ts`: Bổ sung `level`, `children`, `subCategories`, `productCount` cho `ProductCategory`; bổ sung `categoryId` cho `ProductQueryParams`.
    - `src/services/categories.service.ts`: Bổ sung hàm `getProductsByCategory(id)`.
    - `src/services/products.service.ts`:
      + Cập nhật `PRODUCT_CATEGORIES` tĩnh chuẩn 3 cấp.
      + Tải danh mục động từ `/api/categories/tree` qua `getCategories()`.
      + Hỗ trợ truyền `categoryId` trong `getProducts()`.
    - `src/components/product-form-modal.tsx`:
      + Tải cây danh mục động từ backend.
      + Bộ chọn phân cấp 3 tầng liên hoàn: Cấp 1 (Nhóm chính) -> Cấp 2 (Nhóm phụ) -> Cấp 3 (Phân loại chi tiết).
      + Hiển thị Breadcrumb trực quan (`FolderTree`) nhánh đang chọn và tự động gán `categoryId` node lá gửi lên server.
    - `src/pages/categories-page.tsx`:
      + Huy hiệu số lượng sản phẩm trên từng node cây cho phép bấm để mở modal danh sách sản phẩm thuộc nhánh.
      + Nút điều hướng "Mở trong Danh mục sản phẩm →" tự động chuyển hướng và lọc theo `categoryId`.
    - `src/pages/products-page.tsx`:
      + Tự động nhận tham số `categoryId` từ URL query parameters và hiển thị chip "Đang lọc theo nhánh cây".
      + Bổ sung dropdown lọc Cấp 3 khi nhóm Cấp 2 có phân loại con.
      + Bảng danh sách hiển thị cột "Nhóm hàng" dạng breadcrumb đa cấp trực quan.
- **Trạng thái kiểm thử:**
  - ✅ Backend Build: 100% Passed (`nest build`).
  - ✅ Frontend Build: 100% Passed (`tsc -b && vite build`).
  - ✅ Test Suite Tự Động: 41/41 Passed (`categories-tree-sn150.spec.ts`).
  - ✅ Test Live E2E Integration: Hoàn thành kiểm thử vòng tròn (Thêm SP -> Cây tăng số lượng đúng nhánh và cha -> Xem SP theo nhánh -> Lọc SP theo nhánh).

---

### [FIX] LƯU TRỮ VÀ ĐỒNG BỘ TOÀN VẸN CÂY NHÓM HÀNG VÀO CƠ SỞ DỮ LIỆU POSTGRESQL
- **Vấn đề phát hiện:**
  - Schema PostgreSQL `categories` sử dụng kiểu dữ liệu `id INT SERIAL PRIMARY KEY`, `parent_id INT REFERENCES categories(id)`, và `path VARCHAR(255) NOT NULL`.
  - Trong tầng Service trước đó, `newCategory.parentId` được truyền dạng chuỗi (`'cat-...'`) khiến PostgreSQL từ chối câu lệnh INSERT do lỗi ép kiểu `parent_id INT`.
  - Hàm `loadCategoriesFromDatabase()` bị thiếu logic đồng bộ hai chiều, khiến dữ liệu khởi tạo không được nạp vào DB và dữ liệu tạo mới từ UI không lưu được vào PostgreSQL.
- **Giải pháp xử lý:**
  - Cập nhật [`categories.service.ts`](file:///d:/D%E1%BB%B1%20%C3%A1n%20TTCS/HTBH_Backend/src/modules/categories/categories.service.ts):
    + `syncAndLoadCategoriesFromDatabase()`: Tự động đồng bộ toàn bộ bộ seed cây mẫu (3 cấp) vào PostgreSQL khi khởi động với ID số nguyên và cập nhật `path` phân cấp (ví dụ: `/11/17/28/`).
    + `create()`: Truy vấn chuyển đổi `parentId` sang `parent_id` kiểu số nguyên trong Postgres; thực hiện `INSERT INTO categories ... RETURNING id`, tự động sinh `path` tương ứng và lưu ID số nguyên thực tế vào hệ thống.
    + `update()`: Kiểm tra tính duy nhất mã code trong DB; cập nhật `parent_id`, `level`, và tự động cập nhật đệ quy `path` bằng Recursive CTE trong PostgreSQL.
    + `delete()`: Kiểm tra ràng buộc cứng tồn tại nhóm con (`parent_id`) và sản phẩm (`category_id`) trực tiếp trên bảng PostgreSQL trước khi thực thi xóa.
  - Cập nhật [`products.service.ts`](file:///d:/D%E1%BB%B1%20%C3%A1n%20TTCS/HTBH_Backend/src/modules/products/products.service.ts):
    + Khi tạo mới hoặc cập nhật sản phẩm, tự động ánh xạ `dto.categoryId` sang ID số nguyên của bảng `categories` trong PostgreSQL (thay vì cố định giá trị 1).
- **Trạng thái kiểm thử:**
  - ✅ Build `nest build`: Thành công 100%, 0 lỗi.
  - ✅ Unit Test `categories-tree-sn150.spec.ts`: 41/41 Passed.
  - ✅ Live Test PostgreSQL: Kiểm thử trực tiếp trên PostgreSQL thực tế (`htbh_db`) thành công 100%: 29 nhóm ngành hàng được đồng bộ, nhóm mới tạo lập tức ghi nhận vào bảng `categories`, cập nhật `path` và liên kết `parent_id` chính xác.

---

### [TASK] SN-25: CẬP NHẬT UI & FORM VALIDATION CHO MODAL THÊM MỚI NHÀ CUNG CẤP
- **User Story:** SN-25 - Quản lý Nhà cung cấp (Supplier Management).
- **Nhánh thực hiện (Git Branches):**
  - Backend: `feature/SN-25-supplier-validation-be` (checkout từ `Develop`).
  - Frontend: `feature/SN-25-supplier-validation-fe` (checkout từ `main`).
  - *Strict Rule:* Tuân thủ giữ nguyên uncommitted changes, tuyệt đối không tự ý `git commit` hay `git push`.
- **Chi tiết kỹ thuật cập nhật:**
  - **Frontend (`HTBH_Frontend`):**
    - File: `src/pages/suppliers-page.tsx`
      + Thẻ thống kê (Stats Card): Đổi chữ "Ngừng hoạt động" thành "Ngừng giao dịch" để đồng bộ chuẩn xác với tên trạng thái hệ thống, giữ nguyên toàn bộ layout và logic đếm.
    - File: `src/components/supplier-form-modal.tsx`
      + Trường `Mã nhà cung cấp`: Thiết lập thuộc tính `readOnly`, `disabled`, placeholder `"Mã nhà cung cấp tự sinh"`, ngăn chặn tương tác nhập tay khi tạo mới, hiển thị gợi ý hệ thống tự động sinh mã định danh khi lưu.
      + Trường `Mã số thuế`: Cập nhật nhãn chuẩn hóa thành "Mã số thuế" (loại bỏ "(MST)"), ràng buộc chỉ cho phép nhập ký tự số và bắt buộc đúng 12 chữ số (`^[0-9]{12}$`), hiển thị lỗi realtime và submit: *"Mã số thuế phải bao gồm đúng 12 chữ số"*.
      + Trường `Người liên hệ`: Kiểm tra regex `^[a-zA-ZÀ-ỹ\s]+$`, chặn ký tự số, hiển thị lỗi realtime và submit: *"Tên người liên hệ không được chứa chữ số"*.
      + Trường `Số điện thoại`: Bắt buộc bắt đầu bằng `0`, độ dài từ 10 đến 12 chữ số (`^0[0-9]{9,11}$`). Hiển thị thông báo tương ứng:
        * Không bắt đầu bằng 0: *"Số điện thoại phải bắt đầu bằng số 0"*.
        * Độ dài < 10 hoặc > 12 số: *"Số điện thoại phải từ 10 đến 12 chữ số"*.
      + Giao diện: Hiển thị thông báo lỗi chi tiết màu đỏ ngay dưới từng trường dữ liệu, highlight viền đỏ input khi vi phạm.
  - **Backend (`HTBH_Backend`):**
    - File: `src/modules/suppliers/dto/create-supplier.dto.ts`
      + `taxCode`: Bổ sung `@Matches(/^[0-9]{12}$/, { message: 'Mã số thuế phải bao gồm đúng 12 chữ số' })`.
      + `contactName`: Bổ sung `@Matches(/^[a-zA-ZÀ-ỹ\s]+$/u, { message: 'Tên người liên hệ không được chứa chữ số' })`.
      + `phone` & `contactPhone`: Bổ sung `@Matches(/^0/, { message: 'Số điện thoại phải bắt đầu bằng số 0' })` và `@Matches(/^0[0-9]{9,11}$/, { message: 'Số điện thoại phải từ 10 đến 12 chữ số' })`.
      + `@Transform`: Chuẩn hóa chuỗi rỗng thành `undefined` để bảo đảm `@IsOptional()` hoạt động chính xác khi không nhập dữ liệu optional.
    - File: `src/modules/suppliers/suppliers.service.ts`
      + Đảm bảo tương thích fallback đa trường giữa `dto.phone` và `dto.contactPhone` trong cả `create()` và `update()`.
    - File test: `test/create-supplier-dto-validation.spec.ts`
      + 6 kịch bản kiểm thử validation DTO cho các trường `taxCode` (bắt buộc đúng 12 chữ số), `contactName`, `phone`.
- **Trạng thái kiểm thử:**
  - ✅ Backend Type Check: `npx tsc --noEmit` -> Passed 100% (0 lỗi).
  - ✅ Backend Unit Test: `test/suppliers-sn25.spec.ts` -> 11/11 tests passed.
  - ✅ Backend DTO Validation Test: `test/create-supplier-dto-validation.spec.ts` -> 6/6 tests passed.
  - ✅ Frontend Build: `npm run build` (`tsc -b && vite build`) -> 0 lỗi, build production thành công.




### [Sprint 2] - [SN-28]: BE: Xây dựng Module Chiết khấu theo Sản lượng (DiscountPolicy) & Cảnh báo Tồn kho
- **Thời gian hoàn thành:** 2026-10-08
- **Mã Jira / Task:** SN-28 (Sprint 2)
- **Tiêu đề:** "Áp dụng chính sách chiết khấu theo sản lượng và xử lý cảnh báo tồn kho khi đặt hàng"
- **Danh sách file tạo mới / thay đổi:**
  - `src/modules/discount-policies/*` (Tạo mới: DiscountPolicyEntity, DiscountTier, DTOs, Service, Controller)
  - `src/app.module.ts` (Đăng ký DiscountPoliciesModule)
  - `src/common/enums/order-status.enum.ts` (Thêm trạng thái `PENDING_INVENTORY_APPROVAL`)
  - `src/modules/orders/orders.controller.ts` (Thêm API `POST /api/v1/orders`)
  - `src/modules/orders/orders.service.ts` (Thêm logic kiểm tra tồn kho và chuyển trạng thái `PENDING_INVENTORY_APPROVAL`)
- **Chi tiết kỹ thuật:**
  - **Quản lý chính sách chiết khấu theo sản lượng (Tier):** Cấu hình các hạn mức chiết khấu theo bậc số lượng cho từng sản phẩm hoặc nhóm hàng.
  - **API tính toán mức chiết khấu tốt nhất (Best-Offer):** Tự động so khớp và chọn mức ưu đãi cao nhất cho khách hàng.
  - **Xử lý tồn kho vượt ngưỡng khả dụng:** Nếu tổng số lượng đặt vượt quá tồn kho khả dụng, đơn hàng được tạo với trạng thái `PENDING_INVENTORY_APPROVAL` (Chờ duyệt tồn kho) thay vì trả về lỗi và chặn người dùng.
- **Frontend Integration (SN-28):**
  - Tạo thư mục và component `DiscountPoliciesTab` để quản lý các chính sách chiết khấu sản lượng.
  - Tích hợp tính năng tự động tính chiết khấu trong trang tạo đơn hàng (`orders-page.tsx`).
  - Cập nhật cảnh báo khi đơn đặt hàng vượt tồn kho khả dụng và chuyển sang trạng thái `PENDING_INVENTORY_APPROVAL` đúng chuẩn giao diện `UI_GUIDELINES.md`.
- **Trạng thái kiểm thử:**
  - Backend Build: `nest build` -> 0 lỗi, hoàn thành 100%.
  - Frontend Build: `tsc -b && vite build` -> 0 lỗi, build production thành công.

### [Sprint 3] - [SN-37]: BE & FE: Tìm kiếm và Lọc Danh sách Đại lý theo Tuyến Bán hàng
- **Thời gian hoàn thành:** 2026-10-08
- **Mã Jira / Task:** SN-37 (Epic EP-03 / S3-08)
- **Tiêu đề:** "Là Nhân viên kinh doanh, tôi muốn tìm kiếm và lọc danh sách đại lý, để tìm nhanh khách trong tuyến khi đang đứng ngoài đường."
- **Danh sách file tạo mới / thay đổi:**
  - **Backend (HTBH_Backend):**
    - `src/modules/customers/dto/filter-customers.dto.ts` (Tạo mới: FilterCustomersDto hỗ trợ search, region, customerGroup, salesRepId, status, page, limit)
    - `src/modules/customers/interfaces/paginated-customers.interface.ts` (Tạo mới: PaginatedCustomersResult interface)
    - `src/modules/customers/entities/customer.entity.ts` (Cập nhật: Bổ sung trường salesRep quan hệ { id, name })
    - `src/modules/customers/customers.service.ts` (Cập nhật: filterCustomers xử lý RBAC tuyến bán hàng SALES_REP vs ADMIN/SALES_MANAGER, tìm kiếm không phân biệt hoa thường theo code/name/phone, bộ lọc đa tiêu chí & phân trang)
    - `src/modules/customers/customers.controller.ts` (Cập nhật: GET /api/customers áp dụng JwtAuthGuard, @Query() query: FilterCustomersDto, @CurrentUser() currentUser)
    - `test/customers-filter-sn37.spec.ts` (Tạo mới: 31 test cases bao phủ toàn bộ AC của SN-37)
  - **Frontend (HTBH_Frontend):**
    - `src/types/customer.types.ts` (Tạo mới: Customer, CustomerStatus enum, CustomerFilterParams, PaginatedCustomersResponse)
    - `src/types/customer.ts` (Cập nhật: Re-export đồng bộ với customer.types.ts)
    - `src/services/customer.service.ts` (Tạo mới: getCustomers hỗ trợ tham số lọc, phân trang, demo/offline fallback an toàn)
    - `src/services/customers.service.ts` (Cập nhật: Re-export customerService)
    - `src/hooks/use-customers.ts` (Tạo mới: Custom hook quản lý state, 300ms debounce tìm kiếm, reset filter, pagination)
    - `src/pages/customers-page.tsx` (Tạo mới: Màn hình tra cứu đại lý tối ưu di động với Card View, nút gọi điện thoại nhanh tel:, bộ lọc filter chips, Skeleton loading, Table View cho Desktop, tích hợp DeliveryPointModal)
    - `src/routes/index.tsx` (Cập nhật: Tích hợp CustomersPage vào route /sales/customers và alias /customers)
    - `src/services/orders.service.ts` (Cập nhật: Hỗ trợ response đại lý dạng phân trang PaginatedCustomersResponse)
- **Chi tiết kỹ thuật:**
  - **Phân quyền tuyến bán hàng (RBAC Scope):** Nhân viên vai trò SALES_REP tự động bị giới hạn chỉ xem đại lý do chính mình phụ trách (`salesRepId === currentUser.userId`). Quản trị viên ADMIN và Quản lý kinh doanh SALES_MANAGER được xem toàn bộ đại lý công ty và có thể lọc theo nhân viên kinh doanh cụ thể.
  - **Tìm kiếm nhanh Full-text / Partial:** Tìm kiếm không phân biệt hoa thường theo Mã đại lý (`code`), Tên đại lý (`name`), hoặc Số điện thoại (`phone`).
  - **Bộ lọc đa tiêu chí:** Kết hợp linh hoạt Khu vực (`region`: Miền Bắc, Miền Trung, Miền Nam), Nhóm khách hàng (`customerGroup`: AGENT_LEVEL_1, AGENT_LEVEL_2, RETAIL), Trạng thái (`status`: ACTIVE, LOCKED, INACTIVE).
  - **Trải nghiệm di động thực địa (Field-ready UX):** Giao diện thiết kế theo `UI_GUIDELINES.md` với thẻ Card trực quan, nhãn trạng thái nổi bật, thanh tiến trình tỷ lệ nợ / hạn mức, nút bấm gọi nhanh qua giao thức `tel:`, thao tác chạm tối thiểu 40-44px.
- **Trạng thái kiểm thử:**
  - Backend Spec Test: `npx ts-node test/customers-filter-sn37.spec.ts` -> 31/31 tests passed (100%).
  - Backend Build: `nest build` -> 0 lỗi.
  - Frontend ESLint: `npx eslint` -> 0 lỗi, 0 warnings.
  - Frontend Build: `npm run build` (`tsc -b && vite build`) -> 0 lỗi, build production thành công.

### [Sprint 4] - [SN-48]: Sao Chép Đơn Hàng Cũ Thành Đơn Mới (Clone Order)
- **Thời gian hoàn thành:** 2026-10-09
- **Mã Jira / Task:** SN-48 (Epic EP-04 / SN-39)
- **Tiêu đề:** "Là Nhân viên kinh doanh, tôi muốn sao chép một đơn cũ thành đơn mới, để tạo đơn định kỳ cho khách quen trong vài giây."
- **Danh sách file tạo mới / thay đổi:**
  - **Backend (HTBH_Backend):**
    - `src/modules/orders/orders.service.ts`: Thêm method `cloneOrder(id, salesRep)` - sao chép toàn bộ dòng hàng (sản phẩm, quy cách, đơn vị, số lượng), áp lại giá và chiết khấu theo bảng giá hiện hành, đặt trạng thái luôn là DRAFT. Cập nhật `updateOrder` cho phép chuyển trạng thái từ DRAFT sang PENDING khi hoàn tất đơn.
    - `src/modules/orders/orders.controller.ts`: Thêm endpoint `POST /api/orders/:id/clone` gọi `ordersService.cloneOrder(id)`.
    - `test/orders-clone-sn48.spec.ts`: Bộ kiểm thử tự động 3 test cases cho tính năng sao chép đơn hàng.
- **Chi tiết kỹ thuật:**
  - **Sao chép toàn bộ dòng hàng:** Giữ nguyên toàn bộ SKU, đơn vị tính, hệ số quy đổi và số lượng từ đơn gốc.
  - **Tái áp giá & chiết khấu hiện hành:** Không kế thừa đơn giá và chiết khấu cũ; tự động định giá theo bảng giá hiệu lực và tính lại chiết khấu bậc sản lượng hiện hành.
  - **Trạng thái khởi tạo:** Bản sao luôn bắt đầu ở trạng thái DRAFT với mã đơn duy nhất tự sinh.
- **Trạng thái kiểm thử:**
  - Backend Test: 
px jest test/orders-clone-sn48.spec.ts -> 3/3 tests passed (100%).
  - Backend Build: 
est build -> 0 lỗi.

---

### [Sprint 4] - [SN-49 & SN-42]: Chuẩn Hóa API Tạo Đơn & Trừ Tồn Kho Real-time DB/Memory Cho Cổng Đại Lý
- **Thời gian hoàn thành:** 2026-10-10
- **Mã Jira / Task:** SN-49 & SN-42 (Epic EP-04 / S4-03)
- **Tiêu đề:** "Chuẩn hóa API Tạo Đơn (POST /api/orders) & Trừ Tồn Kho Real-time trong Database cho Cổng đặt hàng Đại lý tự phục vụ."
- **Tiêu chí chấp nhận (AC) đã đạt 100%:**
  1. **Chuẩn hóa DTO Tạo Đơn Portal:**
     - Tiếp nhận DTO từ Portal gồm customerId (String), items (Array gồm productId, quantity dạng Number, price dạng Number, discountPercent, unit), deliveryAddress (String), deliveryDate (String), status: 'PENDING', createdSource: 'AGENCY_PORTAL'.
     - Tự động chuẩn hóa mapping giữa items/deliveryAddress và lines/deliveryPoint để tương thích ngược hoàn toàn với hệ thống xử lý nội bộ.
  2. **Trừ Tồn Kho Real-time DB & Memory (Task SN-42):**
     - Kiểm tra tồn khả dụng nghiêm ngặt trước khi lưu: nếu availableStock - quantity < 0, lập tức từ chối đơn và trả lỗi HTTP 400 Bad Request kèm thông báo chi tiết sản phẩm vượt quá tồn khả dụng.
     - Khi đơn hàng được khởi tạo thành công ở trạng thái PENDING, lập tức cập nhật trong bộ nhớ Memory (availableStock, availableQuantity) và Database PostgreSQL (UPDATE physical_quantity trong app_inventory_stock_balances).
  3. **Lưu vết Nguồn Tạo Đơn:**
     - Lưu createdSource: 'AGENCY_PORTAL' trên thực thể đơn hàng để phân biệt nguồn gốc giữa Cổng Đại lý và Nhân viên kinh doanh.
- **Danh sách file thay đổi:**
  - src/modules/orders/dto/create-order.dto.ts: Thêm class CreateOrderItemDto, mở rộng CreateOrderDto hỗ trợ items, deliveryAddress, createdSource và cho phép lines là optional.
  - src/modules/orders/entities/order.entity.ts: Bổ sung trường createdSource vào OrderEntity và constructor.
  - src/modules/orders/orders.service.ts: Chuẩn hóa dữ liệu đầu vào từ Portal, bổ sung logic trừ tồn kho real-time DB & Memory và guard từ chối khi vượt tồn.
- **Trạng thái kiểm thử:**
  - Backend Type Check: npx tsc --noEmit -> 0 lỗi (Exit Code 0).
  - Backend Test: `npx jest test/orders-clone-sn48.spec.ts` -> 3/3 tests passed (100%).
  - Backend Build: `nest build` -> 0 lỗi.

### [Sprint 4] - [SN-43]: API Lịch Sử Mua Hàng 3 Tháng & Gợi Ý Mặt Hàng Khi Lên Đơn (Order Suggestions & 1-Click Reorder)
- **Thời gian hoàn thành:** 2026-10-09
- **Mã Jira / Task:** SN-43 (Parent Story: SN-39 / S4-04 - Sprint 4)
- **Tiêu đề:** "Là Nhân viên kinh doanh, tôi muốn xem lịch sử mua hàng của đại lý ngay khi gõ đơn, để gợi ý đúng mặt hàng khách vẫn lấy đều thay vì phải hỏi lại."
- **Tiêu chí chấp nhận (AC) đã đạt 100%:**
  1. **AC1 - Gợi ý mặt hàng 3 tháng gần nhất:** Tự động truy vấn tất cả đơn hàng hợp lệ của đại lý trong phạm vi 3 tháng qua (`createdAt >= now() - 3 months`), gom nhóm theo từng SKU / sản phẩm: `productId`, `sku`, `productName`, `unit`, `baseUnit`, `price`, `totalQuantity`, `orderCount`, `averageQuantity` (số lượng bình quân mỗi đơn), `lastPurchasedAt` (ngày mua gần nhất), `lastPurchasedQuantity` (số lượng mua ở lần gần nhất).
  2. **AC2 - 1-Click Reorder / Sao chép đơn gần nhất:** Cung cấp endpoint lấy chi tiết các dòng hàng của đơn hàng thành công gần nhất của đại lý để phục vụ thêm nhanh nguyên nhóm hàng cũ vào đơn mới.
  3. **AC3 - Ràng buộc bảo mật & phân quyền (RBAC Scope):** Nếu người dùng có vai trò `SALES_REP`, kiểm tra nghiêm ngặt xem đại lý có thuộc quyền phụ trách của nhân viên hay không (`customer.salesRepId === user.id`). Nếu không thuộc quyền phụ trách, lập tức ném lỗi `ForbiddenException("Bạn không có quyền xem thông tin của đại lý này")`. Vai trò `ADMIN` và `SALES_MANAGER` có toàn quyền truy cập mọi đại lý.
- **Danh sách file tạo mới / thay đổi:**
  - **Backend (`HTBH_Backend`):**
    - `src/modules/orders/dto/customer-purchase-history.dto.ts` (Tạo mới: `LOOKBACK_MONTHS = 3`, `SuggestedProductItem`, `LatestOrderItem`, `LatestOrderSummary`, `CustomerPurchaseHistoryResponse`).
    - `src/modules/orders/orders.service.ts` (Cập nhật: Bổ sung logic `getPurchaseHistorySuggestions()`, `getLatestCustomerOrder()`, `verifyCustomerAccess()`, làm giàu dữ liệu đơn hàng mẫu trong 3 tháng cho đại lý).
    - `src/modules/orders/orders.module.ts` (Cập nhật: Sử dụng `forwardRef(() => CustomersModule)` đồng bộ vòng lặp dependency).
    - `src/modules/customers/customers.module.ts` (Cập nhật: Import `forwardRef(() => OrdersModule)`).
    - `src/modules/customers/customers.controller.ts` (Cập nhật: Thêm 2 endpoints chuẩn RESTful `GET /api/customers/:customerId/purchase-history/suggestions` và `GET /api/customers/:customerId/orders/latest` được bảo vệ bởi `JwtAuthGuard`, `RolesGuard`, `@Roles(ADMIN, SALES_MANAGER, SALES_REP)`).
  - **Frontend (`HTBH_Frontend`):**
    - `src/types/order-suggestion.types.ts` (Tạo mới: `SuggestedProductItem`, `LatestOrderItem`, `LatestOrderSummary`, `CustomerPurchaseHistoryResponse` khớp 100% với Backend).
    - `src/services/order-suggestions.service.ts` (Tạo mới: `orderSuggestionsService` gọi API tập trung qua `apiClient` kèm fallback demo an toàn).
    - `src/components/order-suggestions-panel.tsx` (Tạo mới: Component widget hiển thị lịch sử gợi ý 3 tháng và nút 1-click reorder).
    - `src/pages/orders-page.tsx` (Cập nhật: Tích hợp `OrderSuggestionsPanel` vào Bước 2 tạo đơn hàng, các handler `handleAddSuggestedItem` và `handleReorderPreviousOrder`).
- **Trạng thái kiểm thử:**
  - Backend Spec Test: `npx ts-node test/customers-filter-sn37.spec.ts` -> 31/31 tests passed (100%).
  - Backend Spec Test: `npx ts-node test/products-sku-management-sn138.spec.ts` -> 62/62 tests passed (100%).
  - Backend Build: `nest build` -> 0 lỗi, 100% type-safe, không dùng `any`.
  - Frontend ESLint: `npx eslint` -> 0 lỗi, 0 warnings.
  - Frontend Build: `npm run build` (`tsc -b && vite build`) -> 0 lỗi, build production hoàn tất.
