import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { jwtConfig } from '../../config/jwt.config';
import { UserRole } from '../../common/enums/user-role.enum';
import { AUTH_CONSTANTS } from './constants/auth.constant';
import { IJwtPayload } from './interfaces/jwt-payload.interface';
import { ICurrentUser } from './interfaces/current-user.interface';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import {
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
  TokenResponseDto,
  LoginResponseDto,
  LogoutResponseDto,
  IAuthUserInfo,
} from './dto';

// Danh sách tài khoản demo khởi tạo tương ứng 7 vai trò hệ thống (Mật khẩu chuẩn: 123456)
const MOCK_SYSTEM_ACCOUNTS: Record<string, { id: string; username: string; fullName: string; email: string; roles: UserRole[]; passwordHash: string }> = {
  'admin@loha.vn': {
    id: 'usr-admin-001',
    username: 'admin',
    fullName: 'Nguyễn Văn Admin (Quản Trị Viên)',
    email: 'admin@loha.vn',
    roles: [UserRole.ADMIN],
    passwordHash: '123456',
  },
  'sales@loha.vn': {
    id: 'usr-sales-002',
    username: 'sales',
    fullName: 'Trần Văn Nam (Nhân Viên Kinh Doanh)',
    email: 'sales@loha.vn',
    roles: [UserRole.SALES_REP],
    passwordHash: '123456',
  },
  'salesmanager@loha.vn': {
    id: 'usr-mgr-003',
    username: 'salesmanager',
    fullName: 'Lê Hoàng Trưởng Phòng (Quản Lý Kinh Doanh)',
    email: 'salesmanager@loha.vn',
    roles: [UserRole.SALES_MANAGER],
    passwordHash: '123456',
  },
  'warehouse@loha.vn': {
    id: 'usr-wh-004',
    username: 'warehouse',
    fullName: 'Phạm Hùng Kho (Thủ Kho)',
    email: 'warehouse@loha.vn',
    roles: [UserRole.WAREHOUSE_KEEPER],
    passwordHash: '123456',
  },
  'warehousemanager@loha.vn': {
    id: 'usr-whm-005',
    username: 'warehousemanager',
    fullName: 'Đỗ Quốc Bảo (Quản Lý Kho)',
    email: 'warehousemanager@loha.vn',
    roles: [UserRole.WAREHOUSE_MANAGER],
    passwordHash: '123456',
  },
  'accountant@loha.vn': {
    id: 'usr-acc-006',
    username: 'accountant',
    fullName: 'Vũ Mai Hoa (Kế Toán Công Nợ)',
    email: 'accountant@loha.vn',
    roles: [UserRole.ACCOUNTANT],
    passwordHash: '123456',
  },
  'dealer@loha.vn': {
    id: 'usr-cust-007',
    username: 'dealer',
    fullName: 'Đại Lý Cửa Hàng Minh Khang (B2B)',
    email: 'dealer@loha.vn',
    roles: [UserRole.CUSTOMER],
    passwordHash: '123456',
  },
};

@Injectable()
export class AuthService {
  /**
   * Bộ nhớ lưu trữ phiên và danh sách Blacklist/Revoked Tokens
   * Map token string -> RefreshTokenEntity
   */
  private readonly tokenSessionStore = new Map<string, RefreshTokenEntity>();

  /**
   * Set chứa token đã bị đưa vào Blacklist để tra cứu nhanh O(1)
   */
  private readonly blacklistedTokens = new Set<string>();

  constructor(private readonly jwtService: JwtService) {}

  /**
   * Đăng nhập người dùng và cấp phát cặp Access Token & Refresh Token
   */
  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const identifier = loginDto.username.trim().toLowerCase();
    const account = Object.values(MOCK_SYSTEM_ACCOUNTS).find(
      (acc) => acc.email.toLowerCase() === identifier || acc.username.toLowerCase() === identifier,
    );

