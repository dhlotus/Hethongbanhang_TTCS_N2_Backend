-- Durable payload storage for the application order workflow.
-- The legacy normalized orders tables use UUID foreign keys, while this
-- workflow also supports seeded/demo identifiers and delivery-point snapshots.
CREATE TABLE IF NOT EXISTS app_order_records (
    id TEXT PRIMARY KEY,
    order_code TEXT NOT NULL UNIQUE,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_order_records_created_at
    ON app_order_records(created_at DESC);

CREATE TABLE IF NOT EXISTS app_order_storage_state (
    state_key TEXT PRIMARY KEY,
    seeded BOOLEAN NOT NULL DEFAULT FALSE
);
