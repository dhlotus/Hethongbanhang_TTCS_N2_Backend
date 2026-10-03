# KIẾN TRÚC CƠ SỞ DỮ LIỆU POSTGRESQL - HỆ THỐNG LOHA SALES
> SN-17: xem [hướng dẫn kết nối ứng dụng và lưu hồ sơ](../../docs/sn-17-profile.md).
> Sau khi cài schema bên dưới, chạy `npm run db:migrate` để thêm migration 008.
> **Phiên bản:** 1.0.0  
> **Hệ quản trị:** PostgreSQL 14+  
> **Kiến trúc:** B2B Distribution & Warehouse Management System (9 Epics Cốt lõi)

---

## 1. TỔNG QUAN VÀ NGUYÊN TẮC THIẾT KẾ CỐT LÕI

Hệ thống cơ sở dữ liệu của **LOHA SALES** được thiết kế đáp ứng các tiêu chuẩn bảo mật, tính toàn vẹn dữ liệu (ACID) cao nhất trong ngành phân phối đồ uống & hàng tiêu dùng nhanh (FMCG B2B):

1. **Chuẩn hóa Đơn vị tính cơ sở (`base_unit`):**
   - Mọi số lượng trong Sổ tồn kho (`inventories`), Chi tiết đơn hàng (`order_items.base_quantity`), Phiếu xuất nhập kho (`goods_issue_items.base_quantity`), và Thẻ kho (`inventory_transactions.quantity_change`) **bắt buộc** được quy đổi và lưu trữ theo `base_unit` (Lon, Chai, Gói) - đơn vị nhỏ nhất.
   - Tránh hoàn toàn lỗi làm tròn hoặc sai lệch số lượng khi đại lý đặt Thùng (24 lon) hoặc Lốc (6 lon).

2. **Chống âm kho tuyệt đối trong giao dịch đồng thời (Concurrency Control):**
   - Ràng buộc cứng ở tầng database:
     ```sql
     CONSTRAINT chk_allocated_le_on_hand CHECK (on_hand >= allocated)
     ```
   - Hàm giữ chỗ tồn kho `fn_allocate_inventory_for_order(order_id)` thực thi trong Database Transaction và sử dụng khóa dòng:
     ```sql
     SELECT on_hand, allocated FROM inventories 
     WHERE warehouse_id = ... AND product_id = ... 
     FOR UPDATE;
     ```
     Đảm bảo khi nhiều nhân viên kinh doanh cùng bấm chốt đơn cho một SKU sắp hết hàng, giao dịch sẽ tuần tự hóa và rollback nếu không đủ tồn khả dụng (`available = on_hand - allocated`).

3. **Bảo mật giá vốn (`cost_price`) và Biên lợi nhuận:**
   - Trường `cost_price` trong bảng `products` và `inventory_batches` là dữ liệu nhạy cảm.
   - Chỉ có tài khoản vai trò `ADMIN` và `SALES_MANAGER` mới được truy xuất qua API.

4. **Kiểm soát giá sàn và Hạn mức công nợ tự động:**
   - Bảng `price_list_items` có ràng buộc `CHECK (price >= min_price)`. Nếu nhân viên bán dưới giá sàn, hệ thống tự động gắn cờ `is_below_floor_price = TRUE` và chuyển đơn sang `PENDING_APPROVAL`.
   - Hàm `fn_check_customer_credit(...)` tự động kiểm tra `current_debt + order_amount > credit_limit` và hóa đơn nợ quá `max_debt_days`.

---

## 2. ÁNH XẠ CẤU TRÚC BẢNG THEO 9 EPICS

