/**
 * Hằng số dùng cho tính năng Import Tài Khoản Hàng Loạt từ Excel (SN-147)
 * Quy tắc: UPPER_SNAKE_CASE, tuyệt đối không dùng Magic Numbers/Strings
 */

/** Không giới hạn số lượng dòng dữ liệu tối đa (Người dùng muốn nạp bao nhiêu tài khoản cũng được) */
export const EXCEL_IMPORT_MAX_ROWS = Number.MAX_SAFE_INTEGER;

/** Dung lượng file Excel tối đa (100MB - Hỗ trợ nạp đầy đủ tệp quy mô lớn) */
export const EXCEL_IMPORT_MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Số lượng dòng chi tiết tối đa trong báo cáo trả về (Hỗ trợ hiển thị đầy đủ 5.000+ tài khoản) */
export const EXCEL_IMPORT_MAX_DETAIL_PREVIEW = 10000;

/** Kích thước mỗi chunk xử lý để nhả luồng Event Loop giúp máy chủ không bị lag */
export const EXCEL_IMPORT_CHUNK_SIZE = 50;

/** Số vòng salt bcrypt tối ưu cho batch import khối lượng lớn (vừa an toàn vừa đảm bảo tốc độ cực nhanh) */
export const EXCEL_IMPORT_BATCH_SALT_ROUNDS = 6;



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

/** Thứ tự 7 cột tiêu chuẩn theo quy định hệ thống (từ cột A đến G) */
export const EXCEL_IMPORT_STANDARD_COLUMNS: readonly string[] = [
  'fullName',
  'username',
  'email',
  'password',
  'role',
  'phone',
  'assignedWarehouse',
];

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

/** Bản đồ ánh xạ tiêu đề cột (hỗ trợ cả tiếng Việt có dấu, không dấu và tiếng Anh) sang trường chuẩn */
export const EXCEL_HEADER_MAPPING: Readonly<Record<string, string>> = {
  // Họ và tên
  'họ và tên': 'fullName',
  'ho va ten': 'fullName',
  'họ tên': 'fullName',
  'ho ten': 'fullName',
  'fullname': 'fullName',
  'full name': 'fullName',
  'họ và tên nhân sự': 'fullName',
  'tên nhân viên': 'fullName',
  'tên': 'fullName',

  // Username
  'username': 'username',
  'user name': 'username',
  'tên đăng nhập': 'username',
  'ten dang nhap': 'username',
  'tài khoản': 'username',
  'tai khoan': 'username',
  'mã nhân viên': 'username',

  // Email
  'email': 'email',
  'địa chỉ email': 'email',
  'dia chi email': 'email',
  'hòm thư': 'email',
  'mail': 'email',

  // Mật khẩu
  'mật khẩu': 'password',
  'mat khau': 'password',
  'password': 'password',
  'pass': 'password',
  'mật khẩu tạm': 'password',
  'mat khau tam': 'password',

  // Vai trò
  'vai trò': 'role',
  'vai tro': 'role',
  'role': 'role',
  'roles': 'role',
  'chức vụ': 'role',
  'chuc vu': 'role',
  'phân quyền': 'role',
  'quyền': 'role',

  // Số điện thoại
  'số đt': 'phone',
  'so dt': 'phone',
  'số điện thoại': 'phone',
  'so dien thoai': 'phone',
  'sđt': 'phone',
  'sdt': 'phone',
  'phone': 'phone',
  'phone number': 'phone',
  'điện thoại': 'phone',

  // Kho phụ trách
  'kho phụ trách': 'assignedWarehouse',
  'kho phu trach': 'assignedWarehouse',
  'kho': 'assignedWarehouse',
  'kho hàng': 'assignedWarehouse',
  'kho hang': 'assignedWarehouse',
  'assignedwarehouse': 'assignedWarehouse',
  'assigned warehouse': 'assignedWarehouse',
  'warehouse': 'assignedWarehouse',
};

