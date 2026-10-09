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

    it('TC-03: Nem BadRequestException khi file qua dung luong (> 25MB)', async () => {
      const hugeBuffer = Buffer.alloc(26 * 1024 * 1024, 0);
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

  // ──────────────────────────────────────────────────
  // NHOM 8: File Tiếng Việt 50 Dòng Hợp Lệ & Hiệu Năng
  // ──────────────────────────────────────────────────

  describe('File Tiếng Việt 50 dòng hợp lệ (Ngăn chặn triệt để timeout 10000ms)', () => {
    it('TC-23: Import file 50 dòng tiếng Việt hợp lệ thành công trong thời gian ngắn', async () => {
      const vietnameseHeaders = [
        'Họ và tên',
        'Username',
        'Email',
        'Mật khẩu',
        'Vai trò',
        'Số ĐT',
        'Kho phụ trách',
      ];

      const rows: Record<string, unknown>[] = [];
      for (let i = 1; i <= 50; i++) {
        rows.push({
          'Họ và tên': `Nguyễn Văn Nhân Viên ${i}`,
          'Username': `nvkd_vn_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`,
          'Email': `nhanvien_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}@loha.vn`,
          'Mật khẩu': 'Loha@123456',
          'Vai trò': 'Nhân viên kinh doanh',
          'Số ĐT': `09012345${(i % 90 + 10).toString()}`,
          'Kho phụ trách': '',
        });
      }

      const worksheet = XLSX.utils.json_to_sheet(rows, { header: vietnameseHeaders });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      const buffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
      const file = buildMulterFile(buffer, 'Danh_Sach_50_Tai_Khoan_NVKD_TiengViet.xlsx');

      const startTime = Date.now();
      const report = await excelImportService.importFromExcel(file);
      const durationMs = Date.now() - startTime;

      expect(report.totalRows).toBe(50);
      expect(report.successCount).toBe(50);
      expect(report.failedCount).toBe(0);
      expect(report.createdUsers).toHaveLength(50);
      // Đảm bảo thời gian chạy 50 dòng nhanh hơn nhiều so với giới hạn timeout 10000ms
      expect(durationMs).toBeLessThan(8000);
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 9: Kiểm Thử Định Dạng Username
  // ──────────────────────────────────────────────────

  describe('Kiểm thử định dạng Username (Chứa khoảng trắng, độ dài, ký tự)', () => {
    it('TC-24: Username chứa khoảng trắng -> FAILED, bắt đúng lỗi', async () => {
      const rows = [buildValidRow({ username: 'nguyen van a' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
      expect(
        report.results[0].errors!.some((e) => e.toLowerCase().includes('khoảng trắng')),
      ).toBe(true);
    });

    it('TC-25: Username quá ngắn (< 3 ký tự) -> FAILED', async () => {
      const rows = [buildValidRow({ username: 'ab' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
      expect(
        report.results[0].errors!.some((e) => e.toLowerCase().includes('3 ký tự')),
      ).toBe(true);
    });

    it('TC-26: Username chứa ký tự đặc biệt không cho phép -> FAILED', async () => {
      const rows = [buildValidRow({ username: 'user@name#123' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 10: Kiểm Thử Định Dạng Email
  // ──────────────────────────────────────────────────

  describe('Kiểm thử định dạng Email (Thiếu ký tự @, domain)', () => {
    it('TC-27: Email thiếu ký tự @ -> FAILED, báo lỗi thiếu @ rõ ràng', async () => {
      const rows = [buildValidRow({ email: 'nguyenvana_loha.vn' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
      expect(
        report.results[0].errors!.some((e) => e.includes('@')),
      ).toBe(true);
    });

    it('TC-28: Email sai định dạng miền -> FAILED', async () => {
      const rows = [buildValidRow({ email: 'test@invalid_domain' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 11: Kiểm Thử Định Dạng Số Điện Thoại
  // ──────────────────────────────────────────────────

  describe('Kiểm thử định dạng Số điện thoại (Chứa chữ cái, ngắn quá)', () => {
    it('TC-29: Số điện thoại chứa chữ cái -> FAILED, báo lỗi rõ ràng', async () => {
      const rows = [buildValidRow({ phone: '090123abc' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
      expect(
        report.results[0].errors!.some(
          (e) => e.toLowerCase().includes('chữ') || e.toLowerCase().includes('không hợp lệ'),
        ),
      ).toBe(true);
    });

    it('TC-30: Số điện thoại quá ngắn (< 10 số) -> FAILED', async () => {
      const rows = [buildValidRow({ phone: '0901234' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('FAILED');
      expect(
        report.results[0].errors!.some((e) => e.toLowerCase().includes('ngắn')),
      ).toBe(true);
    });

    it('TC-31: Số điện thoại hợp lệ (10 số) -> SUCCESS', async () => {
      const rows = [buildValidRow({ phone: '0901234567' })];
      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer);

      const report = await excelImportService.importFromExcel(file);

      expect(report.results[0].status).toBe('SUCCESS');
    });
  });

  // ──────────────────────────────────────────────────
  // NHOM 12: Kịch Bản Hỗn Hợp (Scenario 4)
  // ──────────────────────────────────────────────────

  describe('Kiểm thử kịch bản hỗn hợp (Test_Kich_Ban_4_Validate_Format_Va_Logic)', () => {
    it('TC-32: File chứa dòng hợp lệ và các dòng sai format (email thiếu @, phone có chữ, username có space)', async () => {
      const rows = [
        // Dòng 1: Hợp lệ
        buildValidRow({ fullName: 'Nguyễn Văn Một' }),
        // Dòng 2: Email thiếu @
        buildValidRow({ fullName: 'Trần Văn Hai', email: 'thieu_at_loha.vn' }),
        // Dòng 3: Phone chứa chữ cái
        buildValidRow({ fullName: 'Lê Văn Ba', phone: '0901abc456' }),
        // Dòng 4: Phone quá ngắn
        buildValidRow({ fullName: 'Phạm Văn Bốn', phone: '09123' }),
        // Dòng 5: Username chứa khoảng trắng
        buildValidRow({ fullName: 'Hoàng Văn Năm', username: 'hoang van nam' }),
        // Dòng 6: Thủ kho thiếu kho
        buildValidRow({ fullName: 'Đỗ Văn Sáu', role: 'Thủ kho', assignedWarehouse: '' }),
        // Dòng 7: Hợp lệ
        buildValidRow({ fullName: 'Vũ Văn Bảy' }),
      ];

      const buffer = buildExcelBuffer(rows);
      const file = buildMulterFile(buffer, 'Test_Kich_Ban_4_Validate_Format_Va_Logic.xlsx');

      const report = await excelImportService.importFromExcel(file);

      expect(report.totalRows).toBe(7);
      expect(report.successCount).toBe(2);
      expect(report.failedCount).toBe(5);

      // Dòng 1 thành công
      expect(report.results[0].status).toBe('SUCCESS');
      // Dòng 2 lỗi email
      expect(report.results[1].status).toBe('FAILED');
      expect(report.results[1].errors!.some((e) => e.includes('@'))).toBe(true);
      // Dòng 3 lỗi SĐT chứa chữ
      expect(report.results[2].status).toBe('FAILED');
      // Dòng 4 lỗi SĐT ngắn
      expect(report.results[3].status).toBe('FAILED');
      // Dòng 5 lỗi username khoảng trắng
      expect(report.results[4].status).toBe('FAILED');
      expect(report.results[4].errors!.some((e) => e.includes('khoảng trắng'))).toBe(true);
      // Dòng 6 lỗi kho
      expect(report.results[5].status).toBe('FAILED');
      // Dòng 7 thành công
      expect(report.results[6].status).toBe('SUCCESS');
    });
  });
});

