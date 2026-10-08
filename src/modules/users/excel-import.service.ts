import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as XLSX from 'xlsx';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  EXCEL_HEADER_MAPPING,
  EXCEL_IMPORT_ALLOWED_EXTENSIONS,
  EXCEL_IMPORT_ALLOWED_MIME_TYPES,
  EXCEL_IMPORT_BATCH_SALT_ROUNDS,
  EXCEL_IMPORT_CHUNK_SIZE,
  EXCEL_IMPORT_DEFAULT_SHEET_INDEX,
  EXCEL_IMPORT_LENGTH_RULES,
  EXCEL_IMPORT_MAX_DETAIL_PREVIEW,
  EXCEL_IMPORT_MAX_FILE_SIZE,
  EXCEL_IMPORT_MAX_ROWS,
  EXCEL_IMPORT_MESSAGES,
  EXCEL_IMPORT_REGEX,
  EXCEL_IMPORT_REQUIRED_HEADERS,
  EXCEL_IMPORT_STANDARD_COLUMNS,
} from './constants/excel-import.constant';


import {
  ExcelRawRow,
  ImportRowResult,
  ImportUsersReportDto,
  ROLE_ALIAS_MAP,
} from './dto/import-users-report.dto';
import { UsersService } from './users.service';

interface CleanRowData {
  fullName: string;
  username: string;
  email: string;
  role: string;
  phone: string;
  password?: string;
  assignedWarehouse: string;
}

/**
 * Service xử lý tệp Excel, validate dữ liệu từng dòng và tạo tài khoản hàng loạt (SN-147).
 *
 * Nguyên tắc thiết kế:
 * - Single Responsibility: Chỉ đảm nhiệm luồng nhập liệu từ Excel
 * - Hỗ trợ cả file tiếng Việt có dấu, không dấu và tiếng Anh
 * - Validate chặt chẽ từng dòng độc lập; lỗi 1 dòng không dừng toàn bộ batch
 * - Tối ưu hiệu năng cao: Bỏ qua gửi email đồng bộ và ghi đĩa lặp lại để ngăn chặn triệt để timeout 10000ms
 * - Tuân thủ Code Convention: Zero any, TypeScript strict, kebab-case file, hàm ngắn gọn
 */
@Injectable()
export class ExcelImportService {
  private readonly logger = new Logger(ExcelImportService.name);

  constructor(private readonly usersService: UsersService) {}

