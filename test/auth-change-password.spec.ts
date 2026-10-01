import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersService } from '../src/modules/users/users.service';
import { MailService } from '../src/modules/mail/mail.service';
import { jwtConfig } from '../src/config/jwt.config';

async function runTests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-9: ĐỔI MẬT KHẨU KHI ĐANG ĐĂNG NHẬP & SESSION REVOCATION ===\n');
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

  const jwtService = new JwtService({
    secret: jwtConfig.secret,
    signOptions: { expiresIn: jwtConfig.expiresIn },
  });

  const usersService = new UsersService();
  const mailService = new MailService();
  const authService = new AuthService(usersService, jwtService, mailService);

  // -------------------------------------------------------------
  // Chuẩn bị: Đăng nhập tài khoản admin để tạo session
  // -------------------------------------------------------------
  console.log('--- 1. Chuẩn bị: Đăng nhập lấy Token và Session ---');
  let loginRes = await authService.login({
    username: 'admin',
    password: '123456',
  });
  const userId = loginRes.user.id;
  const oldRefreshToken = loginRes.refreshToken || loginRes.refresh_token || '';

  assert(Boolean(loginRes.accessToken && oldRefreshToken), 'Đăng nhập thành công và cấp Access/Refresh Token');

  // -------------------------------------------------------------
  // Test 1: Mật khẩu hiện tại sai
  // -------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử Mật khẩu hiện tại không chính xác ---');
  try {
    await authService.changePassword(userId, {
      currentPassword: 'WRONG_PASSWORD_123',
      newPassword: 'NewSecurePassword@2026',
    });
    assert(false, 'Hệ thống phải từ chối khi mật khẩu hiện tại sai');
  } catch (e: any) {
    assert(
      e instanceof UnauthorizedException && e.message.includes('Mật khẩu hiện tại không chính xác'),
      'Từ chối và ném UnauthorizedException khi mật khẩu hiện tại sai',
    );
  }

  // -------------------------------------------------------------
  // Test 2: Mật khẩu mới trùng mật khẩu cũ
  // -------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử Mật khẩu mới trùng mật khẩu hiện tại ---');
  try {
    await authService.changePassword(userId, {
      currentPassword: '123456',
      newPassword: '123456',
    });
    assert(false, 'Hệ thống phải chặn mật khẩu mới trùng mật khẩu cũ');
  } catch (e: any) {
    assert(
      e instanceof BadRequestException && e.message.includes('không được trùng'),
      'Từ chối khi mật khẩu mới trùng với mật khẩu cũ',
    );
  }

  // -------------------------------------------------------------
  // Test 3: Mật khẩu mới không đủ độ mạnh
  // -------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử Độ mạnh mật khẩu mới (< 8 ký tự hoặc thiếu số/chữ) ---');
  try {
    await authService.changePassword(userId, {
      currentPassword: '123456',
      newPassword: 'short',
    });
    assert(false, 'Hệ thống phải chặn mật khẩu dưới 8 ký tự');
  } catch (e: any) {
    assert(
      e instanceof BadRequestException,
      'Từ chối mật khẩu không thỏa mãn tiêu chuẩn độ mạnh',
    );
  }

  // -------------------------------------------------------------
  // Test 4: Đổi mật khẩu thành công
  // -------------------------------------------------------------
  console.log('\n--- 5. Kiểm thử Đổi mật khẩu thành công ---');
  const NEW_PASSWORD = 'AdminSecurePass@2026';
  try {
    const changeRes = await authService.changePassword(userId, {
      currentPassword: '123456',
      newPassword: NEW_PASSWORD,
    });
    assert(changeRes.success === true, 'Đổi mật khẩu thành công trả về success: true');
  } catch (e) {
    assert(false, `Lỗi khi đổi mật khẩu hợp lệ: ${e}`);
  }

  // -------------------------------------------------------------
  // Test 5: Session Revocation (Thu hồi toàn bộ Refresh Token cũ)
  // -------------------------------------------------------------
  console.log('\n--- 6. Kiểm thử Session Revocation (Toàn bộ Refresh Token cũ bị thu hồi) ---');
  try {
    await authService.refreshTokens({ refreshToken: oldRefreshToken });
    assert(false, 'Refresh token cũ phải bị từ chối sau khi đổi mật khẩu');
  } catch (e: any) {
    assert(
      e instanceof UnauthorizedException,
      'Toàn bộ phiên cũ bị thu hồi thành công (Revocation enforced)',
    );
  }

  // -------------------------------------------------------------
  // Test 6: Đăng nhập lại với mật khẩu cũ -> Thất bại
  // -------------------------------------------------------------
  console.log('\n--- 7. Kiểm thử Đăng nhập lại với mật khẩu cũ ---');
  try {
    await authService.login({
      username: 'admin',
      password: '123456',
    });
    assert(false, 'Mật khẩu cũ không được phép đăng nhập nữa');
  } catch (e: any) {
    assert(
      e instanceof UnauthorizedException,
      'Mật khẩu cũ bị từ chối chính xác',
    );
  }

  // -------------------------------------------------------------
  // Test 7: Đăng nhập lại với mật khẩu mới -> Thành công
  // -------------------------------------------------------------
  console.log('\n--- 8. Kiểm thử Đăng nhập lại với mật khẩu mới ---');
  try {
    const reLoginRes = await authService.login({
      username: 'admin',
      password: NEW_PASSWORD,
    });
    assert(
      Boolean(reLoginRes.accessToken && reLoginRes.refreshToken),
      'Đăng nhập lại thành công rực rỡ với mật khẩu mới',
    );
  } catch (e) {
    assert(false, `Không thể đăng nhập với mật khẩu mới: ${e}`);
  }

  console.log('\n=============================================================');
  console.log(`TỔNG KẾT KIỂM THỬ SN-9: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('=============================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi thực thi test:', err);
  process.exit(1);
});
