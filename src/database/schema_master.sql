-- =============================================================================
-- MASTER DATABASE SCHEMA DDL - LOHA SALES SYSTEM
-- Hệ thống Quản lý Bán hàng & Kho Doanh nghiệp B2B (9 Epics Cốt lõi)
-- Tương thích: PostgreSQL 14+
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. PHÂN HỆ TÀI KHOẢN & PHÂN QUYỀN (EP-01)
-- =============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE roles IS 'Danh mục vai trò người dùng trong hệ thống (EP-01)';

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    role_id INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'INACTIVE')),
    locked_until TIMESTAMPTZ,
    failed_attempts INT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(50) NOT NULL,
    entity_name VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_name, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- =============================================================================
-- 2. PHÂN HỆ DANH MỤC SẢN PHẨM & BẢNG GIÁ (EP-02)
-- =============================================================================

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    parent_id INT REFERENCES categories(id) ON DELETE RESTRICT,
    level INT NOT NULL DEFAULT 1 CHECK (level >= 1),
    path VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_path ON categories(path);

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    tax_code VARCHAR(50),
    contact_name VARCHAR(150),
    phone VARCHAR(20),
    email VARCHAR(150),
    address TEXT,
    payment_terms VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(code);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category_id INT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    base_unit VARCHAR(30) NOT NULL,
    cost_price NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    is_batch_managed BOOLEAN NOT NULL DEFAULT TRUE,
    barcode VARCHAR(50),
    image_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON COLUMN products.cost_price IS 'Giá vốn sản phẩm - Chỉ cấp quyền truy xuất cho Sales Manager và Admin';
COMMENT ON COLUMN products.base_unit IS 'Đơn vị tính cơ sở nhỏ nhất - Mọi giao dịch kho & công nợ phải quy về đơn vị này';

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(LOWER(sku));
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS product_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_name VARCHAR(50) NOT NULL,
    conversion_factor NUMERIC(10, 2) NOT NULL CHECK (conversion_factor > 0),
    is_base_unit BOOLEAN NOT NULL DEFAULT FALSE,
    barcode VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_product_unit_name UNIQUE (product_id, unit_name)
);

CREATE INDEX IF NOT EXISTS idx_product_units_product_id ON product_units(product_id);

