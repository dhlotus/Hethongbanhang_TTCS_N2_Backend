export const DEFAULT_WAREHOUSE_ID = '11111111-0000-0000-0000-000000000001';

// Dữ liệu mẫu dùng UUID cố định không có version bit; PostgreSQL vẫn nhận các ID này.
export const WAREHOUSE_MANAGER_ID_PATTERN =
  /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
