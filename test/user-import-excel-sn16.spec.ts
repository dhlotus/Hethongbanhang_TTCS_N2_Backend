import * as fs from 'fs';
import * as path from 'path';
import { UserRole } from '../src/common/enums/user-role.enum';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersService } from '../src/modules/users/users.service';

/**
 * Suite kiểm thử tự động cho Task SN-16:
 * Import tài khoản hàng loạt từ tệp Excel với validation từng dòng và báo cáo tổng kết.
 */
async function runSN16Tests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-16: IMPORT TÀI KHOẢN HÀNG LOẠT TỪ EXCEL ===\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string): void {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failedCount++;
    }
  }

  const usersService = new UsersService();
  const mailService = new MailService();
  // Mock mail service để test chạy nhanh trong 50ms, không phụ thuộc network Ethereal
  mailService.sendAccountActivationEmail = async () => ({ success: true });
  (usersService as any).mailService = mailService;

  // Đường dẫn tệp Excel mẫu
  const sampleExcelPath = path.resolve(__dirname, '..', 'users_import_sample.xlsx');
  assert(fs.existsSync(sampleExcelPath), 'Tồn tại tệp mẫu users_import_sample.xlsx');

  const fileBuffer = fs.readFileSync(sampleExcelPath);
  assert(fileBuffer.length > 0, 'Đọc thành công buffer tệp Excel');

  console.log('\n--- 1. Kiểm thử Thực thi importFromExcel() với tệp mẫu 10 dòng ---');
  const report = await usersService.importFromExcel(fileBuffer);

  // 1. Kiểm tra cấu trúc tổng kết
  assert(report.totalRows === 10, `Tổng số dòng xử lý đúng: ${report.totalRows}/10`);
  assert(report.successCount === 7, `Số tài khoản tạo thành công đúng: ${report.successCount}/7`);
  assert(report.failureCount === 3, `Số dòng lỗi nghiệp vụ đúng: ${report.failureCount}/3`);
  assert(report.skippedCount === 0, `Số dòng bỏ qua: ${report.skippedCount}`);

  console.log('\n--- 2. Kiểm thử Danh sách tài khoản tạo thành công (Success Items) ---');
  assert(report.successItems.length === 7, 'Mảng successItems có đúng 7 phần tử');

  // Kiểm tra tài khoản thành công đầu tiên (Dòng 2: maiphuong01)
  const firstSuccess = report.successItems[0];
  assert(firstSuccess.rowIndex === 2, 'Dòng thành công đầu tiên là dòng số 2');
  assert(firstSuccess.user.username === 'maiphuong01', 'Tên đăng nhập chuẩn hóa: maiphuong01');
  assert(firstSuccess.user.role === UserRole.SALES_REP, 'Khớp vai trò SALES_REP');
  assert(firstSuccess.temporaryPassword.length > 0, 'Tạo mật khẩu tạm thời thành công');

  // Kiểm tra tài khoản kho có thông tin kho (Dòng 3: hung.tran)
  const warehouseSuccess = report.successItems.find((item) => item.user.username === 'hung.tran');
  assert(warehouseSuccess !== undefined, 'Tài khoản thủ kho hung.tran được tạo thành công');
  assert(
    warehouseSuccess?.user.assignedWarehouse === 'Kho Tổng Miền Bắc - LOHA WH02',
    'Gán chính xác Kho phụ trách cho nhân sự kho',
  );

  // Kiểm tra chuẩn hóa vai trò tiếng Việt (Dòng 7: lananh.vu - "Thủ kho" -> WAREHOUSE_KEEPER)
  const vietnameseRoleUser = report.successItems.find((item) => item.user.username === 'lananh.vu');
  assert(vietnameseRoleUser !== undefined, 'Tài khoản lananh.vu được tạo thành công');
  assert(
    vietnameseRoleUser?.user.role === UserRole.WAREHOUSE_KEEPER,
    'Chuẩn hóa thành công vai trò tiếng Việt "Thủ kho" -> WAREHOUSE_KEEPER',
  );

  console.log('\n--- 3. Kiểm thử Danh sách dòng lỗi và lý do từ chối (Failure Items) ---');
  assert(report.failureItems.length === 3, 'Mảng failureItems có đúng 3 phần tử');

  // Dòng 9: Thiếu họ và tên
  const errorRow9 = report.failureItems.find((item) => item.rowIndex === 9);
  assert(errorRow9 !== undefined, 'Bắt lỗi dòng 9');
  assert(
    Boolean(errorRow9?.reason.includes('Họ và tên')),
    'Phát hiện chính xác lỗi thiếu họ và tên',
  );

  // Dòng 10: Trùng username hệ thống (admin)
  const errorRow10 = report.failureItems.find((item) => item.rowIndex === 10);
  assert(errorRow10 !== undefined, 'Bắt lỗi dòng 10');
  assert(
    Boolean(errorRow10?.reason.includes('đã tồn tại trong hệ thống')),
    'Phát hiện chính xác lỗi trùng username với hệ thống',
  );

  // Dòng 11: Lỗi email sai định dạng & thiếu kho phụ trách
  const errorRow11 = report.failureItems.find((item) => item.rowIndex === 11);
  assert(errorRow11 !== undefined, 'Bắt lỗi dòng 11');
  assert(
    Boolean(
      errorRow11?.reason.includes('Email không đúng định dạng') ||
        errorRow11?.reason.includes('Kho phụ trách'),
    ),
    'Phát hiện lỗi định dạng email hoặc thiếu kho phụ trách',
  );

  console.log('\n--- 4. Kiểm thử Chống trùng lặp trong nội bộ cùng một file Excel ---');
  // Chạy lại chính file vừa import -> Tất cả các dòng trước đây thành công giờ phải bị từ chối do trùng trong hệ thống
  const duplicateReport = await usersService.importFromExcel(fileBuffer);
  assert(duplicateReport.successCount === 0, 'Lần 2: 0 tài khoản mới nào được tạo do đã tồn tại');
  assert(duplicateReport.failureCount === 10, 'Lần 2: Cả 10 dòng đều bị từ chối do trùng lặp hoặc lỗi');

  console.log('\n======================================================');
  console.log(`KẾT QUẢ: ${passedCount} PASS, ${failedCount} FAIL`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSN16Tests().catch((err) => {
  console.error('Lỗi ngoài dự kiến khi chạy kiểm thử SN-16:', err);
  process.exit(1);
});
