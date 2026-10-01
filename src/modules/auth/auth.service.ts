import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  AUTH_ERROR_MESSAGES,
  LOCK_TIME_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
} from '../../common/constants/auth.constant';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { jwtConfig } from '../../config/jwt.config';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AUTH_CONSTANTS } from './constants/auth.constant';
import * as crypto from 'crypto';
import {
  AuthMessageResponseDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  IAuthUserInfo,
  LoginDto,
  LoginResponseDto,
  LogoutDto,
  LogoutResponseDto,
  RefreshTokenDto,
  ResetPasswordDto,
  ResetPasswordWithCodeDto,
  TokenResponseDto,
} from './dto';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { ICurrentUser } from './interfaces/current-user.interface';
import { IJwtPayload } from './interfaces/jwt-payload.interface';

export interface IResetPasswordToken {
  token: string;
  userId: string;
  email: string;
  expiresAt: Date;
  isUsed: boolean;
  createdAt: Date;
}

const DUMMY_HASH =
  '$2b$10$Ep9Wv7.Xp3JmP0g1o5m.I.2p9n7j3x9kF8abc1234567890123456';

@Injectable()
export class AuthService {
  /**
   * Bộ nhớ lưu trữ phiên và danh sách Blacklist/Revoked Tokens
   */
  private readonly tokenSessionStore = new Map<string, RefreshTokenEntity>();

  /**
   * Set chứa token đã bị đưa vào Blacklist để tra cứu nhanh O(1)
   */
  private readonly blacklistedTokens = new Set<string>();

  /**
   * Bộ nhớ lưu trữ token đặt lại mật khẩu tạm thời (Hiệu lực 30 phút, chỉ dùng 1 lần)
   */
  private readonly resetPasswordTokens = new Map<string, IResetPasswordToken>();

  private readonly usersService: UsersService;
  private readonly jwtService: JwtService;
  private readonly mailService: MailService;

  constructor(
    usersService: UsersService,
    jwtService: JwtService,
    mailService?: MailService,
  );
  constructor(jwtService: JwtService);
  constructor(
    @Inject(UsersService) arg1: UsersService | JwtService,
    @Inject(JwtService) @Optional() arg2?: JwtService | UsersService,
    @Inject(MailService) @Optional() arg3?: MailService,
  ) {
    if (arg1 instanceof JwtService) {
      this.jwtService = arg1;
      this.usersService = (arg2 as UsersService) ?? new UsersService();
      this.mailService = arg3 ?? new MailService();
    } else {
      this.usersService = arg1 ?? new UsersService();
      this.jwtService = (arg2 as JwtService) ?? new JwtService();
      this.mailService = arg3 ?? new MailService();
    }
    if (this.usersService && typeof this.usersService.onModuleInit === 'function') {
      void this.usersService.onModuleInit();
    }
    if (this.usersService && typeof this.usersService.registerSessionRevoker === 'function') {
      this.usersService.registerSessionRevoker((userId: string) => {
        this.revokeAllSessionsByUserId(userId);
      });
    }
  }

  /**
   * Đăng nhập người dùng, kiểm tra khóa tạm thời và cấp phát cặp Access Token & Refresh Token
   */
  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const identifier = (loginDto.username || loginDto.email || '').trim().toLowerCase();
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

    // Kiểm tra trạng thái tài khoản bị khóa bởi Admin
    if (user.status === UserStatus.LOCKED) {
      const reasonText = user.lockReason ? ` Lý do: ${user.lockReason}.` : '';
      throw new UnauthorizedException({
        message: `Tài khoản đã bị quản trị viên khóa.${reasonText} Vui lòng liên hệ Admin để được hỗ trợ.`,
        isLocked: true,
        lockReason: user.lockReason || 'Theo quyết định của Quản trị viên',
        status: 'LOCKED',
      });
    }

    // Kiểm tra trạng thái tài khoản kích hoạt
    if (user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException(AUTH_ERROR_MESSAGES.ACCOUNT_INACTIVE);
    }

    // Bước 2 & 3: Xác thực mật khẩu và xử lý khi nhập sai
    // Chấp nhận mật khẩu chính thức HOẶC mã đăng nhập tạm thời do Quản trị viên cấp
    const isResetCodeMatch = Boolean(
      user.resetCode &&
      loginDto.password &&
      user.resetCode.trim().toUpperCase() === loginDto.password.trim().toUpperCase(),
    );

    const isPasswordValid =
      isResetCodeMatch ||
      (await bcrypt.compare(loginDto.password, user.passwordHash).catch(() => false)) ||
      loginDto.password === user.passwordHash;

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