  /**
   * Điểm vào chính: Nhận file Excel từ controller, xử lý toàn bộ luồng import.
   * @param file - File Excel được upload qua multipart/form-data
   * @returns Báo cáo tổng kết đầy đủ (ImportUsersReportDto)
   */
  async importFromExcel(file?: Express.Multer.File): Promise<ImportUsersReportDto> {
    // 1. Kiểm tra tính hợp lệ của file đầu vào (kích thước, định dạng MIME)
    this.validateFile(file);

    // 2. Chuyển đổi nội dung buffer Excel thành danh sách dòng dữ liệu thô
    const rawRows = this.parseExcelBuffer(file.buffer);

    if (rawRows.length === 0) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.EMPTY_FILE);
    }

    this.logger.log(
      `[ExcelImportService] Bắt đầu import ${rawRows.length} dòng từ file "${file.originalname}"`,
    );

    // 3. Xử lý từng dòng dữ liệu và tạo tài khoản
    const results = await this.processRows(rawRows);

    // 4. Tổng hợp báo cáo kết quả
    const report = this.buildReport(rawRows.length, results);

    this.logger.log(
      `[ExcelImportService] Hoàn tất import: ${report.successCount} thành công, ${report.failedCount} thất bại.`,
    );

    return report;
  }

  // ──────────────────────────────────────────────
  // VALIDATE FILE ĐẦU VÀO
  // ──────────────────────────────────────────────

  /**
   * Kiểm tra tính hợp lệ của file tải lên (dung lượng, phần mở rộng, MIME type)
   */
  private validateFile(file?: Express.Multer.File): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.FILE_REQUIRED);
    }

    if (file.size > EXCEL_IMPORT_MAX_FILE_SIZE) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.FILE_TOO_LARGE);
    }

    const ext = this.extractExtension(file.originalname);
    const mimeValid = EXCEL_IMPORT_ALLOWED_MIME_TYPES.includes(file.mimetype);
    const extValid = EXCEL_IMPORT_ALLOWED_EXTENSIONS.includes(ext);

    if (!mimeValid && !extValid) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.INVALID_EXTENSION);
    }
  }

  /**
   * Trích xuất phần mở rộng của tên file
   */
  private extractExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filename.slice(lastDot).toLowerCase();
  }

  // ──────────────────────────────────────────────
  // PARSE EXCEL BUFFER & MAPPING CỘT
  // ──────────────────────────────────────────────

  /**
   * Phân tích buffer Excel thành mảng dữ liệu thô, hỗ trợ linh hoạt cả tiêu đề tiếng Việt & tiếng Anh
   */
  private parseExcelBuffer(buffer: Buffer): ExcelRawRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[EXCEL_IMPORT_DEFAULT_SHEET_INDEX];

    if (!sheetName) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.EMPTY_FILE);
    }

    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    if (matrix.length === 0) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.EMPTY_FILE);
    }

    const firstRow = matrix[0] || [];
    const fieldIndexMap = this.detectColumnMapping(firstRow);

    return this.extractRawRows(matrix.slice(1), fieldIndexMap);
  }

  /**
   * Tự động nhận diện ánh xạ các cột từ dòng tiêu đề (hỗ trợ tiếng Việt có dấu, không dấu và tiếng Anh)
   */
  private detectColumnMapping(headerRow: unknown[]): Map<string, number> {
    const fieldIndexMap = new Map<string, number>();

    headerRow.forEach((cell, colIndex) => {
      const rawHeader = String(cell ?? '').trim().toLowerCase();
      if (!rawHeader) return;

      // Tra cứu qua bản đồ ánh xạ tiêu đề tiếng Việt
      const mappedField = EXCEL_HEADER_MAPPING[rawHeader];
      if (mappedField) {
        fieldIndexMap.set(mappedField, colIndex);
        return;
      }

      // Tra cứu trực tiếp với tên trường tiếng Anh
      if (EXCEL_IMPORT_STANDARD_COLUMNS.includes(rawHeader)) {
        fieldIndexMap.set(rawHeader, colIndex);
      }
    });

    // Nếu tiêu đề bị thiếu cột bắt buộc, áp dụng quy tắc fallback theo thứ tự cột chuẩn A-G
    const missingHeaders = EXCEL_IMPORT_REQUIRED_HEADERS.filter(
      (field) => !fieldIndexMap.has(field),
    );

    if (missingHeaders.length > 0) {
      if (headerRow.length >= EXCEL_IMPORT_REQUIRED_HEADERS.length) {
        return this.buildPositionalColumnMapping(headerRow.length);
      }
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.MISSING_HEADERS(missingHeaders));
    }

    return fieldIndexMap;
  }

  /**
   * Tạo bản đồ cột dựa trên thứ tự vị trí cố định A -> G theo quy chuẩn của modal
   */
  private buildPositionalColumnMapping(totalCols: number): Map<string, number> {
    const map = new Map<string, number>();
    EXCEL_IMPORT_STANDARD_COLUMNS.forEach((colName, index) => {
      if (index < totalCols) {
        map.set(colName, index);
      }
    });
    return map;
  }

  /**
   * Chuyển các dòng ma trận Excel thành danh sách ExcelRawRow
   */
  private extractRawRows(
    dataRows: unknown[][],
    fieldIndexMap: Map<string, number>,
  ): ExcelRawRow[] {
    const rawRows: ExcelRawRow[] = [];

    for (const rowCells of dataRows) {
      if (!Array.isArray(rowCells)) continue;

      const row: ExcelRawRow = {
        fullName: this.getCellValue(rowCells, fieldIndexMap.get('fullName')),
        username: this.getCellValue(rowCells, fieldIndexMap.get('username')),
        email: this.getCellValue(rowCells, fieldIndexMap.get('email')),
        password: this.getCellValue(rowCells, fieldIndexMap.get('password')),
        role: this.getCellValue(rowCells, fieldIndexMap.get('role')),
        phone: this.getCellValue(rowCells, fieldIndexMap.get('phone')),
        assignedWarehouse: this.getCellValue(rowCells, fieldIndexMap.get('assignedWarehouse')),
      };

      // Bỏ qua dòng hoàn toàn rỗng
      const hasContent = Object.values(row).some(
        (val) => typeof val === 'string' && val.trim().length > 0,
      );
      if (hasContent) {
        rawRows.push(row);
      }
    }

    return rawRows;
  }

  /**
   * Lấy giá trị chuỗi an toàn từ một ô tính
   */
  private getCellValue(rowCells: unknown[], colIndex?: number): string {
    if (colIndex === undefined || colIndex < 0 || colIndex >= rowCells.length) {
      return '';
    }
    return String(rowCells[colIndex] ?? '').trim();
  }

  // ──────────────────────────────────────────────
  // XỬ LÝ DỮ LIỆU TỪNG DÒNG
  // ──────────────────────────────────────────────

  /**
   * Duyệt qua toàn bộ danh sách dòng, thực hiện validate và tạo tài khoản
   */
  private async processRows(rawRows: ExcelRawRow[]): Promise<ImportRowResult[]> {
    const results: ImportRowResult[] = [];
    const seenUsernames = new Set<string>();
    const seenEmails = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 2; // Dòng 1 là tiêu đề, dữ liệu bắt đầu từ dòng 2
      const raw = rawRows[i];
      const result = await this.processOneRow(rowNumber, raw, seenUsernames, seenEmails);
      results.push(result);

      // Cứ sau mỗi chunk (50 dòng), nhả Event Loop để server xử lý các tác vụ khác mượt mà
      if (i > 0 && i % EXCEL_IMPORT_CHUNK_SIZE === 0) {
        await this.yieldEventLoop();
      }
    }

    // Ghi đĩa đồng bộ 1 lần duy nhất sau khi hoàn tất toàn bộ danh sách để tối ưu hiệu năng
    this.usersService.flushUsersToDisk();

    return results;
  }

  /**
   * Nhả luồng Event Loop của Node.js giúp máy chủ không bị nghẽn (không bị lag) khi import số lượng lớn
   */
  private async yieldEventLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }


  /**
   * Xử lý độc lập một dòng dữ liệu
   */
  private async processOneRow(
    rowNumber: number,
    raw: ExcelRawRow,
    seenUsernames: Set<string>,
    seenEmails: Set<string>,
  ): Promise<ImportRowResult> {
    const rawData: CleanRowData = {
      fullName: String(raw.fullName ?? '').trim(),
      username: String(raw.username ?? '').trim(),
      email: String(raw.email ?? '').trim(),
      role: String(raw.role ?? '').trim(),
      phone: String(raw.phone ?? '').trim(),
      password: raw.password ? String(raw.password).trim() : undefined,
      assignedWarehouse: String(raw.assignedWarehouse ?? '').trim(),
    };

    // 1. Phân giải vai trò
    const resolvedRole = this.resolveRole(rawData.role);

    // 2. Kiểm tra tính hợp lệ của từng trường
    const errors = this.validateRowFields(
      rawData,
      resolvedRole,
      seenUsernames,
      seenEmails,
    );

    if (errors.length > 0) {
      return {
        row: rowNumber,
        rawData,
        status: 'FAILED',
        errors,
      };
    }

    // 3. Ghi nhận username và email để ngăn trùng lặp giữa các dòng trong cùng tệp
    seenUsernames.add(rawData.username.toLowerCase());
    seenEmails.add(rawData.email.toLowerCase());

    // 4. Tạo tài khoản trong cơ sở dữ liệu với chế độ tối ưu cho batch import
    return this.createAccountForRow(rowNumber, rawData, resolvedRole as UserRole);
  }

  /**
   * Kiểm tra định dạng dữ liệu từng trường của một dòng
   */
  private validateRowFields(
    data: CleanRowData,
    resolvedRole: UserRole | string,
    seenUsernames: Set<string>,
    seenEmails: Set<string>,
  ): string[] {
    const errors: string[] = [];

    // Họ và tên
    if (!data.fullName) {
      errors.push(EXCEL_IMPORT_MESSAGES.FULLNAME_EMPTY);
    }

    // Username
    this.validateUsername(data.username, seenUsernames, errors);

    // Email
    this.validateEmail(data.email, seenEmails, errors);

    // Số điện thoại (nếu có nhập)
    if (data.phone) {
      this.validatePhone(data.phone, errors);
    }

    // Vai trò & Điều kiện vai trò
    this.validateRoleAndWarehouse(data, resolvedRole, errors);

    return errors;
  }

  /**
   * Validate định dạng tên đăng nhập (Username)
   */
  private validateUsername(
    username: string,
    seenUsernames: Set<string>,
    errors: string[],
  ): void {
    if (!username) {
      errors.push(EXCEL_IMPORT_MESSAGES.USERNAME_EMPTY);
      return;
    }

    if (EXCEL_IMPORT_REGEX.HAS_WHITESPACE.test(username)) {
      errors.push(EXCEL_IMPORT_MESSAGES.USERNAME_HAS_SPACE);
    }

    if (username.length < EXCEL_IMPORT_LENGTH_RULES.USERNAME_MIN) {
      errors.push(EXCEL_IMPORT_MESSAGES.USERNAME_TOO_SHORT);
    }

    if (username.length > EXCEL_IMPORT_LENGTH_RULES.USERNAME_MAX) {
      errors.push(EXCEL_IMPORT_MESSAGES.USERNAME_TOO_LONG);
    }

    if (!EXCEL_IMPORT_REGEX.USERNAME_VALID.test(username)) {
      errors.push(EXCEL_IMPORT_MESSAGES.USERNAME_INVALID_CHARS);
    }

    if (seenUsernames.has(username.toLowerCase())) {
      errors.push(EXCEL_IMPORT_MESSAGES.USERNAME_DUPLICATE_FILE(username));
    }
  }

  /**
   * Validate định dạng Email
   */
  private validateEmail(
    email: string,
    seenEmails: Set<string>,
    errors: string[],
  ): void {
    if (!email) {
      errors.push(EXCEL_IMPORT_MESSAGES.EMAIL_EMPTY);
      return;
    }

    if (!email.includes('@')) {
      errors.push(EXCEL_IMPORT_MESSAGES.EMAIL_MISSING_AT);
      return;
    }

    if (!EXCEL_IMPORT_REGEX.EMAIL_BASIC.test(email)) {
      errors.push(EXCEL_IMPORT_MESSAGES.EMAIL_INVALID_FORMAT);
      return;
    }

    if (seenEmails.has(email.toLowerCase())) {
      errors.push(EXCEL_IMPORT_MESSAGES.EMAIL_DUPLICATE_FILE(email));
    }
  }

  /**
   * Validate định dạng Số điện thoại (Phone)
   */
  private validatePhone(phone: string, errors: string[]): void {
    if (EXCEL_IMPORT_REGEX.HAS_LETTERS.test(phone) || !EXCEL_IMPORT_REGEX.PHONE_DIGITS_ONLY.test(phone)) {
      errors.push(EXCEL_IMPORT_MESSAGES.PHONE_CONTAINS_LETTERS);
      return;
    }

    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.length < EXCEL_IMPORT_LENGTH_RULES.PHONE_MIN_DIGITS) {
      errors.push(EXCEL_IMPORT_MESSAGES.PHONE_TOO_SHORT);
      return;
    }

    if (digitsOnly.length > EXCEL_IMPORT_LENGTH_RULES.PHONE_MAX_DIGITS) {
      errors.push(EXCEL_IMPORT_MESSAGES.PHONE_TOO_LONG);
    }
  }

  /**
   * Validate vai trò và điều kiện gắn kho bắt buộc
   */
  private validateRoleAndWarehouse(
    data: CleanRowData,
    resolvedRole: UserRole | string,
    errors: string[],
  ): void {
    if (!data.role) {
      errors.push(EXCEL_IMPORT_MESSAGES.ROLE_EMPTY);
      return;
    }

    const isValidRole = (Object.values(UserRole) as string[]).includes(resolvedRole);
    if (!isValidRole) {
      errors.push(EXCEL_IMPORT_MESSAGES.ROLE_INVALID(data.role));
      return;
    }

    const isWarehouseRole =
      resolvedRole === UserRole.WAREHOUSE_KEEPER ||
      resolvedRole === UserRole.WAREHOUSE_MANAGER;

    if (isWarehouseRole && !data.assignedWarehouse) {
      errors.push(EXCEL_IMPORT_MESSAGES.WAREHOUSE_REQUIRED);
    }
  }

  /**
   * Gọi service tạo tài khoản và bắt ngoại lệ nếu có lỗi CSDL/trùng lặp
   */
  private async createAccountForRow(
    rowNumber: number,
    rawData: CleanRowData,
    role: UserRole,
  ): Promise<ImportRowResult> {
    try {
      const createResult = await this.usersService.create(
        {
          fullName: rawData.fullName,
          username: rawData.username,
          email: rawData.email,
          role,
          phone: rawData.phone || undefined,
          password: rawData.password,
          assignedWarehouse: rawData.assignedWarehouse || undefined,
        },
        {
          skipEmail: true,
          skipDiskSync: true,
          saltRounds: EXCEL_IMPORT_BATCH_SALT_ROUNDS,
        },
      );


      this.logger.log(
        `[ExcelImportService] ✅ Dòng ${rowNumber}: Tạo thành công "${rawData.username}" (${rawData.email})`,
      );

      return {
        row: rowNumber,
        rawData,
        status: 'SUCCESS',
        createdUser: createResult.user,
        temporaryPassword: createResult.temporaryPassword,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Lỗi không xác định khi tạo tài khoản.';

      this.logger.warn(`[ExcelImportService] ❌ Dòng ${rowNumber}: ${message}`);

      return {
        row: rowNumber,
        rawData,
        status: 'FAILED',
        errors: [message],
      };
    }
  }

  /**
   * Phân giải chuỗi vai trò đầu vào sang UserRole enum chuẩn
   */
  private resolveRole(roleInput: string): UserRole | string {
    const normalized = roleInput.trim().toLowerCase();

    // Đối chiếu trực tiếp với các giá trị enum
    const exactMatch = (Object.values(UserRole) as string[]).find(
      (enumValue) => enumValue.toLowerCase() === normalized,
    );
    if (exactMatch) return exactMatch as UserRole;

    // Đối chiếu với danh mục alias tiếng Việt
    const aliasMatch = ROLE_ALIAS_MAP[normalized];
    if (aliasMatch) return aliasMatch;

    return roleInput;
  }

  /**
   * Tổng hợp báo cáo kết quả import
   */
  private buildReport(
    totalRows: number,
    results: ImportRowResult[],
  ): ImportUsersReportDto {
    const successResults = results.filter((r) => r.status === 'SUCCESS');
    const failedResults = results.filter((r) => r.status === 'FAILED');

    const createdUsers = successResults.map((r) => ({
      ...r.createdUser!,
      temporaryPassword: r.temporaryPassword ?? '',
    }));

    // Để chống tràn bộ nhớ (Heap Out Of Memory) và tối ưu băng thông khi nạp số lượng cực lớn,
    // giữ nguyên toàn bộ dòng FAILED và preview các dòng SUCCESS tối đa theo hằng số
    const displayedResults =
      results.length > EXCEL_IMPORT_MAX_DETAIL_PREVIEW
        ? [
            ...failedResults,
            ...successResults.slice(
              0,
              Math.max(0, EXCEL_IMPORT_MAX_DETAIL_PREVIEW - failedResults.length),
            ),
          ]
        : results;

    const displayedCreatedUsers =
      createdUsers.length > EXCEL_IMPORT_MAX_DETAIL_PREVIEW
        ? createdUsers.slice(0, EXCEL_IMPORT_MAX_DETAIL_PREVIEW)
        : createdUsers;

    let reasonText = '';
    if (failedResults.length > 0) {
      const sample = failedResults[0];
      const sampleMsg = sample.errors?.[0] || '';
      if (sampleMsg.includes('đã tồn tại') || sampleMsg.includes('đã được sử dụng')) {
        reasonText = ` (Lý do: Tên đăng nhập hoặc email đã tồn tại trên hệ thống: ${sampleMsg})`;
      } else if (sampleMsg.includes('trùng lặp')) {
        reasonText = ` (Lý do: Dữ liệu bị trùng lặp trong tệp, ví dụ dòng #${sample.row})`;
      } else if (sampleMsg) {
        reasonText = ` (Lý do dòng #${sample.row}: ${sampleMsg})`;
      }
    }

    const report = new ImportUsersReportDto();
    report.totalRows = totalRows;
    report.successCount = successResults.length;
    report.failedCount = failedResults.length;
    report.results = displayedResults;
    report.createdUsers = displayedCreatedUsers;
    report.summary =
      EXCEL_IMPORT_MESSAGES.IMPORT_SUCCESS(
        successResults.length,
        failedResults.length,
      ) + reasonText;

    return report;
  }
}
