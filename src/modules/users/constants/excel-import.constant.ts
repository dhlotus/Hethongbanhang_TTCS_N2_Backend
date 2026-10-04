/**
 * Hằng số dùng cho tính năng Import Tài Khoản Hàng Loạt từ Excel (SN-147)
 * Quy tắc: UPPER_SNAKE_CASE, tuyệt đối không dùng Magic Numbers/Strings
 */

/** Số lượng dòng dữ liệu tối đa cho phép trong một lần import */
export const EXCEL_IMPORT_MAX_ROWS = 500;

/** Dung lượng file Excel tối đa (5MB) */
export const EXCEL_IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Danh sách MIME type hợp lệ cho file Excel */
export const EXCEL_IMPORT_ALLOWED_MIME_TYPES: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
];

/** Danh sách phần mở rộng hợp lệ cho file Excel */
export const EXCEL_IMPORT_ALLOWED_EXTENSIONS: readonly string[] = ['.xlsx', '.xls'];

/** Tên sheet mặc định được đọc nếu file Excel có nhiều sheet */
export const EXCEL_IMPORT_DEFAULT_SHEET_INDEX = 0;

/** Tên các cột bắt buộc trong file Excel (header row) */
export const EXCEL_IMPORT_REQUIRED_HEADERS: readonly string[] = [
  'fullName',
  'username',
  'email',
  'role',
];

/** Tên các cột tùy chọn trong file Excel */
export const EXCEL_IMPORT_OPTIONAL_HEADERS: readonly string[] = [
  'phone',
  'password',
  'assignedWarehouse',
];

/** Thông báo lỗi / thành công chuẩn hóa cho Excel Import */
export const EXCEL_IMPORT_MESSAGES = {
  FILE_REQUIRED: 'Vui lòng chọn file Excel (.xlsx hoặc .xls) để tải lên.',
  INVALID_EXTENSION: 'Chỉ chấp nhận file Excel định dạng .xlsx hoặc .xls.',
  FILE_TOO_LARGE: `Dung lượng file Excel không được vượt quá ${EXCEL_IMPORT_MAX_FILE_SIZE / 1024 / 1024}MB.`,
  EMPTY_FILE: 'File Excel không có dữ liệu hoặc thiếu hàng tiêu đề (header row).',
  MISSING_HEADERS: (missing: string[]) =>
    `File Excel thiếu các cột bắt buộc: ${missing.map((h) => `"${h}"`).join(', ')}.`,
  MAX_ROWS_EXCEEDED: `File Excel chứa quá ${EXCEL_IMPORT_MAX_ROWS} dòng dữ liệu. Vui lòng chia nhỏ file và thử lại.`,
  IMPORT_SUCCESS: (created: number, failed: number) =>
    `Import hoàn tất: Tạo thành công ${created} tài khoản, ${failed} dòng thất bại.`,
} as const;