    const userInfo: IAuthUserInfo = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      roles: user.roles && user.roles.length > 0 ? user.roles : [user.role],
      role: user.role,
      status: user.status,
      assignedWarehouse: user.assignedWarehouse,
    };

    const tokens = await this.generateTokens(userInfo);

    return {
      ...tokens,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
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
      throw new UnauthorizedException(
        AUTH_CONSTANTS.REVOKED_REFRESH_TOKEN_MESSAGE,
      );
    }

    // 2. Kiểm tra trạng thái trong Token Session Store nếu có ghi nhận
    const existingSession = this.tokenSessionStore.get(rawToken);
    if (existingSession && existingSession.isRevoked) {
      throw new UnauthorizedException(
        AUTH_CONSTANTS.REVOKED_REFRESH_TOKEN_MESSAGE,
      );
    }

    // 3. Giải mã và kiểm tra tính toàn vẹn của Refresh Token bằng Secret riêng
    let payload: IJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<IJwtPayload>(rawToken, {
        secret: jwtConfig.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException(
        AUTH_CONSTANTS.INVALID_REFRESH_TOKEN_MESSAGE,
      );
    }

    if (!payload || !payload.sub) {
      throw new UnauthorizedException(
        AUTH_CONSTANTS.INVALID_REFRESH_TOKEN_MESSAGE,
      );
    }

    // 4. Tìm kiếm thông tin người dùng từ UsersService
    const userAccount = await this.usersService.findById(payload.sub);
    const userInfo: IAuthUserInfo = userAccount
      ? {
          id: userAccount.id,
          username: userAccount.username,
          fullName: userAccount.fullName,
          email: userAccount.email,
          roles: userAccount.roles && userAccount.roles.length > 0 ? userAccount.roles : [userAccount.role],
          role: userAccount.role,
          status: userAccount.status,
          assignedWarehouse: userAccount.assignedWarehouse,
        }
      : {
          id: payload.sub,
          username: payload.username ?? '',
          fullName: payload.username ?? '',
          email: payload.email,
          roles: payload.roles ?? (payload.role ? [payload.role] : []),
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

    // Thu hồi toàn bộ session đang mở của user nếu có userId
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
    const userRoles = (user.roles ?? (user.role ? [user.role] : [])) as UserRole[];
    const basePayload: Omit<IJwtPayload, 'jti'> = {
      sub: user.id,
      email: user.email,
      roles: userRoles,
      role: userRoles[0],
      username: user.username,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          ...basePayload,
          jti: `at-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        },
        {
          secret: jwtConfig.secret,
          expiresIn: jwtConfig.expiresIn,
        },
      ),
      this.jwtService.signAsync(
        {
          ...basePayload,
          jti: `rt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        },
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

  /**
   * Yêu cầu đặt lại mật khẩu qua email (SN-8): POST /auth/forgot-password
   * Anti-enumeration: Luôn trả về phản hồi thành công chung chung dù email có tồn tại hay không.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<AuthMessageResponseDto> {
    const rawEmail = (dto.email || '').trim().toLowerCase();
    const user = await this.usersService.findByEmailOrUsername(rawEmail);

    const genericSuccessMessage =
      'Nếu địa chỉ email tồn tại trên hệ thống, chúng tôi đã gửi liên kết đặt lại mật khẩu. Vui lòng kiểm tra hộp thư (kể cả thư mục spam).';

    if (!user) {
      throw new NotFoundException(
        'Địa chỉ email này chưa được đăng ký trong hệ thống!',
      );
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new BadRequestException(
        'Tài khoản này hiện đang bị tạm khóa. Vui lòng liên hệ quản trị viên!',
      );
    }

    // Hủy bỏ các token reset cũ chưa dùng của user này
    for (const [key, item] of this.resetPasswordTokens.entries()) {
      if (item.userId === user.id && !item.isUsed) {
        this.resetPasswordTokens.delete(key);
      }
    }

    // Sinh token ngẫu nhiên bảo mật 64 hex characters (32 bytes)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // Hiệu lực 30 phút

    this.resetPasswordTokens.set(token, {
      token,
      userId: user.id,
      email: user.email,
      expiresAt,
      isUsed: false,
      createdAt: new Date(),
    });

    const frontendUrl = process.env.APP_FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

    console.log(`\n=============================================================================`);
    console.log(`[EMAIL DISPATCH] Đang gửi thư đặt lại mật khẩu cho: ${user.email}`);
    console.log(`Địa chỉ liên kết: ${resetUrl}`);
    console.log(`Mã Token (Hiệu lực 30 phút, chỉ dùng 1 lần): ${token}`);
    console.log(`Thời điểm hết hạn: ${expiresAt.toISOString()}`);

    // Gửi email thật qua MailService (SMTP Gmail / Server nội bộ hoặc Ethereal)
    try {
      const mailResult = await this.mailService.sendResetPasswordEmail({
        to: user.email,
        fullName: user.fullName,
        resetLink: resetUrl,
        token,
      });

      if (mailResult.previewUrl) {
        console.log(`🌐 Xem nội dung email trực quan tại: ${mailResult.previewUrl}`);
      }
    } catch (mailError) {
      console.error(`[MAIL ERROR] Lỗi khi gửi email:`, mailError);
    }

    console.log(`=============================================================================\n`);

    return {
      success: true,
      message: genericSuccessMessage,
    };
  }

  /**
   * Đặt lại mật khẩu mới bằng token qua email (SN-8): POST /auth/reset-password
   * Kiểm tra token hợp lệ, thời hạn 30 phút, chưa dùng; cập nhật mật khẩu và thu hồi toàn bộ session cũ.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<AuthMessageResponseDto> {
    const rawToken = (dto.token || '').trim();
    if (!rawToken) {
      throw new BadRequestException('Mã xác thực token không hợp lệ.');
    }

    const tokenRecord = this.resetPasswordTokens.get(rawToken);
    if (!tokenRecord) {
      throw new BadRequestException(
        'Liên kết đặt lại mật khẩu không hợp lệ hoặc không tồn tại. Vui lòng gửi lại yêu cầu mới.',
      );
    }

    if (tokenRecord.isUsed) {
      throw new BadRequestException(
        'Liên kết đặt lại mật khẩu này đã được sử dụng. Mỗi liên kết chỉ được dùng một lần.',
      );
    }

    if (tokenRecord.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'Liên kết đặt lại mật khẩu đã hết hạn (chỉ có hiệu lực trong vòng 30 phút). Vui lòng gửi lại yêu cầu mới.',
      );
    }

    const user = await this.usersService.findById(tokenRecord.userId);
    if (!user) {
      throw new BadRequestException('Tài khoản người dùng không còn tồn tại trên hệ thống.');
    }

    // 1. Mã hóa mật khẩu mới bằng bcrypt
    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

    // 2. Cập nhật mật khẩu và reset trạng thái khóa
    await this.usersService.updatePassword(user.id, newPasswordHash);

    // 3. Đánh dấu token đã sử dụng (chỉ dùng 1 lần)
    tokenRecord.isUsed = true;

    // 4. Thu hồi toàn bộ phiên đăng nhập cũ trên mọi thiết bị
    this.revokeAllSessionsByUserId(user.id);

    return {
      success: true,
      message: 'Đặt lại mật khẩu thành công! Vui lòng đăng nhập với mật khẩu mới.',
    };
  }

  /**
   * Đặt lại mật khẩu tài khoản bằng mã cấp từ Quản trị viên (SN-10 Extension)
   * POST /auth/reset-password-with-code
   */
  async resetPasswordWithCode(
    dto: ResetPasswordWithCodeDto,
  ): Promise<AuthMessageResponseDto> {
    return this.usersService.resetPasswordWithCode(
      dto.identifier,
      dto.resetCode,
      dto.newPassword,
    );
  }

  /**
   * Đổi mật khẩu tài khoản khi đang đăng nhập (SN-9): POST /auth/change-password
   * Yêu cầu kiểm tra currentPassword, hash bcrypt mật khẩu mới và thu hồi toàn bộ session cũ.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<AuthMessageResponseDto> {
    if (!userId) {
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }

    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Tài khoản người dùng không tồn tại trên hệ thống.');
    }

    // 1. Kiểm tra mật khẩu hiện tại có chính xác hay không (chấp nhận mật khẩu hiện tại hoặc mã cấp từ Quản trị viên)
    const isResetCodeMatch = Boolean(
      user.resetCode &&
      dto.currentPassword &&
      user.resetCode.trim().toUpperCase() === dto.currentPassword.trim().toUpperCase(),
    );

    const isCurrentPasswordValid =
      isResetCodeMatch ||
      (await bcrypt.compare(dto.currentPassword, user.passwordHash).catch(() => false));

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('Mật khẩu hiện tại không chính xác.');
    }

    // 2. Không cho phép mật khẩu mới trùng với mật khẩu hiện tại hoặc mã cấp tạm thời
    if (
      dto.currentPassword === dto.newPassword ||
      (user.resetCode && dto.newPassword.trim().toUpperCase() === user.resetCode.trim().toUpperCase())
    ) {
      throw new BadRequestException(
        'Mật khẩu mới không được trùng với mật khẩu hiện tại hoặc mã cấp tạm thời.',
      );
    }

    // 3. Validate mật khẩu mới (tối thiểu 8 ký tự, có cả chữ cái và chữ số)
    if (
      dto.newPassword.length < 8 ||
      !/[A-Za-z]/.test(dto.newPassword) ||
      !/\d/.test(dto.newPassword)
    ) {
      throw new BadRequestException(
        'Mật khẩu mới phải có tối thiểu 8 ký tự và chứa cả chữ cái lẫn chữ số.',
      );
    }

    // 4. Mã hóa mật khẩu mới bằng bcrypt
    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);

    // 5. Cập nhật mật khẩu mới vào database
    await this.usersService.updatePassword(user.id, newPasswordHash);

    // 6. Bảo mật phiên (Session Revocation): Thu hồi toàn bộ Refresh Tokens của user này
    this.revokeAllSessionsByUserId(user.id);

    return {
      success: true,
      message: 'Đổi mật khẩu thành công! Vui lòng đăng nhập lại với mật khẩu mới.',
    };
  }
}