| Phân hệ (Epic) | Bảng dữ liệu | Mục đích nghiệp vụ |
| :--- | :--- | :--- |
| **EP-01: Tài khoản & Phân quyền** | `roles`<br>`users`<br>`refresh_tokens`<br>`audit_logs`<br>`user_warehouses` | Quản lý 7 vai trò, xác thực JWT & Refresh Token Rotation, nhật ký kiểm toán (JSONB), phân công thủ kho phụ trách kho. |
| **EP-02: Danh mục Sản phẩm & Bảng giá** | `categories`<br>`suppliers`<br>`products`<br>`product_units`<br>`price_lists`<br>`price_list_items`<br>`discounts` | Cây danh mục 3 cấp, nhà cung cấp, SKU theo base_unit, quy cách đóng gói (Thùng/Lốc/Lon), bảng giá phân theo nhóm đại lý kèm giá sàn, chiết khấu bậc thang. |
| **EP-03: Đại lý & Hạn mức Công nợ** | `customers`<br>`customer_shipping_addresses` | Danh bạ đại lý, hạn mức tiền nợ (`credit_limit`), số ngày nợ tối đa (`max_debt_days`), dư nợ thời gian thực, nhiều điểm nhận hàng. |
| **EP-04: Đặt hàng & Duyệt đơn** | `orders`<br>`order_items`<br>`order_approvals` | Đơn hàng B2B, kiểm soát bán dưới giá sàn, quy đổi base_quantity, lịch sử phê duyệt ngoại lệ (Sales Manager / Kế toán). |
| **EP-05: Quản lý Kho & Tồn kho** | `warehouses`<br>`warehouse_locations`<br>`inventories`<br>`inventory_batches`<br>`inventory_transactions` | Kho vật lý, vị trí kệ/tầng (Aisle/Rack/Shelf), sổ tồn kho thời gian thực (on_hand, allocated, available), quản lý Lô & HSD (FEFO), thẻ kho bất biến (Audit Ledger). |
| **EP-06: Xuất kho & Giao hàng** | `goods_receipts`<br>`goods_receipt_items`<br>`goods_issues`<br>`goods_issue_items` | Phiếu nhập kho từ NCC, phiếu xuất kho giao hàng theo chuẩn FEFO, lưu vết bằng chứng giao hàng (POD). |
| **EP-07: Hóa đơn Bán hàng** | `invoices` | Hóa đơn tài chính phát sinh từ số lượng thực giao, theo dõi hạn thanh toán và trạng thái thanh toán. |
| **EP-08: Công nợ & Thanh toán** | `payments`<br>`payment_allocations`<br>`customer_debt_ledger` | Phiếu thu tiền, đối trừ nợ từng hóa đơn theo FIFO, sổ chi tiết công nợ và tự động chia nhóm tuổi nợ (`CURRENT`, `1_30_DAYS`, `31_60_DAYS`, `61_90_DAYS`, `OVER_90_DAYS`). |
| **EP-09: Trả hàng & Báo cáo** | `return_orders`<br>`return_order_items` | Quy trình nhập lại hàng trả về kho, đánh giá tình trạng hàng và ghi giảm trừ công nợ. |

---

## 3. THỨ TỰ THỰC THI MIGRATIONS

Hệ thống được tổ chức dạng các tệp SQL Migration tuần tự trong thư mục `src/database/migrations/`:

```
src/database/
├── schema_master.sql                                # Kịch bản cài đặt trọn gói 1 lệnh
├── migrations/
│   ├── 001_initial_schema_core_and_auth.sql         # EP-01: Roles, Users, Refresh Tokens, Audit Logs
│   ├── 002_products_and_pricing.sql                # EP-02: Categories, Suppliers, Products, Units, Price Lists, Discounts
│   ├── 003_customers_and_debt_config.sql           # EP-03: Customers, Shipping Addresses
│   ├── 004_warehouse_and_inventory.sql             # EP-05, EP-06: Warehouses, Locations, User-Warehouses, Inventories, Batches, Goods Receipts/Issues
│   ├── 005_orders_and_approvals.sql                # EP-04: Orders, Order Items, Approvals, FK Goods Issues
│   ├── 006_invoices_payments_and_debt.sql          # EP-07, EP-08, EP-09: Invoices, Payments, Debt Ledger, Return Orders
│   └── 007_functions_triggers_and_indexes.sql      # Triggers updated_at, fn_allocate_inventory, fn_confirm_goods_issue, fn_check_customer_credit
└── seeders/
    └── 001_seed_initial_data.sql                   # Dữ liệu ban đầu: 7 roles, tài khoản demo tiếng Việt, danh mục, kho, bảng giá, đại lý, tồn kho FEFO
```

