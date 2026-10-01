import { JwtService } from '@nestjs/jwt';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { UsersService } from '../src/modules/users/users.service';
import { jwtConfig } from '../src/config/jwt.config';

async function runTests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-8: QUÊN VÀ ĐẶT LẠI MẬT KHẨU QUA EMAIL ===\n');
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
  const authService = new AuthService(usersService, jwtService);

  // -------------------------------------------------------------
  // Test 1: Kiểm thử kiểm tra tài khoản tồn tại
  // -------------------------------------------------------------
  console.log('--- 1. Kiểm thử Kiểm tra tài khoản tồn tại ---');
  try {
    const resExisting = await authService.forgotPassword({ email: 'admin@loha.vn' });
    assert(
      resExisting.message.includes('liên kết đặt lại mật khẩu'),
      'Email tồn tại nhận thông điệp tiếp nhận thành công',
    );
  } catch (e) {
    assert(false, `Lỗi khi gửi với email tồn tại: ${e}`);
  }

  try {
    await authService.forgotPassword({ email: 'nonexistent-user-12345@gmail.com' });
    assert(false, 'Email không tồn tại phải ném lỗi NotFoundException');
  } catch (e: any) {
    assert(
      e?.message?.includes('chưa được đăng ký') || e?.status === 404,
      'Email không tồn tại báo lỗi rõ ràng cho người dùng',
    );
  }

  // -------------------------------------------------------------
  // Test 2: Tạo token và Reset mật khẩu thành công
  // -------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử Tạo Token & Reset Mật Khẩu Thành Công ---');
  let validToken = '';
  try {
    await authService.forgotPassword({ email: 'admin@loha.vn' });

    const tokenStore = (authService as any).resetPasswordTokens as Map<string, any>;
    for (const [t, data] of tokenStore.entries()) {
      if (data.email === 'admin@loha.vn' && !data.isUsed) {
        validToken = t;
      }
    }

    assert(validToken.length > 20, 'Sinh mã Token reset bảo mật an toàn thành công (độ dài > 20 ký tự)');

    const resetResult = await authService.resetPassword({
      token: validToken,
      newPassword: 'NewAdminPassword@2026',
    });

    assert(resetResult.success === true, 'Đổi mật khẩu thành công với token hợp lệ');
  } catch (e) {
    assert(false, `Lỗi khi reset mật khẩu với token hợp lệ: ${e}`);
  }

  // -------------------------------------------------------------
  // Test 3: Single-use check (Liên kết chỉ dùng được 1 lần)
  // -------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử Single-use (Liên kết chỉ dùng được 1 lần) ---');
  try {
    await authService.resetPassword({
      token: validToken,
      newPassword: 'AnotherPassword@2026',
    });
    assert(false, 'Token đã sử dụng không được phép tái sử dụng');
  } catch (e) {
    assert(
      e instanceof BadRequestException && (e.message.includes('đã được sử dụng') || e.message.includes('không hợp lệ')),
      'Hệ thống từ chối tái sử dụng token đã dùng (Single-use enforcement)',
    );
  }

  // -------------------------------------------------------------
  // Test 4: Hết hạn sau 30 phút
  // -------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử Hết Hạn Sau 30 Phút ---');
  try {
    const expiredToken = 'expired-test-token-' + Date.now();
    const tokenStore = (authService as any).resetPasswordTokens as Map<string, any>;
    tokenStore.set(expiredToken, {
      token: expiredToken,
      userId: 'usr-admin-001',
      email: 'admin@loha.vn',
      expiresAt: new Date(Date.now() - 60000),
      isUsed: false,
      createdAt: new Date(Date.now() - 31 * 60000),
    });

    await authService.resetPassword({
      token: expiredToken,
      newPassword: 'SomePassword@2026',
    });
    assert(false, 'Token hết hạn không được phép reset');
  } catch (e) {
    assert(
      e instanceof BadRequestException && e.message.includes('hết hạn'),
      'Hệ thống từ chối token đã hết hạn 30 phút',
    );
  }

  // -------------------------------------------------------------
  // Test 5: Token không tồn tại
  // -------------------------------------------------------------
  console.log('\n--- 5. Kiểm thử Token Không Tồn Tại ---');
  try {
    await authService.resetPassword({
      token: 'completely-invalid-token',
      newPassword: 'SomePassword@2026',
    });
    assert(false, 'Token rác không được chấp nhận');
  } catch (e) {
    assert(
      e instanceof BadRequestException && e.message.includes('không hợp lệ'),
      'Hệ thống trả về BadRequestException cho token rác',
    );
  }

  console.log('\n=============================================================');
  console.log(`TỔNG KẾT KIỂM THỬ SN-8: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('=============================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi thực thi test:', err);
  process.exit(1);
});
