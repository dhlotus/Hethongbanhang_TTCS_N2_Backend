import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { UserRole } from '../../../common/enums/user-role.enum';
import type { ExcelUserRow } from '../interfaces/excel-import.interface';

/** Tên các cột hợp lệ trong file Excel mẫu */
const EXCEL_COLUMN_MAP: Record<string, keyof ExcelUserRow> = {
  'Họ và tên': 'fullName',
  'Tên đăng nhập': 'username',
  Email: 'email',
  'Số điện thoại': 'phone',
  'Vai trò': 'role',
  'Kho phụ trách': 'assignedWarehouse',
  'Mật khẩu': 'password',
};

/** Ánh xạ tên vai trò tiếng Việt/tiếng Anh thô sang UserRole enum */
const ROLE_ALIAS_MAP: Record<string, UserRole> = {
  admin: UserRole.ADMIN,
  'quản trị': UserRole.ADMIN,
  'quan tri vien': UserRole.ADMIN,
  'quản trị viên': UserRole.ADMIN,
  sales_rep: UserRole.SALES_REP,
  'nhân viên kinh doanh': UserRole.SALES_REP,
  'nhan vien kinh doanh': UserRole.SALES_REP,
  sales: UserRole.SALES_REP,
  sales_manager: UserRole.SALES_MANAGER,
  'quản lý kinh doanh': UserRole.SALES_MANAGER,
  'quan ly kinh doanh': UserRole.SALES_MANAGER,
  'salesmanager': UserRole.SALES_MANAGER,
  warehouse_keeper: UserRole.WAREHOUSE_KEEPER,
  'thủ kho': UserRole.WAREHOUSE_KEEPER,
  'thu kho': UserRole.WAREHOUSE_KEEPER,
  'thukho': UserRole.WAREHOUSE_KEEPER,
  warehouse_manager: UserRole.WAREHOUSE_MANAGER,
  'quản lý kho': UserRole.WAREHOUSE_MANAGER,
  'quan ly kho': UserRole.WAREHOUSE_MANAGER,
  'warehousemanager': UserRole.WAREHOUSE_MANAGER,
  accountant: UserRole.ACCOUNTANT,
  'kế toán': UserRole.ACCOUNTANT,
  'ke toan': UserRole.ACCOUNTANT,
  customer: UserRole.CUSTOMER,
  'khách hàng': UserRole.CUSTOMER,
  'khach hang': UserRole.CUSTOMER,
  'đại lý': UserRole.CUSTOMER,
  'dai ly': UserRole.CUSTOMER,
};

/**
 * Đọc và parse file Excel buffer thành mảng các dòng dữ liệu thô.
 * - Dòng header bắt buộc phải khớp với EXCEL_COLUMN_MAP
 * - Các dòng trống hoàn toàn sẽ bị bỏ qua
 *
 * @param buffer - Buffer của file .xlsx / .xls được upload
 * @returns Mảng ExcelUserRow (bao gồm cả dòng hợp lệ và lỗi, rowIndex bắt đầu từ 2 - dòng dữ liệu đầu tiên)
 */
export function parseExcelBuffer(buffer: Buffer): ExcelUserRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new BadRequestException('File Excel không có sheet dữ liệu nào.');
  }

  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: null,
    raw: false,
  });

  if (rawRows.length === 0) {
    throw new BadRequestException('File Excel không có dữ liệu (sau dòng header).');
  }

  return rawRows
    .map((rawRow, index): ExcelUserRow | null => {
      // Bỏ qua dòng trống hoàn toàn
      const values = Object.values(rawRow);
      const isEmptyRow = values.every((v) => v === null || String(v).trim() === '');
      if (isEmptyRow) return null;

      const row: ExcelUserRow = {
        rowIndex: index + 2, // +2 vì dòng 1 là header, dữ liệu bắt đầu từ dòng 2
        fullName: null,
        username: null,
        email: null,
        phone: null,
        role: null,
        assignedWarehouse: null,
        password: null,
      };

      for (const [colName, fieldKey] of Object.entries(EXCEL_COLUMN_MAP)) {
        const cellValue = rawRow[colName];
        const stringValue: string | null =
          cellValue !== null && cellValue !== undefined
            ? String(cellValue).trim() || null
            : null;
        // Double-cast qua unknown vì TypeScript không tự suy ra index signature cho interface;
        // EXCEL_COLUMN_MAP đảm bảo fieldKey luôn là key hợp lệ của ExcelUserRow
        (row as unknown as Record<string, string | null>)[fieldKey] = stringValue;
      }

      return row;
    })
    .filter((row): row is ExcelUserRow => row !== null);
}

