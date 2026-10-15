-- Migration 011: Quản lý Giữ chỗ Tồn kho và Nhả tồn tự động (SN-180 / Parent SN-229 / Sprint 5)

CREATE TABLE IF NOT EXISTS stock_reservations (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL DEFAULT 'wh-main',
    quantity NUMERIC(15, 2) NOT NULL CHECK (quantity > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'FULFILLED', 'RESERVED')),
    expired_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_order
    ON stock_reservations(order_id);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_status_expired
    ON stock_reservations(status, expired_at)
    WHERE status = 'ACTIVE' OR status = 'RESERVED';

CREATE INDEX IF NOT EXISTS idx_stock_reservations_product
    ON stock_reservations(product_id)
    WHERE status = 'ACTIVE' OR status = 'RESERVED';
