-- =============================================================================
-- Migration 004: Phân hệ Quản lý Kho, Tồn kho & Xuất/Nhập hàng (EP-05, EP-06)
-- Hệ thống: LOHA SALES - Quản lý Bán hàng & Kho Doanh nghiệp B2B
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BẢNG WAREHOUSES (Danh mục kho hàng vật lý)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE warehouses IS 'Danh mục kho hàng lưu trữ trong hệ thống (EP-05)';
COMMENT ON COLUMN warehouses.manager_id IS 'Quản lý kho phụ trách giám sát điều phối hoạt động';

CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(code);
CREATE INDEX IF NOT EXISTS idx_warehouses_status ON warehouses(status);

-- -----------------------------------------------------------------------------
-- 2. BẢNG WAREHOUSE_LOCATIONS (Vị trí lưu kho chi tiết: Kệ/Tầng/Dãy)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE warehouse_locations IS 'Chi tiết vị trí lưu kho phục vụ soạn hàng (Picking) tối ưu (EP-05)';
CREATE INDEX IF NOT EXISTS idx_locations_warehouse ON warehouse_locations(warehouse_id);

-- -----------------------------------------------------------------------------
-- 3. BẢNG USER_WAREHOUSES (Gán nhân viên thủ kho phụ trách các kho chỉ định)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_warehouses (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, warehouse_id)
);

COMMENT ON TABLE user_warehouses IS 'Phân công thủ kho phụ trách cụ thể tại một hoặc nhiều kho (EP-01, EP-05)';

CREATE INDEX IF NOT EXISTS idx_user_warehouses_user ON user_warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouses_wh ON user_warehouses(warehouse_id);

-- -----------------------------------------------------------------------------
-- 4. BẢNG INVENTORIES (Sổ tồn kho tổng hợp thời gian thực - Chuẩn hóa Base Unit)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE inventories IS 'Sổ tồn kho tổng hợp theo thời gian thực chuẩn hóa theo đơn vị cơ sở (EP-05)';
COMMENT ON COLUMN inventories.on_hand IS 'Tồn thực tế hiện có trong kho (tính theo base_unit)';
COMMENT ON COLUMN inventories.allocated IS 'Số lượng giữ chỗ cho các đơn hàng đã duyệt đang chờ xuất kho (tính theo base_unit)';
COMMENT ON COLUMN inventories.available IS 'Tồn khả dụng có thể bán (on_hand - allocated)';
COMMENT ON COLUMN inventories.min_threshold IS 'Ngưỡng tồn kho tối thiểu để gửi cảnh báo hết hàng';

CREATE INDEX IF NOT EXISTS idx_inventories_lookup ON inventories(warehouse_id, product_id);
CREATE INDEX IF NOT EXISTS idx_inventories_available ON inventories(warehouse_id, product_id, available);

-- -----------------------------------------------------------------------------
-- 5. BẢNG INVENTORY_BATCHES (Quản lý lô hàng, HSD & xuất kho theo chuẩn FEFO)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE inventory_batches IS 'Quản lý tồn kho chi tiết theo số Lô và Hạn sử dụng (FEFO) (EP-05, EP-06)';
COMMENT ON COLUMN inventory_batches.expiry_date IS 'Hạn sử dụng của lô - Dùng để sắp xếp xuất kho ưu tiên lô sắp hết hạn trước (FEFO)';

CREATE INDEX IF NOT EXISTS idx_batches_fefo ON inventory_batches(product_id, warehouse_id, expiry_date ASC) WHERE status = 'ACTIVE' AND quantity > 0;
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON inventory_batches(expiry_date);

-- -----------------------------------------------------------------------------
-- 6. BẢNG INVENTORY_TRANSACTIONS (Thẻ kho / Sổ cái tồn kho - Audit Ledger)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE inventory_transactions IS 'Thẻ kho ghi nhận mọi biến động xuất nhập tồn (Bất biến - Audit Ledger) (EP-05)';
COMMENT ON COLUMN inventory_transactions.quantity_change IS 'Lượng biến động theo base_unit (+ nếu nhập/tăng, - nếu xuất/giảm)';
COMMENT ON COLUMN inventory_transactions.balance_after IS 'Số dư tồn kho thực tế sau khi giao dịch hoàn tất';

CREATE INDEX IF NOT EXISTS idx_inv_trans_lookup ON inventory_transactions(warehouse_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_trans_ref ON inventory_transactions(reference_type, reference_id);

-- -----------------------------------------------------------------------------
-- 7. BẢNG GOODS_RECEIPTS (Phiếu nhập kho)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE goods_receipts IS 'Phiếu nhập hàng vào kho từ nhà cung cấp hoặc điều chuyển (EP-05)';
COMMENT ON COLUMN goods_receipts.document_url IS 'Đường dẫn ảnh chứng từ giao hàng / hóa đơn nhà cung cấp';

CREATE INDEX IF NOT EXISTS idx_goods_receipts_code ON goods_receipts(code);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON goods_receipts(status);

-- -----------------------------------------------------------------------------
-- 8. BẢNG GOODS_RECEIPT_ITEMS (Chi tiết dòng hàng phiếu nhập kho)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE goods_receipt_items IS 'Chi tiết các mặt hàng trong phiếu nhập kho kèm thông tin Lô và HSD (EP-05)';
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON goods_receipt_items(receipt_id);

-- -----------------------------------------------------------------------------
-- 9. BẢNG GOODS_ISSUES (Phiếu xuất kho & Giao hàng)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goods_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    order_id UUID, -- Sẽ được tham chiếu tới orders(id)
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

COMMENT ON TABLE goods_issues IS 'Phiếu xuất kho và theo dõi hành trình giao nhận hàng (EP-06)';
COMMENT ON COLUMN goods_issues.proof_of_delivery_url IS 'Ảnh chụp phiếu giao hàng có chữ ký nhận của đại lý (POD)';

CREATE INDEX IF NOT EXISTS idx_goods_issues_code ON goods_issues(code);
CREATE INDEX IF NOT EXISTS idx_goods_issues_status ON goods_issues(status);
CREATE INDEX IF NOT EXISTS idx_goods_issues_order ON goods_issues(order_id);

-- -----------------------------------------------------------------------------
-- 10. BẢNG GOODS_ISSUE_ITEMS (Chi tiết dòng hàng xuất kho theo FEFO)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE goods_issue_items IS 'Chi tiết các mặt hàng xuất kho phân bổ theo Lô FEFO (EP-06)';
CREATE INDEX IF NOT EXISTS idx_issue_items_issue_id ON goods_issue_items(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_items_batch_id ON goods_issue_items(batch_id);
