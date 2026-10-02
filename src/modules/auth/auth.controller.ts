import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UploadedAvatarFile } from '../users/decorators/uploaded-avatar-file.decorator';
import { AvatarResponseDto } from '../users/dto/avatar-response.dto';
import { AvatarValidationPipe } from '../users/pipes/avatar-validation.pipe';
import { SafeUser } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  AuthMessageResponseDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LoginResponseDto,
  LogoutDto,
  LogoutResponseDto,
  RefreshTokenDto,
  ResetPasswordDto,
  ResetPasswordWithCodeDto,
  TokenResponseDto,
} from './dto';
import { ICurrentUser } from './interfaces/current-user.interface';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Endpoint đăng nhập cấp phát Access Token & Refresh Token
   * POST /auth/login
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(loginDto);
  }

  /**
   * Endpoint làm mới Access Token từ Refresh Token (Refresh Token Rotation)
   * POST /auth/refresh
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(
    @Body() refreshTokenDto: RefreshTokenDto,
  ): Promise<TokenResponseDto> {
    return this.authService.refreshTokens(refreshTokenDto);
  }

  /**
   * Endpoint đăng xuất và thu hồi Refresh Token / Revoke Session
   * POST /auth/logout
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() currentUser?: ICurrentUser,
    @Body() logoutDto?: LogoutDto,
  ): Promise<LogoutResponseDto> {
    return this.authService.logout(currentUser, logoutDto);
  }

  /**
   * Endpoint tra cứu thông tin người dùng đang đăng nhập (Protected Route)
   * GET /auth/me
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@CurrentUser() currentUser: ICurrentUser): Promise<SafeUser> {
    return this.usersService.findSafeById(currentUser.userId);
  }

  /**
   * Endpoint tải lên ảnh đại diện tài khoản đang đăng nhập (SN-144)
   * POST /api/auth/avatar
   */
  @UseGuards(JwtAuthGuard)
  @Post('avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'avatar', maxCount: 1 },
      ],
      {
        storage: multer.memoryStorage(),
        limits: {
          fileSize: 10 * 1024 * 1024,
        },
      },
    ),
  )
  async uploadAvatar(
    @CurrentUser() currentUser: ICurrentUser,
    @UploadedAvatarFile(new AvatarValidationPipe()) file: Express.Multer.File,
  ): Promise<AvatarResponseDto> {
    return this.usersService.uploadAvatar(currentUser.userId, file);
  }

  /**
   * Endpoint yêu cầu gửi email đặt lại mật khẩu (SN-8)
   * POST /auth/forgot-password
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
  ): Promise<AuthMessageResponseDto> {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  /**
   * Endpoint đặt lại mật khẩu mới bằng token qua email (SN-8)
   * POST /auth/reset-password
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
  ): Promise<AuthMessageResponseDto> {
    return this.authService.resetPassword(resetPasswordDto);
  }

  /**
   * Endpoint đặt lại mật khẩu bằng mã cấp từ Quản trị viên (SN-10 Extension)
   * POST /auth/reset-password-with-code
   */
  @Public()
  @Post('reset-password-with-code')
  @HttpCode(HttpStatus.OK)
  async resetPasswordWithCode(
    @Body() dto: ResetPasswordWithCodeDto,
  ): Promise<AuthMessageResponseDto> {
    return this.authService.resetPasswordWithCode(dto);
  }

  /**
   * Endpoint đổi mật khẩu tài khoản khi đang đăng nhập (SN-9)
   * Yêu cầu xác thực qua Bearer Token
   * POST /auth/change-password
   */
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() currentUser: ICurrentUser,
    @Body() changePasswordDto: ChangePasswordDto,
  ): Promise<AuthMessageResponseDto> {
    return this.authService.changePassword(
      currentUser.userId,
      changePasswordDto,
    );
  }
}
