-- =============================================================================
-- Migration 014: Lưu trữ Lịch sử thay đổi giá sản phẩm (SN-29)
-- Bảng này chỉ cho phép INSERT và SELECT (Lịch sử không sửa và không xoá được).
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_price_histories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id VARCHAR(255) NOT NULL,
    old_price NUMERIC(15, 2) NOT NULL,
    new_price NUMERIC(15, 2) NOT NULL,
    changed_by VARCHAR(255) NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_price_histories_product_id
    ON product_price_histories(product_id);

CREATE INDEX IF NOT EXISTS idx_product_price_histories_changed_at
    ON product_price_histories(changed_at DESC);
