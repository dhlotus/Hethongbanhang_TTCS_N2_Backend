import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import {
  LoginDto,
  LoginResponseDto,
  LogoutDto,
  LogoutResponseDto,
  RefreshTokenDto,
  TokenResponseDto,
} from './dto';
import { ICurrentUser } from './interfaces/current-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  getProfile(@CurrentUser() currentUser: ICurrentUser): ICurrentUser {
    return currentUser;
  }
}
