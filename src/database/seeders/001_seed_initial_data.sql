-- =============================================================================
-- Seeder 001: Khởi tạo Dữ liệu Mẫu Toàn diện Hệ thống LOHA SALES
-- Phân hệ: Đầy đủ 9 Epics (EP-01 đến EP-09)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. SEED ROLES (Danh mục 7 vai trò chuẩn hệ thống - EP-01)
-- =============================================================================
INSERT INTO roles (id, code, name, description)
VALUES 
    (1, 'ADMIN', 'Quản trị hệ thống', 'Toàn quyền cấu hình, bảo mật và quản trị toàn bộ hệ thống'),
    (2, 'SALES_MANAGER', 'Quản lý kinh doanh', 'Phê duyệt giá bán dưới sàn, duyệt vượt hạn mức nợ, quản lý bảng giá và chiết khấu'),
    (3, 'SALES_REP', 'Nhân viên kinh doanh', 'Quản lý địa bàn đại lý, hỗ trợ lên đơn và theo dõi tiến độ giao hàng'),
    (4, 'WAREHOUSE_MANAGER', 'Quản lý kho', 'Quản lý kho hàng, phê duyệt phiếu kiểm kê và điều chuyển nội bộ'),
    (5, 'WAREHOUSE_KEEPER', 'Thủ kho', 'Thực hiện soạn hàng theo FEFO, nhập kho, đóng gói và xác nhận xuất kho'),
    (6, 'ACCOUNTANT', 'Kế toán công nợ', 'Đối soát công nợ đại lý, ghi nhận phiếu thu, xử lý hóa đơn và tuổi nợ'),
    (7, 'CUSTOMER', 'Đại lý / Khách hàng B2B', 'Cổng tự phục vụ đặt hàng trực tuyến, tra cứu tiến độ đơn và bảng đối chiếu công nợ')
ON CONFLICT (id) DO UPDATE SET 
    code = EXCLUDED.code, 
    name = EXCLUDED.name, 
    description = EXCLUDED.description;

-- Cập nhật sequence của bảng roles
SELECT setval('roles_id_seq', (SELECT MAX(id) FROM roles));

-- =============================================================================
-- 2. SEED USERS (Tài khoản chuẩn hóa và tài khoản tiếng Việt theo demo.txt - EP-01)
-- Password mặc định: 123456 (Mã hóa bcrypt bằng pgcrypto)
-- =============================================================================
DO $$
DECLARE
    v_password_hash VARCHAR(255);
