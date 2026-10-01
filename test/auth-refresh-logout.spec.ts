import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { jwtConfig } from '../src/config/jwt.config';
import { UserRole } from '../src/common/enums/user-role.enum';
import { IJwtPayload } from '../src/modules/auth/interfaces/jwt-payload.interface';

async function runTests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ TÍCH HỢP SN-112: REFRESH TOKEN & LOGOUT BLACKLIST ===\n');
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

  const authService = new AuthService(jwtService);
  const jwtStrategy = new JwtStrategy();
  const reflector = new Reflector();
  const jwtAuthGuard = new JwtAuthGuard(reflector);

  // -------------------------------------------------------------
  // Test 1: JwtStrategy validation
  // -------------------------------------------------------------
  console.log('--- 1. Kiểm thử JwtStrategy ---');
  try {
    const validPayload: IJwtPayload = {
      sub: 'usr-admin-001',
      email: 'admin@loha.vn',
      roles: [UserRole.ADMIN],
      username: 'admin',
    };
    const userResult = await jwtStrategy.validate(validPayload);
    assert(
      userResult.userId === 'usr-admin-001' && userResult.roles.includes(UserRole.ADMIN),
      'JwtStrategy trích xuất chính xác userId và roles từ payload hợp lệ',
    );
  } catch (e) {
    assert(false, `JwtStrategy thất bại khi validate payload hợp lệ: ${e}`);
  }

  try {
    // @ts-expect-error test invalid payload
    await jwtStrategy.validate({ sub: '', roles: [] });
    assert(false, 'JwtStrategy phải ném ngoại lệ khi thiếu sub');
  } catch (e) {
    assert(
      e instanceof UnauthorizedException,
      'JwtStrategy ném UnauthorizedException khi payload không hợp lệ',
    );
  }

  // -------------------------------------------------------------
  // Test 2: Đăng nhập cấp phát Access Token & Refresh Token
  // -------------------------------------------------------------
  console.log('\n--- 2. Kiểm thử API Đăng nhập (AuthService.login) ---');
  let initialRefreshToken = '';
  let initialAccessToken = '';
  try {
    const loginResult = await authService.login({
      username: 'admin@loha.vn',
      password: '123456',
    });
    initialAccessToken = loginResult.accessToken;
    initialRefreshToken = loginResult.refreshToken ?? '';
    assert(
      Boolean(initialAccessToken) && Boolean(initialRefreshToken),
      'Đăng nhập thành công trả về cả accessToken và refreshToken',
    );
    assert(
      loginResult.user.email === 'admin@loha.vn' && loginResult.tokenType === 'Bearer',
      'Thông tin user và tokenType: Bearer chính xác',
    );
  } catch (e) {
    assert(false, `Đăng nhập thất bại: ${e}`);
  }

  // -------------------------------------------------------------
  // Test 3: API Refresh Token & Rotation
  // -------------------------------------------------------------
  console.log('\n--- 3. Kiểm thử API Refresh Token & Rotation (AuthService.refreshTokens) ---');
  let rotatedRefreshToken = '';
  try {
    const refreshResult = await authService.refreshTokens({
      refreshToken: initialRefreshToken,
    });
    rotatedRefreshToken = refreshResult.refreshToken ?? '';
    assert(
      Boolean(refreshResult.accessToken) && Boolean(rotatedRefreshToken),
      'Refresh Token thành công trả về Access Token mới và Refresh Token mới (Rotation)',
    );
    assert(
      rotatedRefreshToken !== initialRefreshToken,
      'Refresh Token mới khác với Refresh Token cũ (Token Rotation ngăn chặn Replay Attack)',
    );
  } catch (e) {
    assert(false, `Refresh Token thất bại: ${e}`);
  }

  // Test 3.1: Token Rotation Replay Prevention - Token cũ phải bị thu hồi ngay lập tức
  try {
    await authService.refreshTokens({
      refreshToken: initialRefreshToken,
    });
    assert(false, 'Dùng lại Refresh Token cũ phải bị chặn');
  } catch (e) {
    assert(
      e instanceof UnauthorizedException,
      'Refresh Token cũ đã bị thu hồi: Hệ thống chặn và trả về UnauthorizedException',
    );
  }

  // Test 3.2: Refresh Token không hợp lệ / giả mạo
  try {
    await authService.refreshTokens({
      refreshToken: 'token-gia-mao-tam-tam-khong-dung-chu-ky',
    });
    assert(false, 'Token giả mạo phải bị chặn');
  } catch (e) {
    assert(
      e instanceof UnauthorizedException,
      'Token giả mạo bị từ chối với UnauthorizedException (401)',
    );
  }

  // -------------------------------------------------------------
  // Test 4: API Logout & Revoke Session / Blacklist
  // -------------------------------------------------------------
  console.log('\n--- 4. Kiểm thử API Logout & Thu hồi Session (AuthService.logout) ---');
  try {
    const logoutResult = await authService.logout(
      {
        userId: 'usr-admin-001',
        email: 'admin@loha.vn',
        roles: [UserRole.ADMIN],
      },
      {
        refreshToken: rotatedRefreshToken,
      },
    );
    assert(
      logoutResult.success === true && logoutResult.message === 'Đăng xuất thành công',
      'Đăng xuất thành công trả về message thông báo chuẩn',
    );
    assert(
      authService.isTokenRevoked(rotatedRefreshToken) === true,
      'Refresh Token được đưa vào danh sách Blacklist và đánh dấu isRevoked: true',
    );
  } catch (e) {
    assert(false, `Logout thất bại: ${e}`);
  }

  // Test 4.1: Thử dùng lại Refresh Token sau khi đã Logout
  try {
    await authService.refreshTokens({
      refreshToken: rotatedRefreshToken,
    });
    assert(false, 'Token đã logout không được phép làm mới');
  } catch (e) {
    assert(
      e instanceof UnauthorizedException,
      'Cố tình refresh bằng token đã logout bị từ chối với 401 Unauthorized (Blacklisted)',
    );
  }

  // -------------------------------------------------------------
  // Test 5: JwtAuthGuard handleRequest
  // -------------------------------------------------------------
  console.log('\n--- 5. Kiểm thử JwtAuthGuard handleRequest ---');
  try {
    const mockUser = {
      userId: 'usr-admin-001',
      email: 'admin@loha.vn',
      roles: [UserRole.ADMIN],
    };
    const handledUser = jwtAuthGuard.handleRequest(null, mockUser);
    assert(handledUser.userId === 'usr-admin-001', 'JwtAuthGuard trả về user khi hợp lệ');
  } catch (e) {
    assert(false, `JwtAuthGuard handleRequest lỗi: ${e}`);
  }

  try {
    jwtAuthGuard.handleRequest(new Error('Token expired'), null);
    assert(false, 'JwtAuthGuard phải ném ngoại lệ khi có lỗi xác thực');
  } catch (e) {
    assert(
      e instanceof UnauthorizedException,
      'JwtAuthGuard ném UnauthorizedException khi xác thực thất bại',
    );
  }

  console.log(`\n=============================================================`);
  console.log(`TỔNG KẾT KIỂM THỬ: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`=============================================================`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Lỗi thực thi kiểm thử:', err);
  process.exit(1);
});
