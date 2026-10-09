CREATE TABLE IF NOT EXISTS app_inventory_stock_balances (
    product_sku TEXT PRIMARY KEY,
    physical_quantity NUMERIC(15, 2) NOT NULL CHECK (physical_quantity >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