BEGIN
    v_password_hash := crypt('123456', gen_salt('bf', 10));

    -- Tài khoản Quản trị hệ thống (Admin)
    INSERT INTO users (id, username, email, password_hash, full_name, phone, role_id, status)
    VALUES 
        ('00000000-0000-0000-0000-000000000001', 'admin', 'admin@loha.vn', v_password_hash, 'Nguyễn Văn Admin', '0901000001', 1, 'ACTIVE'),
        ('00000000-0000-0000-0000-000000000011', 'quantrihethong', 'quantrihethong@loha.vn', v_password_hash, 'Quản Trị Viên Hệ Thống', '0901000011', 1, 'ACTIVE')
    ON CONFLICT (username) DO UPDATE SET 
        password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

    -- Tài khoản Quản lý kinh doanh (Sales Manager)
    INSERT INTO users (id, username, email, password_hash, full_name, phone, role_id, status)
    VALUES 
        ('00000000-0000-0000-0000-000000000002', 'salesmanager', 'salesmanager@loha.vn', v_password_hash, 'Lê Hoàng Trưởng Phòng', '0902000002', 2, 'ACTIVE'),
        ('00000000-0000-0000-0000-000000000012', 'quanlykinhdoanh', 'quanlykinhdoanh@loha.vn', v_password_hash, 'Giám Đốc Kinh Doanh LOHA', '0902000012', 2, 'ACTIVE')
    ON CONFLICT (username) DO UPDATE SET 
        password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

    -- Tài khoản Nhân viên kinh doanh (Sales Rep)
    INSERT INTO users (id, username, email, password_hash, full_name, phone, role_id, status)
    VALUES 
        ('00000000-0000-0000-0000-000000000003', 'sales', 'sales@loha.vn', v_password_hash, 'Trần Văn Nam', '0903000003', 3, 'ACTIVE'),
        ('00000000-0000-0000-0000-000000000013', 'nhanvienkinhdoanh', 'nhanvienkinhdoanh@loha.vn', v_password_hash, 'Nguyễn Thị Bích Sales', '0903000013', 3, 'ACTIVE')
    ON CONFLICT (username) DO UPDATE SET 
        password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

    -- Tài khoản Quản lý kho (Warehouse Manager)
    INSERT INTO users (id, username, email, password_hash, full_name, phone, role_id, status)
    VALUES 
        ('00000000-0000-0000-0000-000000000004', 'warehousemanager', 'warehousemanager@loha.vn', v_password_hash, 'Đỗ Quốc Bảo', '0904000004', 4, 'ACTIVE'),
        ('00000000-0000-0000-0000-000000000014', 'quanlykho', 'quanlykho@loha.vn', v_password_hash, 'Vũ Thành Long Quản Kho', '0904000014', 4, 'ACTIVE')
    ON CONFLICT (username) DO UPDATE SET 
        password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

    -- Tài khoản Thủ kho (Warehouse Keeper)
    INSERT INTO users (id, username, email, password_hash, full_name, phone, role_id, status)
    VALUES 
        ('00000000-0000-0000-0000-000000000005', 'warehouse', 'warehouse@loha.vn', v_password_hash, 'Phạm Hùng Kho', '0905000005', 5, 'ACTIVE'),
        ('00000000-0000-0000-0000-000000000015', 'thukho', 'thukho@loha.vn', v_password_hash, 'Hoàng Minh Tuấn Thủ Kho', '0905000015', 5, 'ACTIVE')
    ON CONFLICT (username) DO UPDATE SET 
        password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

    -- Tài khoản Kế toán công nợ (Accountant)
    INSERT INTO users (id, username, email, password_hash, full_name, phone, role_id, status)
    VALUES 
        ('00000000-0000-0000-0000-000000000006', 'accountant', 'accountant@loha.vn', v_password_hash, 'Vũ Mai Hoa', '0906000006', 6, 'ACTIVE'),
        ('00000000-0000-0000-0000-000000000016', 'ketoan', 'ketoan@loha.vn', v_password_hash, 'Đặng Thu Hương Kế Toán', '0906000016', 6, 'ACTIVE')
    ON CONFLICT (username) DO UPDATE SET 
        password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;

    -- Tài khoản Khách hàng / Đại lý B2B (Customer)
    INSERT INTO users (id, username, email, password_hash, full_name, phone, role_id, status)
    VALUES 
        ('00000000-0000-0000-0000-000000000007', 'dealer', 'dealer@loha.vn', v_password_hash, 'Đại Lý Cửa Hàng Minh Khang', '0907000007', 7, 'ACTIVE'),
        ('00000000-0000-0000-0000-000000000017', 'daily', 'daily@loha.vn', v_password_hash, 'Đại Lý Bán Buôn An Bình', '0907000017', 7, 'ACTIVE')
    ON CONFLICT (username) DO UPDATE SET 
        password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name;
END $$;