---

## 4. HƯỚNG DẪN THỰC THI (DEPLOYMENT & SETUP GUIDE)

### Cách 1: Chạy toàn bộ lược đồ trong một lệnh duy nhất (Khuyên dùng)
Nếu sử dụng công cụ dòng lệnh `psql`:
```bash
# 1. Tạo cơ sở dữ liệu htbh_db (nếu chưa có)
psql -U postgres -c "CREATE DATABASE htbh_db ENCODING 'UTF8';"

# 2. Thực thi file master schema
psql -U postgres -d htbh_db -f src/database/schema_master.sql

# 3. Nạp dữ liệu mẫu ban đầu (Seed data)
psql -U postgres -d htbh_db -f src/database/seeders/001_seed_initial_data.sql
```

### Cách 2: Chạy từng bước Migration
```bash
psql -U postgres -d htbh_db -f src/database/migrations/001_initial_schema_core_and_auth.sql
psql -U postgres -d htbh_db -f src/database/migrations/002_products_and_pricing.sql
psql -U postgres -d htbh_db -f src/database/migrations/003_customers_and_debt_config.sql
psql -U postgres -d htbh_db -f src/database/migrations/004_warehouse_and_inventory.sql
psql -U postgres -d htbh_db -f src/database/migrations/005_orders_and_approvals.sql
psql -U postgres -d htbh_db -f src/database/migrations/006_invoices_payments_and_debt.sql
psql -U postgres -d htbh_db -f src/database/migrations/007_functions_triggers_and_indexes.sql
psql -U postgres -d htbh_db -f src/database/seeders/001_seed_initial_data.sql
```

### Cách 3: Chạy qua Docker Compose
Nếu dự án triển khai PostgreSQL qua container Docker:
```bash
docker exec -i <postgres-container-name> psql -U postgres -d htbh_db < src/database/schema_master.sql
docker exec -i <postgres-container-name> psql -U postgres -d htbh_db < src/database/seeders/001_seed_initial_data.sql
```

---

## 5. DANH SÁCH TÀI KHOẢN MẪU KHỞI TẠO (SEED ACCOUNTS)
Mật khẩu mặc định cho toàn bộ tài khoản demo: **`123456`**

| STT | Tên vai trò | Email Tiếng Việt | Email Quốc tế (Alias) | Username |
| :---: | :--- | :--- | :--- | :--- |
| 1 | **Quản trị hệ thống** | `quantrihethong@loha.vn` | `admin@loha.vn` | `quantrihethong` / `admin` |
| 2 | **Quản lý kinh doanh** | `quanlykinhdoanh@loha.vn` | `salesmanager@loha.vn` | `quanlykinhdoanh` / `salesmanager` |
| 3 | **Nhân viên kinh doanh** | `nhanvienkinhdoanh@loha.vn`| `sales@loha.vn` | `nhanvienkinhdoanh` / `sales` |
| 4 | **Quản lý kho** | `quanlykho@loha.vn` | `warehousemanager@loha.vn`| `quanlykho` / `warehousemanager` |
| 5 | **Thủ kho** | `thukho@loha.vn` | `warehouse@loha.vn` | `thukho` / `warehouse` |
| 6 | **Kế toán công nợ** | `ketoan@loha.vn` | `accountant@loha.vn` | `ketoan` / `accountant` |
| 7 | **Đại lý B2B** | `daily@loha.vn` | `dealer@loha.vn` | `daily` / `dealer` |
