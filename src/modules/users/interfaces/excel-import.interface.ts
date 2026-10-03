import { SafeUser } from '../entities/user.entity';

/**
 * Một dòng dữ liệu thô được đọc từ file Excel (trước khi validate)
 */
export interface ExcelUserRow {
  rowIndex: number;
  fullName: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  assignedWarehouse: string | null;
  password: string | null;
}

/**
 * Kết quả validate cho từng dòng Excel
 */
export interface RowValidationResult {
  rowIndex: number;
  rawData: ExcelUserRow;
  errors: string[];
  isValid: boolean;
}

/**
 * Kết quả tạo tài khoản thành công từ một dòng Excel
 */
export interface ExcelImportSuccessItem {
  rowIndex: number;
  user: SafeUser;
  temporaryPassword: string;
}

/**
 * Kết quả thất bại cho một dòng Excel (validate lỗi hoặc tạo lỗi)
 */
export interface ExcelImportFailureItem {
  rowIndex: number;
  rawData: Partial<ExcelUserRow>;
  reason: string;
}

/**
 * Báo cáo tổng kết sau khi import toàn bộ file Excel
 */
export interface ExcelImportReport {
  totalRows: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  successItems: ExcelImportSuccessItem[];
  failureItems: ExcelImportFailureItem[];
  summary: string;
}