/**
 * Validate một chuỗi email cơ bản
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Chuẩn hóa chuỗi vai trò thô từ Excel sang UserRole enum.
 * Hỗ trợ cả tiếng Anh, tiếng Việt (có/không dấu).
 */
export function normalizeRole(rawRole: string | null): UserRole | null {
  if (!rawRole) return null;
  const normalized = rawRole.trim().toLowerCase();
  return ROLE_ALIAS_MAP[normalized] ?? null;
}

/**
 * Validate dữ liệu của một dòng Excel.
 * Trả về mảng lỗi (rỗng nếu hợp lệ).
 */
export function validateExcelRow(row: ExcelUserRow): string[] {
  const errors: string[] = [];

  // 1. Họ và tên
  if (!row.fullName || row.fullName.trim().length < 2) {
    errors.push('Họ và tên không được để trống và phải có ít nhất 2 ký tự.');
  }

  // 2. Tên đăng nhập
  if (!row.username || row.username.trim().length < 3) {
    errors.push('Tên đăng nhập không được để trống và phải có ít nhất 3 ký tự.');
  } else if (!/^[a-zA-Z0-9_.-]+$/.test(row.username.trim())) {
    errors.push('Tên đăng nhập chỉ được chứa chữ cái, chữ số, dấu gạch dưới (_), dấu chấm (.) hoặc gạch ngang (-).');
  }

  // 3. Email
  if (!row.email) {
    errors.push('Email không được để trống.');
  } else if (!isValidEmail(row.email.trim())) {
    errors.push(`Email "${row.email}" không đúng định dạng.`);
  }

  // 4. Vai trò
  if (!row.role) {
    errors.push('Vai trò không được để trống.');
  } else {
    const resolvedRole = normalizeRole(row.role);
    if (!resolvedRole) {
      errors.push(
        `Vai trò "${row.role}" không hợp lệ. Các vai trò hợp lệ: ADMIN, SALES_REP, SALES_MANAGER, WAREHOUSE_KEEPER, WAREHOUSE_MANAGER, ACCOUNTANT, CUSTOMER.`,
      );
    }
  }

  // 5. Ràng buộc kho: Nếu vai trò là WAREHOUSE_KEEPER hoặc WAREHOUSE_MANAGER thì bắt buộc có kho phụ trách
  if (row.role) {
    const resolvedRole = normalizeRole(row.role);
    const isWarehouseStaff =
      resolvedRole === UserRole.WAREHOUSE_KEEPER ||
      resolvedRole === UserRole.WAREHOUSE_MANAGER;

    if (isWarehouseStaff && (!row.assignedWarehouse || row.assignedWarehouse.trim() === '')) {
      errors.push('Nhân sự thuộc vai trò kho (Thủ kho / Quản lý kho) bắt buộc phải có "Kho phụ trách".');
    }
  }

  // 6. Mật khẩu tùy chọn: nếu cung cấp thì phải hợp lệ
  if (row.password && row.password.trim().length > 0 && row.password.trim().length < 6) {
    errors.push('Mật khẩu phải có ít nhất 6 ký tự nếu được cung cấp.');
  }

  return errors;
}
