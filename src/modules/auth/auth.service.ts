import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  AUTH_ERROR_MESSAGES,
  LOCK_TIME_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from '../../common/constants/auth.constant';
import { UserStatus } from '../../common/enums/user-status.enum';
import { jwtConfig } from '../../config/jwt.config';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { LoginResponseDto, SafeUser } from './dto/login-response.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

// Dummy hash để chống timing attacks khi email không tồn tại
const DUMMY_HASH = '$2b$10$Ep9Wv7.Xp3JmP0g1o5m.I.2p9n7j3x9kF8abc1234567890123456';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Xử lý xác thực đăng nhập người dùng, kiểm tra khóa tạm thời và phát hành JWT token
   * @param loginDto DTO chứa thông tin email/username và mật khẩu
   * @returns LoginResponseDto chứa access_token, refresh_token và thông tin user an toàn
   */
  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const identifier = loginDto.email || loginDto.username || '';
    const user = await this.usersService.findByEmailOrUsername(identifier);

    // Xử lý khi tài khoản không tồn tại (chống User Enumeration & Timing Attacks)
    if (!user) {
      await bcrypt.compare(loginDto.password, DUMMY_HASH).catch(() => false);
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Bước 1: Kiểm tra khóa tạm thời (Locked Until)
    const now = new Date();
    if (user.lockedUntil) {
      if (user.lockedUntil > now) {
        throw new UnauthorizedException(
          AUTH_ERROR_MESSAGES.ACCOUNT_TEMPORARILY_LOCKED,
        );
      }
      // Hết thời gian khóa 15 phút, tự động reset trạng thái
      await this.usersService.resetFailedAttempts(user.id);
      user.failedAttempts = 0;
      user.lockedUntil = null;
    }

    // Kiểm tra trạng thái tài khoản kích hoạt
    if (user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }

    // Bước 2 & 3: Xác thực mật khẩu và xử lý khi nhập sai
    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      const nextFailedAttempts = user.failedAttempts + 1;
      const isLockTriggered = nextFailedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      const newLockedUntil = isLockTriggered
        ? new Date(Date.now() + LOCK_TIME_MS)
        : null;

      await this.usersService.updateFailedAttempts(
        user.id,
        nextFailedAttempts,
        newLockedUntil,
      );

      if (isLockTriggered) {
        throw new UnauthorizedException(
          AUTH_ERROR_MESSAGES.ACCOUNT_TEMPORARILY_LOCKED,
        );
      }

      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Bước 4: Xử lý khi đăng nhập thành công
    await this.usersService.resetFailedAttempts(user.id);

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: jwtConfig.secret,
      expiresIn: jwtConfig.expiresIn,
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: jwtConfig.refreshSecret,
        expiresIn: jwtConfig.refreshExpiresIn,
      },
    );

    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
    };

    return new LoginResponseDto({
      accessToken,
      refreshToken,
      user: safeUser,
    });
  }
}
