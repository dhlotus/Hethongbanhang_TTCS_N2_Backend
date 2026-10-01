-- =============================================================================
-- Migration 005: Phân hệ Đặt hàng, Kiểm soát Giá sàn & Duyệt đơn (EP-04)
-- Hệ thống: LOHA SALES - Quản lý Bán hàng & Kho Doanh nghiệp B2B
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BẢNG ORDERS (Đơn đặt hàng B2B)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    shipping_address_id UUID REFERENCES customer_shipping_addresses(id) ON DELETE RESTRICT,
    sales_rep_id UUID REFERENCES users(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE RESTRICT,
    order_source VARCHAR(20) NOT NULL DEFAULT 'SALES_REP' CHECK (order_source IN ('SALES_REP', 'PORTAL_CUSTOMER', 'SYSTEM')),
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT',                -- Đơn nháp
        'PENDING_APPROVAL',     -- Đang chờ duyệt (vượt hạn mức hoặc dưới giá sàn)
        'APPROVED',             -- Đã duyệt hợp lệ
        'ALLOCATED',            -- Đã giữ chỗ tồn kho thành công
        'PICKING',              -- Đang soạn hàng tại kho
        'SHIPPING',             -- Đang trên đường giao hàng
        'DELIVERED',            -- Đã giao hàng thành công
        'COMPLETED',            -- Hoàn tất (đã xuất hóa đơn)
        'CANCELLED',            -- Hủy đơn
        'REJECTED'              -- Bị từ chối duyệt
    )),
    approval_status VARCHAR(30) NOT NULL DEFAULT 'NONE' CHECK (approval_status IN (
        'NONE',                 -- Không cần duyệt
        'PENDING_MANAGER',      -- Chờ Sales Manager duyệt giá sàn
        'PENDING_ACCOUNTANT',   -- Chờ Kế toán duyệt vượt hạn mức
        'APPROVED',             -- Đã duyệt
        'REJECTED'              -- Đã từ chối
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

COMMENT ON TABLE orders IS 'Đơn đặt hàng bán buôn B2B (EP-04)';
COMMENT ON COLUMN orders.code IS 'Mã đơn hàng duy nhất (ví dụ: DH-2026-0001)';
COMMENT ON COLUMN orders.approval_status IS 'Trạng thái luồng phê duyệt ngoại lệ (Giá sàn, Vượt công nợ)';
COMMENT ON COLUMN orders.warehouse_id IS 'Kho chỉ định xuất hàng cho đơn';

CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(code);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_sales_rep_id ON orders(sales_rep_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_approval_status ON orders(approval_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. BẢNG ORDER_ITEMS (Chi tiết dòng hàng - Lưu trữ Base Quantity)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE order_items IS 'Chi tiết các mặt hàng trong đơn hàng kèm quy đổi đơn vị cơ sở (EP-04)';
COMMENT ON COLUMN order_items.base_quantity IS 'Số lượng quy đổi chuẩn về đơn vị cơ sở nhỏ nhất - Dùng để giữ chỗ và trừ tồn kho chính xác';
COMMENT ON COLUMN order_items.is_below_floor_price IS 'Cờ đánh dấu đơn giá bán thấp hơn giá sàn của bảng giá';

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- -----------------------------------------------------------------------------
-- 3. BẢNG ORDER_APPROVALS (Lịch sử duyệt đơn hàng)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    approver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(30) NOT NULL CHECK (action IN ('SUBMIT', 'APPROVE', 'REJECT', 'RETURN_FOR_UPDATE')),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE order_approvals IS 'Lịch sử phê duyệt đơn hàng bởi Quản lý kinh doanh hoặc Kế toán (EP-04)';
CREATE INDEX IF NOT EXISTS idx_order_approvals_order_id ON order_approvals(order_id);

-- -----------------------------------------------------------------------------
-- 4. BỔ SUNG KHÓA NGOẠI: GOODS_ISSUES -> ORDERS
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'goods_issues') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE constraint_name = 'fk_goods_issues_order' AND table_name = 'goods_issues'
        ) THEN
            ALTER TABLE goods_issues
            ADD CONSTRAINT fk_goods_issues_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;