    if (!account || account.passwordHash !== loginDto.password) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không chính xác');
    }

    const userInfo: IAuthUserInfo = {
      id: account.id,
      username: account.username,
      fullName: account.fullName,
      email: account.email,
      roles: account.roles,
    };

    const tokens = await this.generateTokens(userInfo);

    return {
      ...tokens,
      user: userInfo,
    };
  }

  /**
   * Cấp lại Access Token mới dựa trên Refresh Token hợp lệ (Áp dụng Refresh Token Rotation)
   */
  async refreshTokens(dto: RefreshTokenDto): Promise<TokenResponseDto> {
    const rawToken = dto.refreshToken?.trim();

    if (!rawToken) {
      throw new BadRequestException('Refresh token không được để trống');
    }

    // 1. Kiểm tra Blacklist tức thì
    if (this.blacklistedTokens.has(rawToken)) {
      throw new UnauthorizedException(AUTH_CONSTANTS.REVOKED_REFRESH_TOKEN_MESSAGE);
    }

    // 2. Kiểm tra trạng thái trong Token Session Store nếu có ghi nhận
    const existingSession = this.tokenSessionStore.get(rawToken);
    if (existingSession && existingSession.isRevoked) {
      throw new UnauthorizedException(AUTH_CONSTANTS.REVOKED_REFRESH_TOKEN_MESSAGE);
    }

    // 3. Giải mã và kiểm tra tính toàn vẹn của Refresh Token bằng Secret riêng
    let payload: IJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<IJwtPayload>(rawToken, {
        secret: jwtConfig.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException(AUTH_CONSTANTS.INVALID_REFRESH_TOKEN_MESSAGE);
    }

    if (!payload || !payload.sub) {
      throw new UnauthorizedException(AUTH_CONSTANTS.INVALID_REFRESH_TOKEN_MESSAGE);
    }

    // 4. Tìm kiếm thông tin người dùng từ payload
    const userAccount = Object.values(MOCK_SYSTEM_ACCOUNTS).find((acc) => acc.id === payload.sub);
    const userInfo: IAuthUserInfo = userAccount
      ? {
          id: userAccount.id,
          username: userAccount.username,
          fullName: userAccount.fullName,
          email: userAccount.email,
          roles: userAccount.roles,
        }
      : {
          id: payload.sub,
          username: payload.username ?? '',
          fullName: payload.username ?? '',
          email: payload.email,
          roles: payload.roles,
        };

    // 5. Cơ chế Refresh Token Rotation: Thu hồi token cũ để chống tấn công Replay Attack
    this.revokeTokenRecord(rawToken);

    // 6. Phát hành cặp token mới
    return this.generateTokens(userInfo);
  }

  /**
   * Đăng xuất người dùng: Thu hồi Refresh Token và ghi nhận vào Blacklist
   */
  async logout(
    currentUser?: ICurrentUser,
    logoutDto?: LogoutDto,
  ): Promise<LogoutResponseDto> {
    const refreshToken = logoutDto?.refreshToken?.trim();

    if (refreshToken) {
      this.revokeTokenRecord(refreshToken);
    }

    // Nếu có thông tin người dùng từ Access Token, thu hồi toàn bộ session đang mở của user đó
    if (currentUser?.userId) {
      this.revokeAllSessionsByUserId(currentUser.userId);
    }

    return {
      success: true,
      message: AUTH_CONSTANTS.LOGOUT_SUCCESS_MESSAGE,
    };
  }

  /**
   * Tạo Access Token & Refresh Token, đồng thời lưu trữ phiên hoạt động
   */
  private async generateTokens(user: IAuthUserInfo): Promise<TokenResponseDto> {
    const basePayload: Omit<IJwtPayload, 'jti'> = {
      sub: user.id,
      email: user.email,
      roles: user.roles as UserRole[],
      username: user.username,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...basePayload, jti: `at-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` },
        {
          secret: jwtConfig.secret,
          expiresIn: jwtConfig.expiresIn,
        },
      ),
      this.jwtService.signAsync(
        { ...basePayload, jti: `rt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` },
        {
          secret: jwtConfig.refreshSecret,
          expiresIn: jwtConfig.refreshExpiresIn,
        },
      ),
    ]);

    // Ghi nhận phiên Refresh Token vào session store
    const sessionRecord = new RefreshTokenEntity({
      id: `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      userId: user.id,
      token: refreshToken,
      isRevoked: false,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 ngày
    });

    this.tokenSessionStore.set(refreshToken, sessionRecord);

    return {
      accessToken,
      tokenType: AUTH_CONSTANTS.TOKEN_TYPE,
      expiresIn: String(jwtConfig.expiresIn),
      refreshToken,
    };
  }

  /**
   * Đưa token vào Blacklist và đánh dấu đã thu hồi (isRevoked = true)
   */
  private revokeTokenRecord(token: string): void {
    this.blacklistedTokens.add(token);

    const session = this.tokenSessionStore.get(token);
    if (session) {
      session.isRevoked = true;
      session.revokedAt = new Date();
    }
  }

  /**
   * Thu hồi toàn bộ Refresh Token của một người dùng cụ thể
   */
  private revokeAllSessionsByUserId(userId: string): void {
    for (const [token, session] of this.tokenSessionStore.entries()) {
      if (session.userId === userId && !session.isRevoked) {
        this.revokeTokenRecord(token);
      }
    }
  }

  /**
   * Kiểm tra xem một Refresh Token có bị Blacklist hay không (phục vụ Unit Test / External Call)
   */
  isTokenRevoked(token: string): boolean {
    if (this.blacklistedTokens.has(token)) {
      return true;
    }
    const session = this.tokenSessionStore.get(token);
    return session ? session.isRevoked : false;
  }
}
