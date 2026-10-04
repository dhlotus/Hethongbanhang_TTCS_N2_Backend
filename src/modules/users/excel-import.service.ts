import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import * as XLSX from 'xlsx';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  EXCEL_IMPORT_ALLOWED_EXTENSIONS,
  EXCEL_IMPORT_ALLOWED_MIME_TYPES,
  EXCEL_IMPORT_DEFAULT_SHEET_INDEX,
  EXCEL_IMPORT_MAX_FILE_SIZE,
  EXCEL_IMPORT_MAX_ROWS,
  EXCEL_IMPORT_MESSAGES,
  EXCEL_IMPORT_REQUIRED_HEADERS,
} from './constants/excel-import.constant';
import { ExcelUserRowDto } from './dto/excel-user-row.dto';
import {
  ExcelRawRow,
  ImportRowResult,
  ImportUsersReportDto,
  ROLE_ALIAS_MAP,
} from './dto/import-users-report.dto';
import { UsersService } from './users.service';

/**
 * Service xử lý tệp Excel, validate dữ liệu từng dòng và tạo tài khoản hàng loạt (SN-147).
 *
 * Nguyên tắc thiết kế:
 * - Single Responsibility: Chỉ xử lý luồng import Excel
 * - Mỗi dòng được validate độc lập; lỗi 1 dòng không dừng quá trình import
 * - Trả về báo cáo tổng kết đầy đủ: thành công / thất bại / chi tiết từng dòng
 * - Tuân thủ Code Convention: Zero any, Strict TypeScript, kebab-case file
 */
@Injectable()
export class ExcelImportService {
  private readonly logger = new Logger(ExcelImportService.name);

  constructor(private readonly usersService: UsersService) {}

