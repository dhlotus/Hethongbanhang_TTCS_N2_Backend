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