CREATE TABLE IF NOT EXISTS price_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    customer_group VARCHAR(50) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_price_list_dates CHECK (end_date IS NULL OR end_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_price_lists_customer_group ON price_lists(customer_group);
CREATE INDEX IF NOT EXISTS idx_price_lists_dates ON price_lists(start_date, end_date);

CREATE TABLE IF NOT EXISTS price_list_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    price_list_id UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES product_units(id) ON DELETE RESTRICT,
    price NUMERIC(15, 2) NOT NULL CHECK (price >= 0),
    min_price NUMERIC(15, 2) NOT NULL CHECK (min_price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_price_list_item UNIQUE (price_list_id, product_id, unit_id),
    CONSTRAINT chk_price_min_floor CHECK (price >= min_price)
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_lookup ON price_list_items(price_list_id, product_id, unit_id);

CREATE TABLE IF NOT EXISTS discounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    min_quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FIXED_AMOUNT')),
    discount_value NUMERIC(15, 2) NOT NULL CHECK (discount_value > 0),
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discounts_product_id ON discounts(product_id);
CREATE INDEX IF NOT EXISTS idx_discounts_dates ON discounts(start_date, end_date);

-- =============================================================================
-- 3. PHÂN HỆ ĐẠI LÝ & HẠN MỨC CÔNG NỢ (EP-03)
-- =============================================================================

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

CREATE INDEX IF NOT EXISTS idx_customers_code ON customers(LOWER(code));
CREATE INDEX IF NOT EXISTS idx_customers_group ON customers(customer_group);
CREATE INDEX IF NOT EXISTS idx_customers_sales_rep ON customers(sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_debt ON customers(current_debt, credit_limit);

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

CREATE INDEX IF NOT EXISTS idx_customer_shipping_customer_id ON customer_shipping_addresses(customer_id);

-- =============================================================================
-- 4. PHÂN HỆ QUẢN LÝ KHO, TỒN KHO & XUẤT NHẬP HÀNG (EP-05, EP-06)
-- =============================================================================

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    phone VARCHAR(20),
    manager_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(code);
CREATE INDEX IF NOT EXISTS idx_warehouses_status ON warehouses(status);

CREATE TABLE IF NOT EXISTS warehouse_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    zone VARCHAR(50) NOT NULL DEFAULT 'DEFAULT',
    aisle VARCHAR(20),
    rack VARCHAR(20),
    shelf VARCHAR(20),
    bin VARCHAR(20),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MAINTENANCE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_warehouse_location UNIQUE (warehouse_id, code)
);

CREATE INDEX IF NOT EXISTS idx_locations_warehouse ON warehouse_locations(warehouse_id);

CREATE TABLE IF NOT EXISTS user_warehouses (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_user_warehouses_user ON user_warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouses_wh ON user_warehouses(warehouse_id);

CREATE TABLE IF NOT EXISTS inventories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    on_hand NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
    allocated NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (allocated >= 0),
    available NUMERIC(15, 2) GENERATED ALWAYS AS (on_hand - allocated) STORED,
    min_threshold NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (min_threshold >= 0),
    max_threshold NUMERIC(15, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inventory_wh_product UNIQUE (warehouse_id, product_id),
    CONSTRAINT chk_allocated_le_on_hand CHECK (on_hand >= allocated),
    CONSTRAINT chk_max_ge_min CHECK (max_threshold IS NULL OR max_threshold >= min_threshold)
);

CREATE INDEX IF NOT EXISTS idx_inventories_lookup ON inventories(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventories_available ON inventories(warehouse_id, product_id, available);

CREATE TABLE IF NOT EXISTS inventory_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_number VARCHAR(100) NOT NULL,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    mfg_date DATE,
    expiry_date DATE NOT NULL,
    quantity NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    allocated_quantity NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (allocated_quantity >= 0),
    cost_price NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'RECALLED', 'DEPLETED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_batch_wh_prod UNIQUE (warehouse_id, product_id, batch_number),
    CONSTRAINT chk_batch_allocated CHECK (quantity >= allocated_quantity)
);

CREATE INDEX IF NOT EXISTS idx_batches_fefo ON inventory_batches(product_id, warehouse_id, expiry_date ASC) WHERE status = 'ACTIVE' AND quantity > 0;
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON inventory_batches(expiry_date);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id BIGSERIAL PRIMARY KEY,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('IMPORT', 'EXPORT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'RETURN_IMPORT')),
    quantity_change NUMERIC(15, 2) NOT NULL,
    balance_after NUMERIC(15, 2) NOT NULL CHECK (balance_after >= 0),
    unit_cost NUMERIC(15, 2) DEFAULT 0,
    reference_type VARCHAR(50) NOT NULL,
    reference_id VARCHAR(100) NOT NULL,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_trans_lookup ON inventory_transactions(warehouse_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_trans_ref ON inventory_transactions(reference_type, reference_id);

CREATE TABLE IF NOT EXISTS goods_receipts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    receipt_type VARCHAR(50) NOT NULL DEFAULT 'PURCHASE_RECEIPT' CHECK (receipt_type IN ('PURCHASE_RECEIPT', 'TRANSFER_RECEIPT', 'RETURN_RECEIPT', 'ADJUSTMENT_RECEIPT')),
    reference_document VARCHAR(100),
    document_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'CANCELLED')),
    total_cost NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
    received_by UUID REFERENCES users(id) ON DELETE SET NULL,
    received_at TIMESTAMPTZ,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_code ON goods_receipts(code);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON goods_receipts(status);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    receipt_id UUID NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES product_units(id) ON DELETE RESTRICT,
    package_quantity NUMERIC(12, 2) NOT NULL CHECK (package_quantity > 0),
    conversion_factor NUMERIC(10, 2) NOT NULL CHECK (conversion_factor > 0),
    base_quantity NUMERIC(15, 2) NOT NULL CHECK (base_quantity > 0),
    unit_cost NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    total_cost NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
    batch_number VARCHAR(100) NOT NULL,
    mfg_date DATE,
    expiry_date DATE NOT NULL,
    location_id UUID REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON goods_receipt_items(receipt_id);

CREATE TABLE IF NOT EXISTS goods_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    order_id UUID, -- Sẽ được tham chiếu sau khi tạo orders
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    issue_type VARCHAR(50) NOT NULL DEFAULT 'SALE_EXPORT' CHECK (issue_type IN ('SALE_EXPORT', 'TRANSFER_EXPORT', 'DISPOSAL_EXPORT', 'ADJUSTMENT_EXPORT')),
    shipping_address_id UUID REFERENCES customer_shipping_addresses(id) ON DELETE SET NULL,
    picker_id UUID REFERENCES users(id) ON DELETE SET NULL,
    driver_name VARCHAR(150),
    driver_phone VARCHAR(20),
    proof_of_delivery_url TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PICKING', 'READY_FOR_SHIPMENT', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED')),
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_goods_issues_code ON goods_issues(code);
CREATE INDEX IF NOT EXISTS idx_goods_issues_status ON goods_issues(status);

CREATE TABLE IF NOT EXISTS goods_issue_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    issue_id UUID NOT NULL REFERENCES goods_issues(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES inventory_batches(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES product_units(id) ON DELETE RESTRICT,
    requested_quantity NUMERIC(12, 2) NOT NULL CHECK (requested_quantity > 0),
    actual_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (actual_quantity >= 0),
    conversion_factor NUMERIC(10, 2) NOT NULL CHECK (conversion_factor > 0),
    base_quantity NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (base_quantity >= 0),
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issue_items_issue_id ON goods_issue_items(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_items_batch_id ON goods_issue_items(batch_id);

-- =============================================================================
-- 5. PHÂN HỆ ĐẶT HÀNG, KIỂM SOÁT GIÁ SÀN & DUYỆT ĐƠN (EP-04)
-- =============================================================================

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    shipping_address_id UUID REFERENCES customer_shipping_addresses(id) ON DELETE RESTRICT,
    sales_rep_id UUID REFERENCES users(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
    order_source VARCHAR(20) NOT NULL DEFAULT 'SALES_REP' CHECK (order_source IN ('SALES_REP', 'PORTAL_CUSTOMER', 'SYSTEM')),
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ALLOCATED', 'PICKING', 'SHIPPING', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'
    )),
    approval_status VARCHAR(30) NOT NULL DEFAULT 'NONE' CHECK (approval_status IN (
        'NONE', 'PENDING_MANAGER', 'PENDING_ACCOUNTANT', 'APPROVED', 'REJECTED'
    )),
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    approval_reason TEXT,
    rejection_reason TEXT,
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    discount_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    final_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (final_amount >= 0),
    delivery_deadline TIMESTAMPTZ,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(code);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_sales_rep_id ON orders(sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_approval_status ON orders(approval_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Liên kết khóa ngoại goods_issues -> orders
ALTER TABLE goods_issues
DROP CONSTRAINT IF EXISTS fk_goods_issues_order;

ALTER TABLE goods_issues
ADD CONSTRAINT fk_goods_issues_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES product_units(id) ON DELETE RESTRICT,
    quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
    conversion_factor NUMERIC(10, 2) NOT NULL CHECK (conversion_factor > 0),
    base_quantity NUMERIC(15, 2) NOT NULL CHECK (base_quantity > 0),
    unit_price NUMERIC(15, 2) NOT NULL CHECK (unit_price >= 0),
    floor_price NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (floor_price >= 0),
    is_below_floor_price BOOLEAN NOT NULL DEFAULT FALSE,
    discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
    discount_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    total_price NUMERIC(15, 2) NOT NULL CHECK (total_price >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

CREATE TABLE IF NOT EXISTS order_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    approver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(30) NOT NULL CHECK (action IN ('SUBMIT', 'APPROVE', 'REJECT', 'RETURN_FOR_UPDATE')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_approvals_order_id ON order_approvals(order_id);

-- =============================================================================
-- 6. PHÂN HỆ HOÁ ĐƠN, CÔNG NỢ, THANH TOÁN & TRẢ HÀNG (EP-07, EP-08, EP-09)
-- =============================================================================

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    goods_issue_id UUID REFERENCES goods_issues(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    subtotal NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    paid_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (remaining_amount >= 0),
    payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'CANCELLED')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_invoices_paid_le_total CHECK (paid_amount <= total_amount)
);

CREATE INDEX IF NOT EXISTS idx_invoices_code ON invoices(code);
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    unallocated_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'BANK_TRANSFER' CHECK (payment_method IN ('BANK_TRANSFER', 'CASH', 'CREDIT_CARD', 'CHECK')),
    payment_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference_code VARCHAR(100),
    receipt_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_unallocated_le_amount CHECK (unallocated_amount <= amount)
);

CREATE INDEX IF NOT EXISTS idx_payments_code ON payments(code);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_invoice ON payment_allocations(invoice_id);

CREATE TABLE IF NOT EXISTS customer_debt_ledger (
    id BIGSERIAL PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('INVOICE_ISSUED', 'PAYMENT_RECEIVED', 'RETURN_DEDUCTION', 'DEBT_ADJUSTMENT')),
    reference_type VARCHAR(50) NOT NULL,
    reference_id VARCHAR(100) NOT NULL,
    debit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
    credit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
    balance_after NUMERIC(15, 2) NOT NULL CHECK (balance_after >= 0),
    due_date DATE,
    aging_bucket VARCHAR(30) NOT NULL DEFAULT 'CURRENT' CHECK (aging_bucket IN ('CURRENT', '1_30_DAYS', '31_60_DAYS', '61_90_DAYS', 'OVER_90_DAYS')),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_debt_ledger_customer ON customer_debt_ledger(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_aging ON customer_debt_ledger(customer_id, aging_bucket);

CREATE TABLE IF NOT EXISTS return_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    return_reason VARCHAR(100) NOT NULL CHECK (return_reason IN ('DAMAGED', 'EXPIRED', 'WRONG_ITEM', 'CUSTOMER_REQUEST', 'OTHER')),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RECEIVED', 'REJECTED', 'CANCELLED')),
    total_refund_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (total_refund_amount >= 0),
    is_debt_deducted BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_return_orders_code ON return_orders(code);
CREATE INDEX IF NOT EXISTS idx_return_orders_customer ON return_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_status ON return_orders(status);

CREATE TABLE IF NOT EXISTS return_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    return_order_id UUID NOT NULL REFERENCES return_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES product_units(id) ON DELETE RESTRICT,
    batch_id UUID REFERENCES inventory_batches(id) ON DELETE SET NULL,
    quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
    conversion_factor NUMERIC(10, 2) NOT NULL CHECK (conversion_factor > 0),
    base_quantity NUMERIC(15, 2) NOT NULL CHECK (base_quantity > 0),
    unit_refund_price NUMERIC(15, 2) NOT NULL CHECK (unit_refund_price >= 0),
    total_refund_price NUMERIC(15, 2) NOT NULL CHECK (total_refund_price >= 0),
    condition_status VARCHAR(50) NOT NULL DEFAULT 'INTACT' CHECK (condition_status IN ('INTACT', 'DAMAGED_ACCEPTABLE', 'SCRAP')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_return_items_return_order ON return_order_items(return_order_id);

-- =============================================================================
-- 7. STORED PROCEDURES, FUNCTIONS & TRIGGERS (ACID & BUSINESS INTEGRITY)
-- =============================================================================

-- Hàm tự động cập nhật updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Gán Trigger cho tất cả các bảng
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'roles', 'users', 'categories', 'suppliers', 'products', 'product_units',
        'price_lists', 'price_list_items', 'discounts', 'customers',
        'customer_shipping_addresses', 'warehouses', 'warehouse_locations',
        'inventories', 'inventory_batches', 'goods_receipts', 'goods_issues',
        'orders', 'invoices', 'payments', 'return_orders'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = tbl) THEN
            EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;', tbl);
            EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();', tbl);
        END IF;
    END LOOP;
END $$;

-- Hàm tính nhóm tuổi nợ
CREATE OR REPLACE FUNCTION fn_calculate_aging_bucket(p_due_date DATE)
RETURNS VARCHAR(30) AS $$
DECLARE
    v_days_overdue INT;
BEGIN
    IF p_due_date IS NULL OR CURRENT_DATE <= p_due_date THEN
        RETURN 'CURRENT';
    END IF;

    v_days_overdue := CURRENT_DATE - p_due_date;

    IF v_days_overdue <= 30 THEN
        RETURN '1_30_DAYS';
    ELSIF v_days_overdue <= 60 THEN
        RETURN '31_60_DAYS';
    ELSIF v_days_overdue <= 90 THEN
        RETURN '61_90_DAYS';
    ELSE
        RETURN 'OVER_90_DAYS';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- Hàm khóa và giữ chỗ tồn kho (SELECT ... FOR UPDATE chống âm tồn khi chốt đơn đồng thời)
CREATE OR REPLACE FUNCTION fn_allocate_inventory_for_order(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
    v_current_on_hand NUMERIC(15, 2);
    v_current_allocated NUMERIC(15, 2);
BEGIN
    -- 1. Khóa và lấy thông tin đơn hàng
    SELECT id, code, warehouse_id, status
    INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy đơn hàng với ID: %', p_order_id;
    END IF;

    IF v_order.status NOT IN ('DRAFT', 'APPROVED', 'PENDING_APPROVAL') THEN
        RAISE EXCEPTION 'Đơn hàng % đang ở trạng thái %, không thể thực hiện giữ chỗ tồn kho.', v_order.code, v_order.status;
    END IF;

    IF v_order.warehouse_id IS NULL THEN
        RAISE EXCEPTION 'Đơn hàng % chưa được chỉ định kho xuất hàng.', v_order.code;
    END IF;

    -- 2. Duyệt từng mặt hàng trong đơn hàng và khóa dòng hàng trong bảng inventories bằng SELECT ... FOR UPDATE
    FOR v_item IN
        SELECT oi.product_id, oi.base_quantity, p.name AS product_name, p.sku
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = p_order_id
    LOOP
        SELECT on_hand, allocated
        INTO v_current_on_hand, v_current_allocated
        FROM inventories
        WHERE warehouse_id = v_order.warehouse_id AND product_id = v_item.product_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Sản phẩm % (SKU: %) chưa có bản ghi tồn kho tại kho được chỉ định.', v_item.product_name, v_item.sku;
        END IF;

        IF (v_current_on_hand - v_current_allocated) < v_item.base_quantity THEN
            RAISE EXCEPTION 'Không đủ tồn khả dụng cho sản phẩm % (SKU: %). Tồn khả dụng hiện tại: %, Cần giữ chỗ: %',
                v_item.product_name, v_item.sku, (v_current_on_hand - v_current_allocated), v_item.base_quantity;
        END IF;

        UPDATE inventories
        SET allocated = allocated + v_item.base_quantity,
            updated_at = CURRENT_TIMESTAMP
        WHERE warehouse_id = v_order.warehouse_id AND product_id = v_item.product_id;
    END LOOP;

    -- 3. Cập nhật trạng thái đơn hàng sang ALLOCATED
    UPDATE orders
    SET status = 'ALLOCATED',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_order_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Hàm giải phóng tồn giữ chỗ khi hủy đơn
CREATE OR REPLACE FUNCTION fn_release_inventory_allocation(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_order RECORD;
    v_item RECORD;
BEGIN
    SELECT id, code, warehouse_id, status
    INTO v_order
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy đơn hàng với ID: %', p_order_id;
    END IF;

    IF v_order.status IN ('ALLOCATED', 'PICKING') THEN
        FOR v_item IN
            SELECT product_id, base_quantity
            FROM order_items
            WHERE order_id = p_order_id
        LOOP
            UPDATE inventories
            SET allocated = GREATEST(0, allocated - v_item.base_quantity),
                updated_at = CURRENT_TIMESTAMP
            WHERE warehouse_id = v_order.warehouse_id AND product_id = v_item.product_id;
        END LOOP;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Hàm xuất kho và ghi thẻ kho
CREATE OR REPLACE FUNCTION fn_confirm_goods_issue(p_goods_issue_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_issue RECORD;
    v_item RECORD;
    v_new_balance NUMERIC(15, 2);
BEGIN
    SELECT id, code, order_id, warehouse_id, status
    INTO v_issue
    FROM goods_issues
    WHERE id = p_goods_issue_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy phiếu xuất kho với ID: %', p_goods_issue_id;
    END IF;

    IF v_issue.status = 'DELIVERED' THEN
        RAISE EXCEPTION 'Phiếu xuất kho % đã hoàn tất trước đó.', v_issue.code;
    END IF;

    FOR v_item IN
        SELECT gii.product_id, gii.batch_id, gii.base_quantity, gii.unit_price, p.sku
        FROM goods_issue_items gii
        JOIN products p ON gii.product_id = p.id
        WHERE gii.issue_id = p_goods_issue_id
    LOOP
        UPDATE inventories
        SET on_hand = on_hand - v_item.base_quantity,
            allocated = GREATEST(0, allocated - v_item.base_quantity),
            updated_at = CURRENT_TIMESTAMP
        WHERE warehouse_id = v_issue.warehouse_id AND product_id = v_item.product_id
        RETURNING on_hand INTO v_new_balance;

        IF v_item.batch_id IS NOT NULL THEN
            UPDATE inventory_batches
            SET quantity = quantity - v_item.base_quantity,
                allocated_quantity = GREATEST(0, allocated_quantity - v_item.base_quantity),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = v_item.batch_id;
        END IF;

        INSERT INTO inventory_transactions (
            warehouse_id, product_id, batch_id, transaction_type,
            quantity_change, balance_after, unit_cost, reference_type,
            reference_id, notes, created_by
        ) VALUES (
            v_issue.warehouse_id, v_item.product_id, v_item.batch_id, 'EXPORT',
            -v_item.base_quantity, v_new_balance, v_item.unit_price, 'GOODS_ISSUE',
            v_issue.code, 'Xuất kho giao hàng theo đơn ' || COALESCE(v_issue.order_id::text, ''), p_user_id
        );
    END LOOP;

    UPDATE goods_issues
    SET status = 'DELIVERED',
        delivered_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_goods_issue_id;

    IF v_issue.order_id IS NOT NULL THEN
        UPDATE orders
        SET status = 'DELIVERED',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_issue.order_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Hàm kiểm tra hạn mức công nợ và quá hạn nợ
CREATE OR REPLACE FUNCTION fn_check_customer_credit(
    p_customer_id UUID,
    p_new_order_amount NUMERIC(15, 2),
    OUT is_exceeded_limit BOOLEAN,
    OUT is_overdue BOOLEAN,
    OUT overdue_days INT,
    OUT current_debt NUMERIC(15, 2),
    OUT credit_limit NUMERIC(15, 2),
    OUT warning_message TEXT
) AS $$
DECLARE
    v_cust RECORD;
    v_max_overdue_days INT := 0;
BEGIN
    SELECT id, code, name, credit_limit, current_debt, max_debt_days, status
    INTO v_cust
    FROM customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Không tìm thấy thông tin đại lý với ID: %', p_customer_id;
    END IF;

    current_debt := v_cust.current_debt;
    credit_limit := v_cust.credit_limit;

    IF (v_cust.current_debt + p_new_order_amount) > v_cust.credit_limit THEN
        is_exceeded_limit := TRUE;
    ELSE
        is_exceeded_limit := FALSE;
    END IF;

    SELECT COALESCE(MAX(CURRENT_DATE - due_date), 0)
    INTO v_max_overdue_days
    FROM invoices
    WHERE customer_id = p_customer_id
      AND payment_status IN ('UNPAID', 'PARTIAL', 'OVERDUE')
      AND due_date < CURRENT_DATE;

    overdue_days := v_max_overdue_days;

    IF v_max_overdue_days > v_cust.max_debt_days THEN
        is_overdue := TRUE;
    ELSE
        is_overdue := FALSE;
    END IF;

    IF is_exceeded_limit AND is_overdue THEN
        warning_message := format('Đại lý vượt hạn mức công nợ (%s / %s) và có hóa đơn quá hạn %s ngày (tối đa cho phép %s ngày). Đơn hàng bắt buộc phải qua phê duyệt.',
            (v_cust.current_debt + p_new_order_amount), v_cust.credit_limit, v_max_overdue_days, v_cust.max_debt_days);
    ELSIF is_exceeded_limit THEN
        warning_message := format('Đơn hàng làm vượt hạn mức công nợ của đại lý (Dư nợ mới: %s, Hạn mức: %s). Bắt buộc phải qua phê duyệt của Kế toán.',
            (v_cust.current_debt + p_new_order_amount), v_cust.credit_limit);
    ELSIF is_overdue THEN
        warning_message := format('Đại lý có hóa đơn nợ quá hạn %s ngày (tối đa cho phép %s ngày). Bắt buộc phải thanh toán hoặc qua phê duyệt.',
            v_max_overdue_days, v_cust.max_debt_days);
    ELSE
        warning_message := 'Hạn mức công nợ và thời hạn nợ hợp lệ.';
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;
