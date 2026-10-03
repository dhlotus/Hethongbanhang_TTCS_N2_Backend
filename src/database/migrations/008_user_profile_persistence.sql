-- SN-17: Bổ sung các trường đã có trong UserEntity vào bảng users hiện hành.
-- Migration chỉ thêm cấu trúc, không ghi đè thông tin hoặc mật khẩu đã lưu.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT[];
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_warehouse TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lock_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_code_created_at TIMESTAMPTZ;
UPDATE users u SET roles = ARRAY[r.code] FROM roles r
WHERE u.role_id = r.id AND u.roles IS NULL;
COMMIT;