  /**
   * Điểm vào chính: nhận file Excel từ controller, xử lý toàn bộ luồng import.
   * @param file - File Excel được upload qua multipart/form-data
   * @returns Báo cáo tổng kết (ImportUsersReportDto)
   */
  async importFromExcel(file?: Express.Multer.File): Promise<ImportUsersReportDto> {
    // Bước 1: Validate file đầu vào (kích thước, định dạng)
    this.validateFile(file);

    // Bước 2: Parse file Excel thành mảng dòng thô
    const rawRows = this.parseExcelBuffer(file.buffer);

    if (rawRows.length === 0) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.EMPTY_FILE);
    }

    if (rawRows.length > EXCEL_IMPORT_MAX_ROWS) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.MAX_ROWS_EXCEEDED);
    }

    this.logger.log(
      `[ExcelImportService] Bắt đầu import ${rawRows.length} dòng từ file "${file.originalname}"`,
    );

    // Bước 3: Xử lý từng dòng – validate và tạo tài khoản
    const results = await this.processRows(rawRows);

    // Bước 4: Tổng hợp báo cáo
    const report = this.buildReport(rawRows.length, results);

    this.logger.log(
      `[ExcelImportService] Hoàn tất import: ${report.successCount} thành công, ${report.failedCount} thất bại.`,
    );

    return report;
  }

  // ──────────────────────────────────────────────
  // PRIVATE: Validate file đầu vào
  // ──────────────────────────────────────────────

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

  private extractExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filename.slice(lastDot).toLowerCase();
  }

  // ──────────────────────────────────────────────
  // PRIVATE: Parse Excel buffer → mảng dòng thô
  // ──────────────────────────────────────────────

  private parseExcelBuffer(buffer: Buffer): ExcelRawRow[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[EXCEL_IMPORT_DEFAULT_SHEET_INDEX];

    if (!sheetName) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.EMPTY_FILE);
    }

    const sheet = workbook.Sheets[sheetName];
    // Chuyển sheet thành mảng object, dòng đầu là header
    const allRows = XLSX.utils.sheet_to_json<ExcelRawRow>(sheet, {
      defval: '',
      raw: false,
    });

    if (allRows.length === 0) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.EMPTY_FILE);
    }

    // Kiểm tra các cột bắt buộc có trong header không
    const firstRow = allRows[0] as Record<string, unknown>;
    const presentHeaders = Object.keys(firstRow);
    const missingHeaders = EXCEL_IMPORT_REQUIRED_HEADERS.filter(
      (header: string) => !presentHeaders.includes(header),
    );

    if (missingHeaders.length > 0) {
      throw new BadRequestException(EXCEL_IMPORT_MESSAGES.MISSING_HEADERS(missingHeaders));
    }

    return allRows;
  }

  // ──────────────────────────────────────────────
  // PRIVATE: Xử lý từng dòng
  // ──────────────────────────────────────────────

  private async processRows(rawRows: ExcelRawRow[]): Promise<ImportRowResult[]> {
    const results: ImportRowResult[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 2; // Dòng 1 = header, dữ liệu bắt đầu từ dòng 2
      const raw = rawRows[i];
      const result = await this.processOneRow(rowNumber, raw);
      results.push(result);
    }

    return results;
  }

  private async processOneRow(
    rowNumber: number,
    raw: ExcelRawRow,
  ): Promise<ImportRowResult> {
    const rawData = {
      fullName: String(raw.fullName ?? '').trim(),
      username: String(raw.username ?? '').trim(),
      email: String(raw.email ?? '').trim(),
      role: String(raw.role ?? '').trim(),
      phone: String(raw.phone ?? '').trim(),
      assignedWarehouse: String(raw.assignedWarehouse ?? '').trim(),
    };

    // 1. Chuẩn hóa role (hỗ trợ alias tiếng Việt hoặc English)
    const resolvedRole = this.resolveRole(rawData.role);

    // 2. Tạo DTO và validate bằng class-validator
    const dtoInput: Partial<ExcelUserRowDto> = {
      fullName: rawData.fullName,
      username: rawData.username,
      email: rawData.email,
      role: resolvedRole as UserRole,
      phone: rawData.phone || undefined,
      password: raw.password ? String(raw.password).trim() : undefined,
      assignedWarehouse: rawData.assignedWarehouse || undefined,
    };

    const dto = plainToInstance(ExcelUserRowDto, dtoInput) as ExcelUserRowDto;

    const validationErrors: ValidationError[] = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });

    if (validationErrors.length > 0) {
      const errorMessages = validationErrors.flatMap((e) =>
        Object.values(e.constraints ?? {}),
      );

      // Validate thêm định dạng email thủ công
      const emailErrors = this.validateEmail(rawData.email);
      const allErrors = [...errorMessages, ...emailErrors].filter(Boolean);

      return {
        row: rowNumber,
        rawData,
        status: 'FAILED',
        errors: allErrors,
      };
    }

    // 3. Validate email format thủ công bổ sung
    const emailErrors = this.validateEmail(rawData.email);
    if (emailErrors.length > 0) {
      return {
        row: rowNumber,
        rawData,
        status: 'FAILED',
        errors: emailErrors,
      };
    }

    // 4. Gọi UsersService.create để tạo tài khoản (xử lý trùng lặp và nghiệp vụ)
    try {
      const createResult = await this.usersService.create({
        fullName: dto.fullName,
        username: dto.username,
        email: dto.email,
        role: dto.role,
        phone: dto.phone,
        password: dto.password,
        assignedWarehouse: dto.assignedWarehouse,
      });

      this.logger.log(
        `[ExcelImportService] ✅ Dòng ${rowNumber}: Tạo thành công tài khoản "${dto.username}" (${dto.email})`,
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

      this.logger.warn(
        `[ExcelImportService] ❌ Dòng ${rowNumber}: Thất bại - ${message}`,
      );

      return {
        row: rowNumber,
        rawData,
        status: 'FAILED',
        errors: [message],
      };
    }
  }

  // ──────────────────────────────────────────────
  // PRIVATE: Helpers
  // ──────────────────────────────────────────────

  /**
   * Phân giải vai trò từ chuỗi đầu vào (hỗ trợ tiếng Việt và English).
   * Ưu tiên: Exact match với UserRole enum → ROLE_ALIAS_MAP → giữ nguyên để validate lỗi
   */
  private resolveRole(roleInput: string): UserRole | string {
    const normalized = roleInput.trim().toLowerCase();

    // Thử match trực tiếp với UserRole enum (case-insensitive)
    const exactMatch = (Object.values(UserRole) as string[]).find(
      (enumValue) => enumValue.toLowerCase() === normalized,
    );
    if (exactMatch) return exactMatch as UserRole;

    // Thử match trong ROLE_ALIAS_MAP
    const aliasMatch = ROLE_ALIAS_MAP[normalized];
    if (aliasMatch) return aliasMatch;

    // Không nhận ra → giữ nguyên để class-validator @IsEnum báo lỗi
    return roleInput;
  }

  /**
   * Validate định dạng email thủ công bổ sung.
   * @returns Mảng thông báo lỗi (rỗng nếu hợp lệ)
   */
  private validateEmail(email: string): string[] {
    const errors: string[] = [];
    if (!email) {
      errors.push('Email không được để trống');
      return errors;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push(`Email "${email}" không đúng định dạng`);
    }
    return errors;
  }

  // ──────────────────────────────────────────────
  // PRIVATE: Tổng hợp báo cáo
  // ──────────────────────────────────────────────

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

    const report = new ImportUsersReportDto();
    report.totalRows = totalRows;
    report.successCount = successResults.length;
    report.failedCount = failedResults.length;
    report.results = results;
    report.createdUsers = createdUsers;
    report.summary = EXCEL_IMPORT_MESSAGES.IMPORT_SUCCESS(
      successResults.length,
      failedResults.length,
    );

    return report;
  }
}
