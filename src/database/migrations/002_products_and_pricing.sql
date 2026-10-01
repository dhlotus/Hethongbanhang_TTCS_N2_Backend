-- =============================================================================
-- Migration 002: Phân hệ Danh mục Sản phẩm, Đơn vị tính & Bảng giá (EP-02)
-- Hệ thống: LOHA SALES - Quản lý Bán hàng & Kho Doanh nghiệp B2B
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. BẢNG CATEGORIES (Nhóm ngành hàng cây phân cấp đa tầng >= 3 cấp)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    parent_id INT REFERENCES categories(id) ON DELETE RESTRICT,
    level INT NOT NULL DEFAULT 1 CHECK (level >= 1),
    path VARCHAR(255) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE categories IS 'Cấu trúc danh mục cây phân cấp sản phẩm (EP-02)';
COMMENT ON COLUMN categories.parent_id IS 'Mã danh mục cha (Hỗ trợ phân cấp 3 tầng trở lên)';
COMMENT ON COLUMN categories.path IS 'Đường dẫn phân cấp (Ví dụ: /1/4/12/) để tìm kiếm nhanh';

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_path ON categories(path);

-- -----------------------------------------------------------------------------
-- 2. BẢNG SUPPLIERS (Nhà cung cấp hàng hóa)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    tax_code VARCHAR(50),
    contact_name VARCHAR(150),
    phone VARCHAR(20),
    email VARCHAR(150),
    address TEXT,
    payment_terms VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE suppliers IS 'Danh mục Nhà cung cấp phục vụ nhập kho và giá vốn (EP-02)';
CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(code);

-- -----------------------------------------------------------------------------
-- 3. BẢNG PRODUCTS (Danh mục sản phẩm SKU - Đơn vị cơ sở)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sku VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category_id INT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    base_unit VARCHAR(30) NOT NULL,
    cost_price NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    is_batch_managed BOOLEAN NOT NULL DEFAULT TRUE,
    barcode VARCHAR(50),
    image_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE products IS 'Danh mục SKU hàng hóa chính (EP-02)';
COMMENT ON COLUMN products.base_unit IS 'Đơn vị tính cơ sở nhỏ nhất (ví dụ: Lon, Chai, Gói) - BẮT BUỘC để quy đổi tồn kho chuẩn hóa';
COMMENT ON COLUMN products.cost_price IS 'Giá vốn sản phẩm - Chỉ cấp quyền truy xuất cho Sales Manager và Admin';
COMMENT ON COLUMN products.is_batch_managed IS 'Cờ quản lý theo Lô và Hạn sử dụng (FEFO)';

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(LOWER(sku));
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- -----------------------------------------------------------------------------
-- 4. BẢNG PRODUCT_UNITS (Đa đơn vị tính & Hệ số quy đổi về đơn vị cơ sở)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_name VARCHAR(50) NOT NULL,
    conversion_factor NUMERIC(10, 2) NOT NULL CHECK (conversion_factor > 0),
    is_base_unit BOOLEAN NOT NULL DEFAULT FALSE,
    barcode VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_product_unit_name UNIQUE (product_id, unit_name)
);

COMMENT ON TABLE product_units IS 'Quy cách đóng gói đa đơn vị tính (Thùng, Lốc, Lon) (EP-02)';
COMMENT ON COLUMN product_units.conversion_factor IS 'Hệ số nhân quy đổi ra đơn vị cơ sở (Ví dụ: Thùng = 24 Lon -> conversion_factor = 24)';

CREATE INDEX IF NOT EXISTS idx_product_units_product_id ON product_units(product_id);

-- -----------------------------------------------------------------------------
-- 5. BẢNG PRICE_LISTS (Bảng giá theo nhóm đại lý & thời hạn hiệu lực)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    customer_group VARCHAR(50) NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_price_list_dates CHECK (end_date IS NULL OR end_date > start_date)
);

COMMENT ON TABLE price_lists IS 'Chính sách giá bán buôn phân theo nhóm khách hàng (EP-02)';
CREATE INDEX IF NOT EXISTS idx_price_lists_customer_group ON price_lists(customer_group);
CREATE INDEX IF NOT EXISTS idx_price_lists_dates ON price_lists(start_date, end_date);

-- -----------------------------------------------------------------------------
-- 6. BẢNG PRICE_LIST_ITEMS (Chi tiết giá SKU trong từng bảng giá & Giá sàn)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_list_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    price_list_id UUID NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL REFERENCES product_units(id) ON DELETE RESTRICT,
    price NUMERIC(15, 2) NOT NULL CHECK (price >= 0),
    min_price NUMERIC(15, 2) NOT NULL CHECK (min_price >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_price_list_item UNIQUE (price_list_id, product_id, unit_id),
    CONSTRAINT chk_price_min_floor CHECK (price >= min_price)
);

COMMENT ON TABLE price_list_items IS 'Chi tiết giá bán từng đơn vị tính và giá sàn kiểm soát chiết khấu (EP-02)';
COMMENT ON COLUMN price_list_items.min_price IS 'Giá sàn chặn nhân viên kinh doanh bán dưới giá cho phép (vượt giá sàn cần duyệt)';

CREATE INDEX IF NOT EXISTS idx_price_list_items_lookup ON price_list_items(price_list_id, product_id, unit_id);

-- -----------------------------------------------------------------------------
-- 7. BẢNG DISCOUNTS (Chính sách chiết khấu bậc thang theo sản lượng)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    product_id UUID REFERENCES products(id) ON DELETE CASCADE,
    min_quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FIXED_AMOUNT')),
    discount_value NUMERIC(15, 2) NOT NULL CHECK (discount_value > 0),
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE discounts IS 'Quy tắc chiết khấu tự động theo số lượng mua (EP-02)';
COMMENT ON COLUMN discounts.min_quantity IS 'Số lượng mua tối thiểu (tính theo base_unit cơ sở) để kích hoạt chiết khấu';

CREATE INDEX IF NOT EXISTS idx_discounts_product_id ON discounts(product_id);
CREATE INDEX IF NOT EXISTS idx_discounts_dates ON discounts(start_date, end_date);
