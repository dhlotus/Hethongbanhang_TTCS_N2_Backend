-- =============================================================================
-- Migration 003: Phân hệ Đại lý & Hạn mức Công nợ (EP-03)
-- Hệ thống: LOHA SALES - Quản lý Bán hàng & Kho Doanh nghiệp B2B
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BẢNG CUSTOMERS (Đại lý / Điểm bán sỉ B2B)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    tax_code VARCHAR(50),
    customer_group VARCHAR(50) NOT NULL DEFAULT 'TIER_1',
    region VARCHAR(100),
    sales_rep_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    credit_limit NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
    current_debt NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (current_debt >= 0),
    max_debt_days INT NOT NULL DEFAULT 30 CHECK (max_debt_days >= 0),
    payment_terms VARCHAR(100) DEFAULT 'NET_30',
    phone VARCHAR(20),
    email VARCHAR(150),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'INACTIVE')),
    lock_reason TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE customers IS 'Danh mục Đại lý phân phối và cấu hình hạn mức công nợ (EP-03)';
COMMENT ON COLUMN customers.code IS 'Mã định danh duy nhất của đại lý (ví dụ: DL-HCM-001)';
COMMENT ON COLUMN customers.customer_group IS 'Nhóm đại lý (TIER_1, TIER_2, GOLD...) quyết định bảng giá tự động';
COMMENT ON COLUMN customers.sales_rep_id IS 'Nhân viên kinh doanh phụ trách quản lý tuyến và hỗ trợ lên đơn';
COMMENT ON COLUMN customers.user_id IS 'Tài khoản đăng nhập cổng tự đặt hàng dành riêng cho đại lý (Self-service)';
COMMENT ON COLUMN customers.credit_limit IS 'Hạn mức tiền nợ tối đa cho phép (Đơn hàng vượt hạn mức bắt buộc qua duyệt)';
COMMENT ON COLUMN customers.current_debt IS 'Dư nợ hiện tại theo thời gian thực (Cập nhật khi xuất hóa đơn hoặc thu tiền)';
COMMENT ON COLUMN customers.max_debt_days IS 'Số ngày cho phép nợ tối đa kể từ khi phát hành hóa đơn (Sau số ngày này tính là nợ quá hạn)';

CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(LOWER(code));
CREATE INDEX IF NOT EXISTS idx_customers_group ON customers(customer_group);
CREATE INDEX IF NOT EXISTS idx_customers_sales_rep ON customers(sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_debt ON customers(current_debt, credit_limit);

-- -----------------------------------------------------------------------------
-- 2. BẢNG CUSTOMER_SHIPPING_ADDRESSES (Các điểm giao hàng của đại lý)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_shipping_addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    receiver_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    address_line TEXT NOT NULL,
    ward VARCHAR(100),
    district VARCHAR(100),
    province VARCHAR(100) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE customer_shipping_addresses IS 'Danh sách các điểm nhận hàng của đại lý (EP-03)';
COMMENT ON COLUMN customer_shipping_addresses.is_default IS 'Địa chỉ giao hàng mặc định được gán tự động khi tạo đơn';

CREATE INDEX IF NOT EXISTS idx_customer_shipping_customer_id ON customer_shipping_addresses(customer_id);
