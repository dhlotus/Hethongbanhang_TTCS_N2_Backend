CREATE TABLE IF NOT EXISTS app_agency_default_warehouses (
  agency_key TEXT PRIMARY KEY,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE app_inventory_stock_balances
  ADD COLUMN IF NOT EXISTS warehouse_id UUID NOT NULL DEFAULT '11111111-0000-0000-0000-000000000001';
ALTER TABLE app_inventory_stock_balances DROP CONSTRAINT IF EXISTS app_inventory_stock_balances_pkey;
ALTER TABLE app_inventory_stock_balances ADD CONSTRAINT app_inventory_stock_balances_pkey PRIMARY KEY (product_sku, warehouse_id);

ALTER TABLE app_order_inventory_reservations
  ADD COLUMN IF NOT EXISTS warehouse_id UUID NOT NULL DEFAULT '11111111-0000-0000-0000-000000000001';
CREATE INDEX IF NOT EXISTS idx_app_order_reservations_warehouse_sku
  ON app_order_inventory_reservations(warehouse_id, product_sku) WHERE status = 'RESERVED';
