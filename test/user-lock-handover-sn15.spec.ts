import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '../src/common/enums/user-role.enum';
import { UserStatus } from '../src/common/enums/user-status.enum';
import { jwtConfig } from '../src/config/jwt.config';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersService } from '../src/modules/users/users.service';

async function runSN15Tests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-15: KHÓA VÀ MỞ KHÓA TÀI KHOẢN KÈM CẢNH BÁO BÀN GIAO ĐẠI LÝ ===\n');

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
  const jwtService = new JwtService({
    secret: jwtConfig.secret,
    signOptions: { expiresIn: jwtConfig.expiresIn },
  });
  const authService = new AuthService(usersService, jwtService, mailService);

  // -------------------------------------------------------------
  // Test 1: Bắt buộc nhập lý do khi khóa tài khoản
  // -------------------------------------------------------------
  console.log('--- 1. Kiểm thử Bắt buộc nhập lý do khi khóa tài khoản ---');

  const salesUser = await usersService.findByEmailOrUsername('sales');
  assert(salesUser !== null, 'Tìm thấy tài khoản nhân viên kinh doanh "sales"');

  // 1.1 Khóa tài khoản nhưng để trống lý do -> Phải ném 400 Bad Request
  try {
    await usersService.updateStatus(
      salesUser!.id,
      {
        status: UserStatus.LOCKED,
        reason: '', // Lý do rỗng
      },
      { userId: 'admin-id', username: 'admin' },
    );
    assert(false, 'Hệ thống phải chặn khi khóa tài khoản mà không có lý do');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Bắt buộc phải nhập lý do khi khóa tài khoản'),
      'Chặn thành công (400 Bad Request): Khóa tài khoản bắt buộc phải có lý do',
    );
  }

  // 1.2 Khóa tài khoản với lý do toàn khoảng trắng -> Phải ném 400 Bad Request
  try {
    await usersService.updateStatus(
      salesUser!.id,
      {
        status: UserStatus.LOCKED,
        reason: '     ',
      },
      { userId: 'admin-id', username: 'admin' },
    );
    assert(false, 'Hệ thống phải chặn khi lý do chỉ chứa khoảng trắng');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Bắt buộc phải nhập lý do khi khóa tài khoản'),
      'Chặn thành công (400 Bad Request): Lý do khoảng trắng bị từ chối',
    );
  }

  // -------------------------------------------------------------
  // Test 2: Bảo mật Admin - Không thể tự khóa chính mình
  // -------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử Bảo mật Admin: Chặn tự khóa tài khoản của chính mình ---');

  const adminUser = await usersService.findByEmailOrUsername('admin');
  assert(adminUser !== null, 'Tìm thấy tài khoản quản trị viên "admin"');

  try {
    await usersService.updateStatus(
      adminUser!.id,
      {
        status: UserStatus.LOCKED,
        reason: 'Thử tự khóa tài khoản chính mình',
      },
      { userId: adminUser!.id, username: adminUser!.username },
    );
    assert(false, 'Hệ thống phải chặn Admin tự khóa chính mình');
  } catch (err: any) {
    assert(
      err instanceof BadRequestException &&
        err.message.includes('Bạn không thể tự khóa tài khoản quản trị của chính mình'),
      'Chặn thành công (400 Bad Request): Admin không thể tự khóa chính mình',
    );
  }

  // -------------------------------------------------------------
  // Test 3: Kiểm tra Đại lý phụ trách khi khóa nhân sự kinh doanh (SALES_REP)
  // -------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử Kiểm tra & Cảnh báo bàn giao Đại lý phụ trách ---');

  // 3.1 Truy vấn danh sách đại lý phụ trách trước khi khóa
  const assignedRes = await usersService.getAssignedCustomersResult(salesUser!.id);
  assert(assignedRes.total === 3, 'Nhân sự kinh doanh "sales" đang phụ trách chính xác 3 đại lý');
  assert(
    assignedRes.warning !== undefined &&
      assignedRes.warning.includes('Nhân sự này đang phụ trách 3 đại lý. Sau khi khóa, hệ thống khuyến nghị bạn thực hiện chuyển giao địa bàn cho nhân viên kinh doanh khác.'),
    'Hệ thống cung cấp cảnh báo bàn giao chi tiết cho người quản trị',
  );

  // 3.2 Khóa tài khoản nhân sự kinh doanh
  const lockRes = await usersService.updateStatus(
    salesUser!.id,
    {
      status: UserStatus.LOCKED,
      reason: 'Nhân sự đã nghỉ việc / Chấm dứt hợp đồng',
    },
    { userId: 'admin-id', username: 'admin' },
  );

  assert(lockRes.status === UserStatus.LOCKED, 'Trạng thái tài khoản chuyển sang LOCKED');
  assert(lockRes.lockReason === 'Nhân sự đã nghỉ việc / Chấm dứt hợp đồng', 'Lý do khóa được lưu chính xác');
  assert(lockRes.assignedCustomersCount === 3, 'Response khóa trả về số lượng đại lý bị ảnh hưởng (3 đại lý)');
  assert(
    lockRes.assignedCustomers.length === 3 &&
      lockRes.assignedCustomers.some((c) => c.code === 'DL-MK-001'),
    'Response khóa trả về danh sách chi tiết các đại lý cần chuyển giao địa bàn',
  );
  assert(
    Boolean(lockRes.handoverWarning),
    'Response khóa chứa cờ cảnh báo bàn giao handoverWarning chuẩn SN-15',
  );

  // -------------------------------------------------------------
  // Test 4: Thu hồi phiên tức thì & Chặn đăng nhập khi đã bị khóa
  // -------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử Thu hồi phiên tức thì & Chặn đăng nhập khi bị khóa ---');

  try {
    await authService.login({ username: 'sales', password: 'Password@2026' });
    assert(false, 'Hệ thống phải chặn tài khoản bị khóa đăng nhập');
  } catch (err: any) {
    assert(
      err.message.includes('Tài khoản đã bị quản trị viên khóa'),
      'Từ chối đăng nhập với thông báo rõ ràng kèm lý do khóa tài khoản',
    );
  }

  // -------------------------------------------------------------
  // Test 5: Mở khóa tài khoản thành công
  // -------------------------------------------------------------
  console.log('\n--- 5. Kiểm thử Mở khóa tài khoản nhân sự ---');

  const unlockRes = await usersService.updateStatus(
    salesUser!.id,
    {
      status: UserStatus.ACTIVE,
      reason: 'Khôi phục quyền truy cập sau khi hoàn tất kiểm tra',
    },
    { userId: 'admin-id', username: 'admin' },
  );

  assert(unlockRes.status === UserStatus.ACTIVE, 'Tài khoản được mở khóa về trạng thái ACTIVE');
  assert(unlockRes.lockReason === null, 'Lý do khóa được xóa bỏ khi mở khóa');

  // -------------------------------------------------------------
  // Tổng kết kết quả
  // -------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`KẾT QUẢ KIỂM THỬ SN-15: ${passedCount} PASS, ${failedCount} FAIL`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSN15Tests().catch((err) => {
  console.error('Lỗi thực thi kiểm thử SN-15:', err);
  process.exit(1);
});