/** Các biểu thức chính quy kiểm tra định dạng dữ liệu từng dòng */
export const EXCEL_IMPORT_REGEX = {
  /** Username: chỉ chứa chữ cái không dấu, chữ số, gạch dưới, gạch ngang, dấu chấm; không chứa khoảng trắng */
  USERNAME_VALID: /^[a-zA-Z0-9_.-]+$/,
  /** Kiểm tra sự xuất hiện của khoảng trắng */
  HAS_WHITESPACE: /\s/,
  /** Email: phải có ký tự @ và tên miền hợp lệ */
  EMAIL_BASIC: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  /** Phone: chỉ chứa chữ số hoặc dấu cộng ở đầu */
  PHONE_DIGITS_ONLY: /^\+?[0-9]+$/,
  /** Chứa chữ cái */
  HAS_LETTERS: /[a-zA-Z]/,
} as const;

/** Độ dài quy định */
export const EXCEL_IMPORT_LENGTH_RULES = {
  USERNAME_MIN: 3,
  USERNAME_MAX: 50,
  PHONE_MIN_DIGITS: 10,
  PHONE_MAX_DIGITS: 11,
} as const;

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

  // Chi tiết lỗi validate từng dòng
  FULLNAME_EMPTY: 'Họ và tên không được để trống.',
  USERNAME_EMPTY: 'Tên đăng nhập không được để trống.',
  USERNAME_HAS_SPACE: 'Tên đăng nhập không được chứa khoảng trắng.',
  USERNAME_TOO_SHORT: `Tên đăng nhập phải có ít nhất ${EXCEL_IMPORT_LENGTH_RULES.USERNAME_MIN} ký tự.`,
  USERNAME_TOO_LONG: `Tên đăng nhập không được vượt quá ${EXCEL_IMPORT_LENGTH_RULES.USERNAME_MAX} ký tự.`,
  USERNAME_INVALID_CHARS: 'Tên đăng nhập chỉ được chứa chữ cái, chữ số và các ký tự ".", "_", "-".',
  USERNAME_DUPLICATE_FILE: (uname: string) => `Tên đăng nhập "${uname}" bị trùng lặp với dòng trước trong file.`,
  USERNAME_EXISTS: (uname: string) => `Tên đăng nhập "${uname}" đã tồn tại trong hệ thống.`,

  EMAIL_EMPTY: 'Email không được để trống.',
  EMAIL_MISSING_AT: 'Email không hợp lệ (thiếu ký tự @).',
  EMAIL_INVALID_FORMAT: 'Email không đúng định dạng.',
  EMAIL_DUPLICATE_FILE: (mail: string) => `Địa chỉ email "${mail}" bị trùng lặp với dòng trước trong file.`,
  EMAIL_EXISTS: (mail: string) => `Địa chỉ email "${mail}" đã tồn tại trong hệ thống.`,

  PHONE_CONTAINS_LETTERS: 'Số điện thoại không hợp lệ (chứa chữ cái hoặc ký tự không hợp lệ).',
  PHONE_TOO_SHORT: `Số điện thoại quá ngắn (yêu cầu từ ${EXCEL_IMPORT_LENGTH_RULES.PHONE_MIN_DIGITS} đến ${EXCEL_IMPORT_LENGTH_RULES.PHONE_MAX_DIGITS} chữ số).`,
  PHONE_TOO_LONG: `Số điện thoại quá dài (yêu cầu từ ${EXCEL_IMPORT_LENGTH_RULES.PHONE_MIN_DIGITS} đến ${EXCEL_IMPORT_LENGTH_RULES.PHONE_MAX_DIGITS} chữ số).`,

  ROLE_EMPTY: 'Vai trò người dùng không được để trống.',
  ROLE_INVALID: (r: string) => `Vai trò "${r}" không hợp lệ trong hệ thống.`,
  WAREHOUSE_REQUIRED: 'Nhân sự thuộc vai trò kho (Thủ kho / Quản lý kho) bắt buộc phải được gắn với ít nhất một kho cụ thể.',
} as const;

