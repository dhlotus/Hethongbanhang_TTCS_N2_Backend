import { UserRole } from '../../../common/enums/user-role.enum';
import { SafeUser } from '../entities/user.entity';

/**
 * DTO báo cáo kết quả cho từng dòng trong file Excel (SN-147)
 */
export interface ImportRowResult {
  /** Số thứ tự dòng trong file (bắt đầu từ 2, vì dòng 1 là header) */
  row: number;
  /** Dữ liệu gốc đọc từ dòng Excel */
  rawData: {
    fullName?: string;
    username?: string;
    email?: string;
    role?: string;
    phone?: string;
    assignedWarehouse?: string;
  };
  /** Kết quả xử lý: thành công hay thất bại */
  status: 'SUCCESS' | 'FAILED';
  /** Tài khoản được tạo (chỉ có khi status = 'SUCCESS') */
  createdUser?: SafeUser;
  /** Mật khẩu tạm (chỉ có khi status = 'SUCCESS') */
  temporaryPassword?: string;
  /** Danh sách lỗi (chỉ có khi status = 'FAILED') */
  errors?: string[];
}

/**
 * DTO báo cáo tổng kết toàn bộ quá trình import Excel (SN-147)
 */
export class ImportUsersReportDto {
  /** Tổng số dòng dữ liệu trong file (không tính header) */
  totalRows: number;

  /** Số tài khoản tạo thành công */
  successCount: number;

  /** Số dòng thất bại */
  failedCount: number;

  /** Danh sách chi tiết kết quả từng dòng */
  results: ImportRowResult[];

  /** Danh sách tài khoản đã tạo thành công (safe, không lộ password hash) */
  createdUsers: Array<SafeUser & { temporaryPassword: string }>;

  /** Thông báo tổng kết */
  summary: string;
}

/**
 * DTO dữ liệu thô đọc từ 1 dòng Excel trước khi validate (SN-147)
 */
export interface ExcelRawRow {
  fullName?: unknown;
  username?: unknown;
  email?: unknown;
  role?: unknown;
  phone?: unknown;
  password?: unknown;
  assignedWarehouse?: unknown;
}

/**
 * DTO response wrapper cho API import Excel (SN-147)
 */
export class ImportUsersResponseDto {
  statusCode: number;
  message: string;
  data: ImportUsersReportDto;
}

/** Map alias vai trò tiếng Việt -> UserRole enum (hỗ trợ đầu vào linh hoạt trong Excel) */
export const ROLE_ALIAS_MAP: Readonly<Record<string, UserRole>> = {
  'admin': UserRole.ADMIN,
  'quản trị viên': UserRole.ADMIN,
  'quantrivien': UserRole.ADMIN,
  'sales_rep': UserRole.SALES_REP,
  'nhân viên kinh doanh': UserRole.SALES_REP,
  'nhanvienkinhdoanh': UserRole.SALES_REP,
  'sales_manager': UserRole.SALES_MANAGER,
  'quản lý kinh doanh': UserRole.SALES_MANAGER,
  'quanlykinhdoanh': UserRole.SALES_MANAGER,
  'warehouse_keeper': UserRole.WAREHOUSE_KEEPER,
  'thủ kho': UserRole.WAREHOUSE_KEEPER,
  'thukho': UserRole.WAREHOUSE_KEEPER,
  'warehouse_manager': UserRole.WAREHOUSE_MANAGER,
  'quản lý kho': UserRole.WAREHOUSE_MANAGER,
  'quanlykho': UserRole.WAREHOUSE_MANAGER,
  'accountant': UserRole.ACCOUNTANT,
  'kế toán': UserRole.ACCOUNTANT,
  'ketoan': UserRole.ACCOUNTANT,
  'customer': UserRole.CUSTOMER,
  'đại lý': UserRole.CUSTOMER,
  'daily': UserRole.CUSTOMER,
} as const;
