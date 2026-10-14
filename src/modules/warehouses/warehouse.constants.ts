export const DEFAULT_WAREHOUSE_ID = '11111111-0000-4000-8000-000000000001';

// Dữ liệu mẫu dùng UUID v4 hợp lệ; tương thích chuẩn RFC 4122 và class-validator IsUUID.
export const WAREHOUSE_MANAGER_ID_PATTERN =
  /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
