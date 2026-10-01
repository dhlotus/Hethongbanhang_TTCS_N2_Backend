-- =============================================================================
-- Migration 006: Phân hệ Hoá đơn, Công nợ, Thanh toán & Trả hàng (EP-07, EP-08, EP-09)
-- Hệ thống: LOHA SALES - Quản lý Bán hàng & Kho Doanh nghiệp B2B
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BẢNG INVOICES (Hóa đơn bán hàng phát sinh từ giao hàng thực tế)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE invoices IS 'Hóa đơn tài chính bán hàng phát sinh sau khi giao hàng thành công (EP-07)';
COMMENT ON COLUMN invoices.due_date IS 'Hạn thanh toán hóa đơn (Dùng tính tuổi nợ và nợ quá hạn)';
COMMENT ON COLUMN invoices.remaining_amount IS 'Số tiền còn phải thanh toán của hóa đơn';

CREATE INDEX IF NOT EXISTS idx_invoices_code ON invoices(code);
CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_payment_status ON invoices(payment_status);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date);

-- -----------------------------------------------------------------------------
-- 2. BẢNG PAYMENTS (Phiếu thu tiền từ Đại lý)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE payments IS 'Phiếu thu tiền thanh toán từ khách hàng/đại lý (EP-08)';
COMMENT ON COLUMN payments.unallocated_amount IS 'Số tiền còn dư chưa được phân bổ đối trừ vào hóa đơn nào';

CREATE INDEX IF NOT EXISTS idx_payments_code ON payments(code);
CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

-- -----------------------------------------------------------------------------
-- 3. BẢNG PAYMENT_ALLOCATIONS (Đối trừ công nợ chi tiết từng hóa đơn)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE payment_allocations IS 'Chi tiết phân bổ phiếu thu trừ nợ cho từng hóa đơn theo FIFO hoặc chỉ định (EP-08)';
CREATE INDEX IF NOT EXISTS idx_payment_alloc_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_alloc_invoice ON payment_allocations(invoice_id);

-- -----------------------------------------------------------------------------
-- 4. BẢNG CUSTOMER_DEBT_LEDGER (Sổ cái công nợ & Phân tích tuổi nợ)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE customer_debt_ledger IS 'Sổ chi tiết phát sinh nợ của từng đại lý và phân nhóm tuổi nợ (EP-08)';
COMMENT ON COLUMN customer_debt_ledger.debit_amount IS 'Số tiền phát sinh tăng nợ (ví dụ: Xuất hóa đơn mới)';
COMMENT ON COLUMN customer_debt_ledger.credit_amount IS 'Số tiền phát sinh giảm nợ (ví dụ: Thu tiền, trả hàng)';
COMMENT ON COLUMN customer_debt_ledger.aging_bucket IS 'Phân loại nhóm tuổi nợ: Hiện hành, 1-30 ngày, 31-60 ngày, 61-90 ngày, Trên 90 ngày';

CREATE INDEX IF NOT EXISTS idx_debt_ledger_customer ON customer_debt_ledger(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debt_ledger_aging ON customer_debt_ledger(customer_id, aging_bucket);

-- -----------------------------------------------------------------------------
-- 5. BẢNG RETURN_ORDERS (Phiếu đổi trả hàng nhập lại kho)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE return_orders IS 'Phiếu yêu cầu và nhập kho hàng trả lại (EP-09)';
COMMENT ON COLUMN return_orders.is_debt_deducted IS 'Cờ đánh dấu đã ghi giảm trừ công nợ của khách hàng';

CREATE INDEX IF NOT EXISTS idx_return_orders_code ON return_orders(code);
CREATE INDEX IF NOT EXISTS idx_return_orders_customer ON return_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_status ON return_orders(status);

-- -----------------------------------------------------------------------------
-- 6. BẢNG RETURN_ORDER_ITEMS (Chi tiết dòng hàng trả lại)
-- -----------------------------------------------------------------------------
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

COMMENT ON TABLE return_order_items IS 'Chi tiết các mặt hàng trả lại kèm tình trạng hàng (EP-09)';
CREATE INDEX IF NOT EXISTS idx_return_items_return_order ON return_order_items(return_order_id);
