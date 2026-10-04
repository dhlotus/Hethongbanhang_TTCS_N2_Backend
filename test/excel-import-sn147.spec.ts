/**
 * Integration Test: Excel Import – Tạo Tài Khoản Hàng Loạt (SN-147)
 *
 * Bao phủ toàn bộ các luồng nghiệp vụ:
 * 1. Validate file đầu vào (thiếu file, sai định dạng, quá dung lượng)
 * 2. Validate header cột bắt buộc trong file Excel
 * 3. Validate từng dòng dữ liệu (thiếu trường, vai trò sai, email sai)
 * 4. Tạo tài khoản thành công và trả về báo cáo tổng kết
 * 5. Xử lý lỗi trùng lặp (username / email đã tồn tại)
 * 6. Hỗ trợ alias vai trò tiếng Việt (e.g. "Thủ kho" → WAREHOUSE_KEEPER)
 * 7. Dòng hợp lệ vẫn xử lý khi dòng khác lỗi (không dừng toàn bộ batch)
 */

import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ExcelImportService } from '../src/modules/users/excel-import.service';
import { UsersService } from '../src/modules/users/users.service';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Tạo Buffer Excel từ mảng dòng dữ liệu (bao gồm header tự động) */
function buildExcelBuffer(rows: Record<string, unknown>[]): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

/** Tạo Multer.File giả từ buffer */
function buildMulterFile(
  buffer: Buffer,
  filename = 'users_import.xlsx',
  mimetype = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: filename,
    encoding: '7bit',
    mimetype,
    buffer,
    size: buffer.length,
    stream: null as unknown as import('stream').Readable,
    destination: '',
    filename,
    path: '',
  };
}

