-- =============================================================================
-- Migration 013: Lưu trữ cơ sở dữ liệu cho Bảng giá cơ sở & Chính sách chiết khấu
-- Hệ thống: LOHA SALES - Quản lý Bán hàng & Kho Doanh nghiệp B2B
-- =============================================================================

-- 1. Bảng lưu trữ Bảng giá cơ sở (App Price Lists)
CREATE TABLE IF NOT EXISTS app_price_lists (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    customer_group TEXT NOT NULL,
    status TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_price_lists_created_at
    ON app_price_lists(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_price_lists_code
    ON app_price_lists(code);

-- 2. Bảng lưu trữ Chính sách chiết khấu (App Discount Policies)
CREATE TABLE IF NOT EXISTS app_discount_policies (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_discount_policies_created_at
    ON app_discount_policies(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_discount_policies_code
    ON app_discount_policies(code);
