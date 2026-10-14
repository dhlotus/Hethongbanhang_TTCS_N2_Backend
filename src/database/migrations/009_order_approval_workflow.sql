CREATE TABLE IF NOT EXISTS app_order_approval_history (
    id BIGSERIAL PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES app_order_records(id) ON DELETE RESTRICT,
    action VARCHAR(30) NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'RETURN_FOR_UPDATE')),
    comment TEXT,
    approver_id TEXT NOT NULL,
    approver_name TEXT NOT NULL,
    approver_roles TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_order_approval_history_order
    ON app_order_approval_history(order_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app_order_inventory_reservations (
    id BIGSERIAL PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES app_order_records(id) ON DELETE RESTRICT,
    order_line_id TEXT NOT NULL,
    product_sku TEXT NOT NULL,
    base_quantity NUMERIC(15, 2) NOT NULL CHECK (base_quantity > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'RELEASED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_app_order_active_line_reservation
    ON app_order_inventory_reservations(order_id, order_line_id)
    WHERE status = 'RESERVED';
CREATE INDEX IF NOT EXISTS idx_app_order_active_sku_reservations
    ON app_order_inventory_reservations(product_sku)
    WHERE status = 'RESERVED';

CREATE OR REPLACE FUNCTION app_reject_order_approval_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Order approval history is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_order_approval_history_immutable
    ON app_order_approval_history;
CREATE TRIGGER trg_app_order_approval_history_immutable
    BEFORE UPDATE OR DELETE ON app_order_approval_history
    FOR EACH ROW EXECUTE FUNCTION app_reject_order_approval_history_mutation();