/** Dòng dữ liệu hợp lệ mẫu */
function buildValidRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Nguyen Van A',
    username: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    email: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@loha.vn`,
    role: UserRole.SALES_REP,
    phone: '0901234567',
    assignedWarehouse: '',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Setup
// ────────────────────────────────────────────────────────────────────────────

describe('[SN-147] Excel Import – Tao Tai Khoan Hang Loat', () => {
  let excelImportService: ExcelImportService;
  let usersService: UsersService;

  beforeEach(() => {
    usersService = new UsersService(null as never);
    excelImportService = new ExcelImportService(usersService);
  });

  // ──────────────────────────────────────────────────
  // NHOM 1: Validate File Dau Vao
  // ──────────────────────────────────────────────────

  describe('Validate file dau vao', () => {
    it('TC-01: Nem BadRequestException khi khong co file (null)', async () => {
      await expect(
        excelImportService.importFromExcel(null as unknown as Express.Multer.File),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('TC-02: Nem BadRequestException khi MIME type khong hop le (.pdf)', async () => {
      const buffer = Buffer.from('fake pdf content');
      const file = buildMulterFile(buffer, 'users.pdf', 'application/pdf');
      await expect(excelImportService.importFromExcel(file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('TC-03: Nem BadRequestException khi file qua dung luong (> 5MB)', async () => {
      const hugeBuffer = Buffer.alloc(6 * 1024 * 1024, 0);
      const file = buildMulterFile(hugeBuffer, 'large.xlsx');
      await expect(excelImportService.importFromExcel(file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('TC-04: Nem BadRequestException khi file Excel rong (khong co dong nao)', async () => {
      const worksheet = XLSX.utils.aoa_to_sheet([]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      const buffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
      const file = buildMulterFile(buffer);
      await expect(excelImportService.importFromExcel(file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('TC-05: Nem BadRequestException khi thieu cot bat buoc (thieu email)', async () => {
      const rows = [{ fullName: 'Nguyen Van A', username: 'nva', role: 'SALES_REP' }];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);
      await expect(excelImportService.importFromExcel(file)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 2: Validate Tung Dong Du Lieu
  // ──────────────────────────────────────────────────

  describe('Validate tung dong du lieu', () => {
    it('TC-06: Dong thieu fullName -> status = FAILED, co thong bao loi ro rang', async () => {
      const rows = [buildValidRow({ fullName: '' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.failedCount).toBe(1);
      expect(report.successCount).toBe(0);
      expect(report.results[0].status).toBe('FAILED');
      expect(report.results[0].errors).toBeDefined();
      expect(report.results[0].errors!.length).toBeGreaterThan(0);
    });

    it('TC-07: Dong co vai tro khong hop le -> status = FAILED', async () => {
      const rows = [buildValidRow({ role: 'SUPER_ADMIN_INVALID' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
      expect(report.results[0].errors!.some((e) => e.includes('vai tr') || e.includes('Vai tr'))).toBe(true);
    });

    it('TC-08: Dong co email sai dinh dang -> status = FAILED', async () => {
      const rows = [buildValidRow({ email: 'not-an-email' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
    });

    it('TC-09: Dong thieu username -> status = FAILED', async () => {
      const rows = [buildValidRow({ username: '' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 3: Tao Tai Khoan Thanh Cong
  // ──────────────────────────────────────────────────

  describe('Tao tai khoan thanh cong', () => {
    it('TC-10: 1 dong hop le -> successCount = 1, tra ve user va temporaryPassword', async () => {
      const rows = [buildValidRow()];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.totalRows).toBe(1);
      expect(report.successCount).toBe(1);
      expect(report.failedCount).toBe(0);
      expect(report.results[0].status).toBe('SUCCESS');
      expect(report.results[0].createdUser).toBeDefined();
      expect(report.results[0].temporaryPassword).toBeDefined();
      expect(typeof report.results[0].temporaryPassword).toBe('string');
      expect(report.createdUsers).toHaveLength(1);
    });

    it('TC-11: 3 dong hop le -> successCount = 3, bao cao day du', async () => {
      const rows = [
        buildValidRow({ role: UserRole.ADMIN }),
        buildValidRow({ role: UserRole.ACCOUNTANT }),
        buildValidRow({ role: UserRole.SALES_MANAGER }),
      ];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.successCount).toBe(3);
      expect(report.failedCount).toBe(0);
      expect(report.createdUsers).toHaveLength(3);
    });

    it('TC-12: Bao cao summary chua so tai khoan tao thanh cong', async () => {
      const rows = [buildValidRow()];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.summary).toContain('1');
    });

    it('TC-13: Tai khoan duoc tao khong lo passwordHash (SafeUser)', async () => {
      const rows = [buildValidRow()];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);
      const createdUser = report.results[0].createdUser!;

      expect((createdUser as unknown as Record<string, unknown>)['passwordHash']).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 4: Xu Ly Loi Trung Lap
  // ──────────────────────────────────────────────────

  describe('Xu ly loi trung lap (username / email)', () => {
    it('TC-14: Import cung username 2 lan -> dong 2 FAILED do trung username', async () => {
      const sharedUsername = `dup_user_${Date.now()}`;
      const rows = [
        buildValidRow({ username: sharedUsername, email: `a_${Date.now()}@loha.vn` }),
        buildValidRow({ username: sharedUsername, email: `b_${Date.now()}@loha.vn` }),
      ];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.successCount).toBe(1);
      expect(report.failedCount).toBe(1);
      expect(report.results[1].status).toBe('FAILED');
    });

    it('TC-15: Import cung email 2 lan -> dong 2 FAILED do trung email', async () => {
      const sharedEmail = `dup_${Date.now()}@loha.vn`;
      const rows = [
        buildValidRow({ email: sharedEmail }),
        buildValidRow({ email: sharedEmail }),
      ];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.successCount).toBe(1);
      expect(report.failedCount).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 5: Alias Vai Tro Tieng Viet
  // ──────────────────────────────────────────────────

  describe('Ho tro alias vai tro tieng Viet', () => {
    it('TC-16: "thu kho" duoc phan giai thanh WAREHOUSE_KEEPER va tao thanh cong', async () => {
      const rows = [buildValidRow({ role: 'thukho', assignedWarehouse: 'Kho Ha Noi' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('SUCCESS');
    });

    it('TC-17: "ketoan" duoc phan giai thanh ACCOUNTANT va tao thanh cong', async () => {
      const rows = [buildValidRow({ role: 'ketoan' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('SUCCESS');
    });

    it('TC-18: "quantrivien" duoc phan giai thanh ADMIN', async () => {
      const rows = [buildValidRow({ role: 'quantrivien' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('SUCCESS');
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 6: Batch Processing – Loi 1 Dong Khong Dung Batch
  // ──────────────────────────────────────────────────

  describe('Batch processing – loi 1 dong khong dung ca batch', () => {
    it('TC-19: 5 dong, dong 2 loi role, cac dong con lai van duoc xu ly', async () => {
      const rows = [
        buildValidRow(),
        buildValidRow({ role: 'INVALID_ROLE' }),
        buildValidRow(),
        buildValidRow({ email: 'bad-email' }),
        buildValidRow(),
      ];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.totalRows).toBe(5);
      expect(report.successCount).toBe(3);
      expect(report.failedCount).toBe(2);
      expect(report.results).toHaveLength(5);
      expect(report.results[0].status).toBe('SUCCESS');
      expect(report.results[1].status).toBe('FAILED');
      expect(report.results[2].status).toBe('SUCCESS');
      expect(report.results[3].status).toBe('FAILED');
      expect(report.results[4].status).toBe('SUCCESS');
    });

    it('TC-20: 10 dong tat ca hop le -> successCount = 10', async () => {
      const rows = Array.from({ length: 10 }, () => buildValidRow());
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.successCount).toBe(10);
      expect(report.failedCount).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 7: Rang Buoc Kho Voi Vai Tro Kho
  // ──────────────────────────────────────────────────

  describe('Rang buoc kho bat buoc voi vai tro WAREHOUSE_KEEPER / WAREHOUSE_MANAGER', () => {
    it('TC-21: WAREHOUSE_KEEPER khong co assignedWarehouse -> FAILED', async () => {
      const rows = [buildValidRow({ role: UserRole.WAREHOUSE_KEEPER, assignedWarehouse: '' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
      expect(
        report.results[0].errors!.some((e) => e.toLowerCase().includes('kho')),
      ).toBe(true);
    });

    it('TC-22: WAREHOUSE_KEEPER co assignedWarehouse -> SUCCESS', async () => {
      const rows = [
        buildValidRow({ role: UserRole.WAREHOUSE_KEEPER, assignedWarehouse: 'Kho Mien Bac' }),
      ];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('SUCCESS');
    });
  });
});