-- =============================================================================
-- 3. SEED WAREHOUSES & LOCATIONS (Kho hàng & Vị trí - EP-05)
-- =============================================================================
INSERT INTO warehouses (id, code, name, address, phone, manager_id, status)
VALUES 
    ('11111111-0000-0000-0000-000000000001', 'KHO-MN-01', 'Kho Tổng Miền Nam', 'Số 18 Đại lộ Độc Lập, KCN Sóng Thần 1, Dĩ An, Bình Dương', '02743790001', '00000000-0000-0000-0000-000000000004', 'ACTIVE'),
    ('11111111-0000-0000-0000-000000000002', 'KHO-MB-01', 'Kho Phân Phối Hà Nội', 'Lô CN-05 KCN Ninh Hiệp, Gia Lâm, Hà Nội', '02438890002', '00000000-0000-0000-0000-000000000014', 'ACTIVE'),
    ('11111111-0000-0000-0000-000000000003', 'KHO-MT-01', 'Kho Vùng Tây Nam Bộ', 'Đường số 3 KCN Trà Nóc 1, Bình Thủy, Cần Thơ', '02923890003', NULL, 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- Vị trí kệ trong Kho Tổng Miền Nam
INSERT INTO warehouse_locations (id, warehouse_id, code, zone, aisle, rack, shelf, bin, status)
VALUES 
    ('11111111-1000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'KMN-A1-T1-01', 'KHU_KHO', 'A1', 'R1', 'S1', 'B01', 'ACTIVE'),
    ('11111111-1000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'KMN-A1-T1-02', 'KHU_KHO', 'A1', 'R1', 'S1', 'B02', 'ACTIVE'),
    ('11111111-1000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'KMN-B2-T2-01', 'KHU_MAT', 'B2', 'R2', 'S2', 'B01', 'ACTIVE')
ON CONFLICT (warehouse_id, code) DO NOTHING;

-- Gán nhân viên thủ kho vào kho được phân công (user_warehouses)
INSERT INTO user_warehouses (user_id, warehouse_id, is_primary)
VALUES 
    ('00000000-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000001', TRUE),
    ('00000000-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000001', FALSE),
    ('00000000-0000-0000-0000-000000000015', '11111111-0000-0000-0000-000000000002', TRUE)
ON CONFLICT (user_id, warehouse_id) DO NOTHING;

-- =============================================================================
-- 4. SEED CATEGORIES (Nhóm ngành hàng cây 3 cấp - EP-02)
-- =============================================================================
-- Cấp 1 (Gốc)
INSERT INTO categories (id, code, name, parent_id, level, path, status)
VALUES 
    (1, 'BEVERAGE', 'Đồ uống & Nước giải khát', NULL, 1, '/1/', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name;

-- Cấp 2
INSERT INTO categories (id, code, name, parent_id, level, path, status)
VALUES 
    (2, 'CARBONATED', 'Nước ngọt có ga', 1, 2, '/1/2/', 'ACTIVE'),
    (3, 'WATER', 'Nước tinh khiết & Khoáng thiên nhiên', 1, 2, '/1/3/', 'ACTIVE'),
    (4, 'TEA_JUICE', 'Trà & Nước hoa quả đóng chai', 1, 2, '/1/4/', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name;

-- Cấp 3
INSERT INTO categories (id, code, name, parent_id, level, path, status)
VALUES 
    (5, 'COLA_CAN', 'Nước ngọt vị Cola đóng lon 330ml', 2, 3, '/1/2/5/', 'ACTIVE'),
    (6, 'ORANGE_CAN', 'Nước ngọt vị Cam đóng lon 330ml', 2, 3, '/1/2/6/', 'ACTIVE'),
    (7, 'PURE_BOTTLE', 'Nước khoáng đóng chai PET 500ml', 3, 3, '/1/3/7/', 'ACTIVE'),
    (8, 'GREEN_TEA', 'Trà xanh thanh nhiệt đóng chai 455ml', 4, 3, '/1/4/8/', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name;

SELECT setval('categories_id_seq', (SELECT MAX(id) FROM categories));

-- =============================================================================
-- 5. SEED SUPPLIERS (Nhà cung cấp - EP-02)
-- =============================================================================
INSERT INTO suppliers (id, code, name, tax_code, contact_name, phone, email, address, payment_terms)
VALUES 
    ('22222222-0000-0000-0000-000000000001', 'NCC-BEV-01', 'Công ty Cổ phần Nước giải khát LOHA Quốc Tế', '0312345678', 'Ông Đỗ Quốc Tuấn', '02838123456', 'supply@loha.vn', 'KCN Tân Bình, Tây Thạnh, Tân Phú, TP.HCM', 'NET_45'),
    ('22222222-0000-0000-0000-000000000002', 'NCC-AQUA-02', 'Công ty TNHH Khai Thác Khoáng Tinh Khiết Aqua Life', '0398765432', 'Bà Mai Thị Lan', '02723789012', 'contact@aqualife.vn', 'Xã Long Hậu, Cần Giuộc, Long An', 'NET_30')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 6. SEED PRODUCTS (Danh mục SKU - Chuẩn hóa base_unit - EP-02)
-- =============================================================================
INSERT INTO products (id, sku, name, category_id, supplier_id, base_unit, cost_price, is_batch_managed, status)
VALUES 
    ('33333333-0000-0000-0000-000000000001', 'LOHA-COLA-330', 'Nước ngọt có ga LOHA Cola 330ml', 5, '22222222-0000-0000-0000-000000000001', 'Lon', 6500.00, TRUE, 'ACTIVE'),
    ('33333333-0000-0000-0000-000000000002', 'LOHA-ORANGE-330', 'Nước ngọt vị Cam ép LOHA Orange 330ml', 6, '22222222-0000-0000-0000-000000000001', 'Lon', 6500.00, TRUE, 'ACTIVE'),
    ('33333333-0000-0000-0000-000000000003', 'LOHA-PURE-500', 'Nước khoáng thiên nhiên LOHA Pure 500ml', 7, '22222222-0000-0000-0000-000000000002', 'Chai', 3200.00, TRUE, 'ACTIVE'),
    ('33333333-0000-0000-0000-000000000004', 'LOHA-TEA-455', 'Trà xanh không độ LOHA Tea 455ml', 8, '22222222-0000-0000-0000-000000000001', 'Chai', 5400.00, TRUE, 'ACTIVE')
ON CONFLICT (sku) DO NOTHING;

-- =============================================================================
-- 7. SEED PRODUCT_UNITS (Quy cách đóng gói & Hệ số quy đổi về base_unit - EP-02)
-- =============================================================================
-- LOHA-COLA-330: Lon (1), Lốc (6 Lon), Thùng (24 Lon)
INSERT INTO product_units (id, product_id, unit_name, conversion_factor, is_base_unit)
VALUES 
    ('33333333-1000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 'Lon', 1.00, TRUE),
    ('33333333-1000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', 'Lốc 6', 6.00, FALSE),
    ('33333333-1000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000001', 'Thùng 24', 24.00, FALSE)
ON CONFLICT (product_id, unit_name) DO NOTHING;

-- LOHA-ORANGE-330: Lon (1), Lốc (6 Lon), Thùng (24 Lon)
INSERT INTO product_units (id, product_id, unit_name, conversion_factor, is_base_unit)
VALUES 
    ('33333333-2000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000002', 'Lon', 1.00, TRUE),
    ('33333333-2000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002', 'Lốc 6', 6.00, FALSE),
    ('33333333-2000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000002', 'Thùng 24', 24.00, FALSE)
ON CONFLICT (product_id, unit_name) DO NOTHING;

-- LOHA-PURE-500: Chai (1), Lốc (6 Chai), Thùng (24 Chai)
INSERT INTO product_units (id, product_id, unit_name, conversion_factor, is_base_unit)
VALUES 
    ('33333333-3000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', 'Chai', 1.00, TRUE),
    ('33333333-3000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000003', 'Lốc 6', 6.00, FALSE),
    ('33333333-3000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000003', 'Thùng 24', 24.00, FALSE)
ON CONFLICT (product_id, unit_name) DO NOTHING;

-- LOHA-TEA-455: Chai (1), Lốc (6 Chai), Thùng (24 Chai)
INSERT INTO product_units (id, product_id, unit_name, conversion_factor, is_base_unit)
VALUES 
    ('33333333-4000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000004', 'Chai', 1.00, TRUE),
    ('33333333-4000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000004', 'Lốc 6', 6.00, FALSE),
    ('33333333-4000-0000-0000-000000000003', '33333333-0000-0000-0000-000000000004', 'Thùng 24', 24.00, FALSE)
ON CONFLICT (product_id, unit_name) DO NOTHING;

-- =============================================================================
-- 8. SEED PRICE_LISTS & ITEMS (Bảng giá bán buôn & Giá sàn - EP-02)
-- =============================================================================
-- Bảng giá Đại lý Cấp 1 (TIER_1)
INSERT INTO price_lists (id, code, name, customer_group, start_date, end_date, is_default, status)
VALUES 
    ('44444444-0000-0000-0000-000000000001', 'BG-TIER1-2026', 'Bảng giá Đại lý Cấp 1 Toàn Quốc 2026', 'TIER_1', '2026-01-01 00:00:00+07', '2026-12-31 23:59:59+07', TRUE, 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- Chi tiết giá cho Bảng giá Cấp 1 (Giá bán và Giá sàn min_price)
INSERT INTO price_list_items (price_list_id, product_id, unit_id, price, min_price)
VALUES 
    -- Cola Lon / Lốc / Thùng
    ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '33333333-1000-0000-0000-000000000001', 9500.00, 8500.00),
    ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '33333333-1000-0000-0000-000000000002', 56000.00, 50000.00),
    ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '33333333-1000-0000-0000-000000000003', 220000.00, 200000.00),
    -- Nước Pure Chai / Lốc / Thùng
    ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', '33333333-3000-0000-0000-000000000001', 5000.00, 4200.00),
    ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', '33333333-3000-0000-0000-000000000002', 29000.00, 25000.00),
    ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', '33333333-3000-0000-0000-000000000003', 110000.00, 96000.00)
ON CONFLICT (price_list_id, product_id, unit_id) DO NOTHING;

-- Chiết khấu theo sản lượng (Mua từ 1200 lon = 50 thùng được giảm 3%)
INSERT INTO discounts (id, code, name, product_id, min_quantity, discount_type, discount_value, start_date, end_date, status)
VALUES 
    ('44444444-9000-0000-0000-000000000001', 'CK-COLA-50THUNG', 'Chiết khấu 3% khi mua từ 50 thùng Cola', '33333333-0000-0000-0000-000000000001', 1200.00, 'PERCENTAGE', 3.00, '2026-01-01 00:00:00+07', '2026-12-31 23:59:59+07', 'ACTIVE')
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 9. SEED CUSTOMERS & SHIPPING ADDRESSES (Đại lý & Hạn mức nợ - EP-03)
-- =============================================================================
INSERT INTO customers (id, code, name, tax_code, customer_group, region, sales_rep_id, user_id, credit_limit, current_debt, max_debt_days, phone, email, status)
VALUES 
    ('55555555-0000-0000-0000-000000000001', 'DL-MK-001', 'Đại Lý Cửa Hàng Minh Khang', '0314455667', 'TIER_1', 'MIEN_NAM', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000007', 150000000.00, 25000000.00, 30, '0907000007', 'dealer@loha.vn', 'ACTIVE'),
    ('55555555-0000-0000-0000-000000000002', 'DL-AB-002', 'Đại Lý Bán Buôn An Bình', '0318899112', 'TIER_1', 'MIEN_BAC', '00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000017', 300000000.00, 0.00, 45, '0907000017', 'daily@loha.vn', 'ACTIVE'),
    ('55555555-0000-0000-0000-000000000003', 'DL-HT-003', 'Tạp Hóa Phân Phối Hưng Thịnh', '0319988776', 'TIER_2', 'TAY_NAM_BO', '00000000-0000-0000-0000-000000000003', NULL, 50000000.00, 52000000.00, 15, '0909112233', 'hungthinh@gmail.com', 'LOCKED')
ON CONFLICT (code) DO NOTHING;

-- Điểm nhận hàng của Đại lý Minh Khang
INSERT INTO customer_shipping_addresses (id, customer_id, receiver_name, phone, address_line, ward, district, province, is_default)
VALUES 
    ('55555555-1000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', 'Anh Minh (Chủ đại lý)', '0907000007', 'Số 245 Đường Kha Vạn Cân', 'Hiệp Bình Chánh', 'TP. Thủ Đức', 'TP. Hồ Chí Minh', TRUE),
    ('55555555-1000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000001', 'Kho Chi Nhánh 2 - Minh Khang', '0907000008', 'Số 88 Lê Văn Việt', 'Tăng Nhơn Phú B', 'TP. Thủ Đức', 'TP. Hồ Chí Minh', FALSE)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- 10. SEED INVENTORIES & BATCHES (Sổ tồn kho & Quản lý lô FEFO - EP-05)
-- =============================================================================
-- Khởi tạo tồn kho ban đầu (Chuẩn hóa base_unit Lon/Chai)
INSERT INTO inventories (warehouse_id, product_id, on_hand, allocated, min_threshold, max_threshold)
VALUES 
    -- Kho Tổng Miền Nam
    ('11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', 24000.00, 2400.00, 2400.00, 50000.00), -- 1000 thùng Cola, giữ chỗ 100 thùng
    ('11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000002', 12000.00, 0.00, 1200.00, 30000.00),    -- 500 thùng Cam
    ('11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000003', 48000.00, 480.00, 4800.00, 100000.00),  -- 2000 thùng Nước Pure
    ('11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000004', 19200.00, 0.00, 2400.00, 50000.00),    -- 800 thùng Trà xanh
    -- Kho Phân Phối Hà Nội
    ('11111111-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000001', 12000.00, 0.00, 2400.00, 30000.00)
ON CONFLICT (warehouse_id, product_id) DO NOTHING;

-- Các Lô hàng mô phỏng nguyên tắc FEFO (First Expired, First Out)
INSERT INTO inventory_batches (id, batch_number, product_id, warehouse_id, location_id, mfg_date, expiry_date, quantity, allocated_quantity, cost_price, status)
VALUES 
    -- Lô 1 Cola: HSD gần hơn (2026-11-30) -> Sẽ được FEFO ưu tiên xuất trước
    ('66666666-0000-0000-0000-000000000001', 'LOT-COLA-2026A', '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000001', '2025-11-30', '2026-11-30', 9600.00, 2400.00, 6500.00, 'ACTIVE'),
    -- Lô 2 Cola: HSD xa hơn (2027-04-30)
    ('66666666-0000-0000-0000-000000000002', 'LOT-COLA-2026B', '33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', '11111111-1000-0000-0000-000000000002', '2026-04-30', '2027-04-30', 14400.00, 0.00, 6500.00, 'ACTIVE')
ON CONFLICT (warehouse_id, product_id, batch_number) DO NOTHING;

-- Ghi thẻ kho đầu kỳ (Audit Ledger - Idempotent Check)
INSERT INTO inventory_transactions (warehouse_id, product_id, batch_id, transaction_type, quantity_change, balance_after, unit_cost, reference_type, reference_id, notes, created_by)
SELECT '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001', 'IMPORT', 9600.00, 9600.00, 6500.00, 'GOODS_RECEIPT', 'PNK-INIT-001', 'Nhập tồn đầu kỳ Lô 2026A', '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM inventory_transactions WHERE reference_type = 'GOODS_RECEIPT' AND reference_id = 'PNK-INIT-001');

INSERT INTO inventory_transactions (warehouse_id, product_id, batch_id, transaction_type, quantity_change, balance_after, unit_cost, reference_type, reference_id, notes, created_by)
SELECT '11111111-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000002', 'IMPORT', 14400.00, 24000.00, 6500.00, 'GOODS_RECEIPT', 'PNK-INIT-002', 'Nhập tồn đầu kỳ Lô 2026B', '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM inventory_transactions WHERE reference_type = 'GOODS_RECEIPT' AND reference_id = 'PNK-INIT-002');

-- =============================================================================
-- 11. SEED MẪU ĐƠN HÀNG, HÓA ĐƠN & CÔNG NỢ (EP-04, EP-07, EP-08)
-- =============================================================================
-- Đơn hàng mẫu của Đại lý Minh Khang
INSERT INTO orders (id, code, customer_id, shipping_address_id, sales_rep_id, warehouse_id, order_source, status, approval_status, total_amount, discount_amount, tax_amount, final_amount, delivery_deadline)
VALUES 
    ('77777777-0000-0000-0000-000000000001', 'DH-2026-0001', '55555555-0000-0000-0000-000000000001', '55555555-1000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001', 'SALES_REP', 'ALLOCATED', 'NONE', 22000000.00, 660000.00, 0.00, 21340000.00, CURRENT_TIMESTAMP + INTERVAL '2 days')
ON CONFLICT (code) DO NOTHING;

-- Dòng hàng trong đơn (100 thùng Cola = 2400 lon)
INSERT INTO order_items (id, order_id, product_id, unit_id, quantity, conversion_factor, base_quantity, unit_price, floor_price, is_below_floor_price, discount_percent, discount_amount, total_price)
VALUES 
    ('77777777-1000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001', '33333333-1000-0000-0000-000000000003', 100.00, 24.00, 2400.00, 220000.00, 200000.00, FALSE, 3.00, 660000.00, 21340000.00)
ON CONFLICT (id) DO NOTHING;

-- Hóa đơn phát sinh trước đó của Đại lý Minh Khang (Dư nợ 25 triệu)
INSERT INTO invoices (id, code, order_id, customer_id, issue_date, due_date, subtotal, discount_amount, tax_amount, total_amount, paid_amount, remaining_amount, payment_status)
VALUES 
    ('88888888-0000-0000-0000-000000000001', 'HD-2026-0001', '77777777-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000001', CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '20 days', 25000000.00, 0.00, 0.00, 25000000.00, 0.00, 25000000.00, 'UNPAID')
ON CONFLICT (code) DO NOTHING;

-- Ghi sổ chi tiết công nợ cho hóa đơn trên (Idempotent Check)
INSERT INTO customer_debt_ledger (customer_id, transaction_type, reference_type, reference_id, debit_amount, credit_amount, balance_after, due_date, aging_bucket, notes)
SELECT '55555555-0000-0000-0000-000000000001', 'INVOICE_ISSUED', 'INVOICE', 'HD-2026-0001', 25000000.00, 0.00, 25000000.00, CURRENT_DATE + INTERVAL '20 days', 'CURRENT', 'Phát hành hóa đơn HD-2026-0001'
WHERE NOT EXISTS (SELECT 1 FROM customer_debt_ledger WHERE reference_type = 'INVOICE' AND reference_id = 'HD-2026-0001');
