import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { UserRole } from '../src/common/enums/user-role.enum';
import { UserStatus } from '../src/common/enums/user-status.enum';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { jwtConfig } from '../src/config/jwt.config';
import { AuthService } from '../src/modules/auth/auth.service';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersService } from '../src/modules/users/users.service';

function createMockExecutionContext(
  user: any,
  requiredRoles?: (UserRole | string)[],
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, headers: {} }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

async function runTests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-10: QUẢN LÝ NGƯỜI DÙNG & PHÂN QUYỀN HỆ THỐNG (USER MANAGEMENT & RBAC) ===\n');

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

  let activeRequiredRoles: (UserRole | string)[] | undefined = [UserRole.ADMIN];
  const mockReflector = {
    getAllAndOverride: (key: string) => {
      if (key === ROLES_KEY) return activeRequiredRoles;
      return undefined;
    },
  } as unknown as Reflector;

  const rolesGuard = new RolesGuard(mockReflector);

  // -------------------------------------------------------------
  // Phần 1: Đăng nhập Admin và Nhân viên kinh doanh
  // -------------------------------------------------------------
  console.log('--- 1. Chuẩn bị: Đăng nhập lấy quyền thao tác ---');
  const adminLogin = await authService.login({ username: 'admin', password: '123456' });
  const salesLogin = await authService.login({ username: 'sales', password: '123456' });

  assert(adminLogin.user.roles.includes(UserRole.ADMIN), 'Admin sở hữu quyền ADMIN');
  assert(salesLogin.user.roles.includes(UserRole.SALES_REP), 'Sales Rep sở hữu quyền SALES_REP');

  // -------------------------------------------------------------
  // Phần 2: Kiểm soát truy cập Module Users (Chỉ ADMIN)
  // -------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử Phân quyền Module Quản lý Người dùng (Chỉ ADMIN) ---');

  const adminCtx = createMockExecutionContext(adminLogin.user, [UserRole.ADMIN]);
  assert(rolesGuard.canActivate(adminCtx) === true, 'ADMIN được phép truy cập module Quản lý người dùng');

  const salesCtx = createMockExecutionContext(salesLogin.user, [UserRole.ADMIN]);
  try {
    rolesGuard.canActivate(salesCtx);
    assert(false, 'Hệ thống phải chặn SALES_REP khi truy cập module Quản lý người dùng');
  } catch (err: any) {
    assert(
      err instanceof ForbiddenException,
      'Từ chối truy cập (403 Forbidden): SALES_REP không được phép truy cập quản trị người dùng',
    );
  }

  // -------------------------------------------------------------
  // Phần 3: Lấy danh sách & Phân trang, Tìm kiếm
  // -------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử Lấy danh sách người dùng, Phân trang & Tìm kiếm ---');

  const listRes = await usersService.findAll({ page: 1, limit: 5 });
  assert(listRes.data.length === 5, 'Phân trang chính xác: Lấy được đúng 5 người dùng trên trang 1');
  assert(listRes.total >= 8, `Tổng số lượng người dùng chuẩn: ${listRes.total}`);
  assert((listRes.data[0] as any).passwordHash === undefined, 'Bảo mật dữ liệu: Tuyệt đối không để lộ passwordHash');

  const searchRes = await usersService.findAll({ search: 'Trần Văn Nam' });
  assert(searchRes.data.length === 1 && searchRes.data[0].username === 'sales', 'Tìm kiếm chính xác theo họ tên nhân sự');

  const filterRoleRes = await usersService.findAll({ role: UserRole.WAREHOUSE_KEEPER });
  assert(
    filterRoleRes.data.length >= 1 && filterRoleRes.data.every((u) => u.role === UserRole.WAREHOUSE_KEEPER),
    'Lọc chính xác danh sách nhân sự theo vai trò WAREHOUSE_KEEPER',
  );

  // -------------------------------------------------------------
  // Phần 4: Tạo tài khoản nhân sự mới
  // -------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử Tạo mới tài khoản nhân sự (POST /api/users) ---');

  const newAccount = await usersService.create({
    fullName: 'Lê Minh Kế Toán',
    username: 'minhle_acc',
    email: 'minhle.acc@loha.vn',
    phone: '0977112233',
    role: UserRole.ACCOUNTANT,
  });

  assert(newAccount.user.username === 'minhle_acc', 'Tạo tài khoản mới thành công');
  assert(newAccount.user.role === UserRole.ACCOUNTANT, 'Gán đúng vai trò Kế toán');
  assert(Boolean(newAccount.temporaryPassword), 'Tự động sinh mật khẩu tạm thời an toàn khi không nhập');

  // Đăng nhập thử bằng tài khoản vừa tạo với mật khẩu tạm
  const newLogin = await authService.login({
    username: 'minhle_acc',
    password: newAccount.temporaryPassword!,
  });
  assert(Boolean(newLogin.accessToken), 'Đăng nhập thành công với tài khoản và mật khẩu tạm vừa tạo');

  // -------------------------------------------------------------
  // Phần 5: Khóa tài khoản & Thu hồi phiên đăng nhập (Revocation)
  // -------------------------------------------------------------
  console.log('\n--- 5. Kiểm thử Khóa tài khoản & Thu hồi Session ---');

  // Kiểm tra Admin KHÔNG THỂ tự khóa tài khoản của chính mình
  try {
    await usersService.updateStatus(adminLogin.user.id, {
      status: UserStatus.LOCKED,
      reason: 'Tự khóa',
    }, { userId: adminLogin.user.id, email: adminLogin.user.email, username: adminLogin.user.username });
    assert(false, 'Admin tự khóa mình phải bị từ chối');
  } catch (err: any) {
    assert(err.message.includes('không thể tự khóa tài khoản'), 'Chặn thành công Admin tự khóa tài khoản của chính mình');
  }

  const lockRes = await usersService.updateStatus(newAccount.user.id, {
    status: UserStatus.LOCKED,
    reason: 'Tạm đình chỉ công tác để kiểm tra công nợ',
  }, adminLogin.user.id);

  assert(lockRes.status === UserStatus.LOCKED, 'Trạng thái tài khoản chuyển sang LOCKED');
  assert(lockRes.lockReason === 'Tạm đình chỉ công tác để kiểm tra công nợ', 'Ghi nhận lý do khóa tài khoản chính xác');

  // Kiểm tra JwtStrategy: Khi user bị LOCKED, validate token phải ném UnauthorizedException ngay lập tức
  const { JwtStrategy } = await import('../src/modules/auth/strategies/jwt.strategy');
  const jwtStrategy = new JwtStrategy(usersService);
  try {
    await jwtStrategy.validate({
      sub: newAccount.user.id,
      email: newAccount.user.email,
      roles: [UserRole.ACCOUNTANT],
      username: newAccount.user.username,
    });
    assert(false, 'JwtStrategy phải từ chối ngay lập tức khi user bị LOCKED');
  } catch (err: any) {
    assert(
      err.message.includes('Tài khoản của bạn đã bị khóa bởi Quản trị viên'),
      'JwtStrategy chặn và thông báo lý do khóa tài khoản ngay lập tức khi bị khóa',
    );
  }

  // Mở khóa tài khoản
  const unlockRes = await usersService.updateStatus(newAccount.user.id, {
    status: UserStatus.ACTIVE,
    reason: 'Đã hoàn tất đối chiếu công nợ',
  }, adminLogin.user.id);
  assert(unlockRes.status === UserStatus.ACTIVE, 'Mở khóa tài khoản thành công về trạng thái ACTIVE');

  // -------------------------------------------------------------
  // Phần 6: Admin cấp mã đặt lại mật khẩu cho nhân sự (SN-10 Extension)
  // -------------------------------------------------------------
  console.log('\n--- 6. Kiểm thử Cấp mã đổi mật khẩu cho nhân sự ---');

  // 1. Admin cấp mã cho nhân sự
  const codeRes = await usersService.generateResetCode(newAccount.user.id);
  assert(Boolean(codeRes.resetCode) && codeRes.resetCode.startsWith('LH-'), 'Admin cấp mã đổi mật khẩu thành công với tiền tố LH-');
  assert(codeRes.user.resetCode === codeRes.resetCode, 'Mã cấp được lưu trữ và hiển thị trên tài khoản');

  // 2. Kiểm tra mã vẫn hiển thị khi lấy lại thông tin user (chưa sử dụng)
  const userCheck1 = await usersService.findById(newAccount.user.id);
  assert(userCheck1?.resetCode === codeRes.resetCode, 'Mã cấp tiếp tục hiển thị chừng nào nhân sự chưa đổi mật khẩu');

  // 3. Nhân sự nhập sai mã -> Báo lỗi
  try {
    await authService.resetPasswordWithCode({
      identifier: 'minhle_acc',
      resetCode: 'LH-000000',
      newPassword: 'NewPassword123',
    });
    assert(false, 'Nhập sai mã cấp phải bị từ chối');
  } catch (err: any) {
    assert(err.message.includes('Mã cấp đổi mật khẩu không chính xác'), 'Từ chối mã cấp không chính xác');
  }

  // 4. Nhân sự nhập đúng mã -> Đổi mật khẩu thành công
  const resetSuccess = await authService.resetPasswordWithCode({
    identifier: 'minhle_acc',
    resetCode: codeRes.resetCode,
    newPassword: 'NewPassword123',
  });
  assert(resetSuccess.success === true, 'Nhân sự đổi mật khẩu thành công bằng mã được Admin cấp');

  // 5. Kiểm tra mã ĐÃ BỊ XÓA sau khi đổi thành công (không còn hiển thị)
  const userCheck2 = await usersService.findById(newAccount.user.id);
  assert(userCheck2?.resetCode === null, 'Mã cấp tự động biến mất sau khi nhân sự đã đổi mật khẩu thành công');

  // 6. Đăng nhập thử với mật khẩu mới
  const loginWithNewPass = await authService.login({
    username: 'minhle_acc',
    password: 'NewPassword123',
  });
  assert(Boolean(loginWithNewPass.accessToken), 'Đăng nhập thành công với mật khẩu mới vừa đổi');

  console.log('\n=============================================================');
  console.log(`TỔNG KẾT KIỂM THỬ USER MANAGEMENT: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('=============================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi thực thi test:', err);
  process.exit(1);
});
