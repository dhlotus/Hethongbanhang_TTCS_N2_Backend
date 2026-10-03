-- =============================================================================
-- Migration 001: Phân hệ Cốt lõi, Tài khoản & Phân quyền (EP-01)
-- Hệ thống: LOHA SALES - Quản lý Bán hàng & Kho Doanh nghiệp B2B
-- =============================================================================

-- Kích hoạt extension hỗ trợ UUID nếu chưa có
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. BẢNG ROLES (Danh mục 7 vai trò hệ thống)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE roles IS 'Danh mục vai trò người dùng trong hệ thống (EP-01)';
COMMENT ON COLUMN roles.code IS 'Mã định danh vai trò (ADMIN, SALES_REP, SALES_MANAGER, WAREHOUSE_KEEPER, WAREHOUSE_MANAGER, ACCOUNTANT, CUSTOMER)';

-- -----------------------------------------------------------------------------
-- 2. BẢNG USERS (Tài khoản người dùng doanh nghiệp & đại lý)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    role_id INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'INACTIVE')),
    locked_until TIMESTAMPTZ,
    failed_attempts INT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE users IS 'Thông tin tài khoản đăng nhập và nhân sự (EP-01)';
COMMENT ON COLUMN users.failed_attempts IS 'Số lần nhập sai mật khẩu liên tiếp (>=5 sẽ khóa 15 phút)';
COMMENT ON COLUMN users.locked_until IS 'Thời điểm tự động mở khóa tài khoản';

CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- -----------------------------------------------------------------------------
-- 3. BẢNG REFRESH_TOKENS (Quản lý phiên đăng nhập & Refresh Token Rotation)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ
);

COMMENT ON TABLE refresh_tokens IS 'Lưu trữ Refresh Token hỗ trợ xác thực liên tục và thu hồi phiên (EP-01)';
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);

-- -----------------------------------------------------------------------------
-- 4. BẢNG AUDIT_LOGS (Nhật ký kiểm toán hệ thống - Bất biến Append-only SN-19)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action VARCHAR(50) NOT NULL, -- CREATE, UPDATE, DELETE, APPROVE, CANCEL, STOCK_ADJUST
    entity_name VARCHAR(100) NOT NULL, -- INVENTORY, DEBT, PRICING, ORDER, USER...
    entity_id VARCHAR(100) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE audit_logs IS 'Lưu vết lịch sử thay đổi dữ liệu bất biến (Append-only) phục vụ giám sát và bảo mật (EP-01 & SN-19)';
COMMENT ON COLUMN audit_logs.id IS 'Mã định danh nhật ký kiểm toán (UUID Khóa chính)';
COMMENT ON COLUMN audit_logs.user_id IS 'Mã người dùng thực hiện thao tác (FK users, Bắt buộc NOT NULL)';
COMMENT ON COLUMN audit_logs.action IS 'Hành động: CREATE, UPDATE, DELETE, APPROVE, CANCEL, STOCK_ADJUST';
COMMENT ON COLUMN audit_logs.entity_name IS 'Phân hệ nghiệp vụ tác động (INVENTORY, DEBT, PRICING, ORDER, USER...)';
COMMENT ON COLUMN audit_logs.entity_id IS 'Mã định danh đối tượng bị tác động';
COMMENT ON COLUMN audit_logs.old_values IS 'Trạng thái dữ liệu trước khi thay đổi (JSONB)';
COMMENT ON COLUMN audit_logs.new_values IS 'Trạng thái dữ liệu sau khi thay đổi (JSONB)';
COMMENT ON COLUMN audit_logs.ip_address IS 'Địa chỉ IP của client gửi request';

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_name, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
