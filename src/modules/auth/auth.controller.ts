import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  LoginDto,
  RefreshTokenDto,
  LogoutDto,
  TokenResponseDto,
  LoginResponseDto,
  LogoutResponseDto,
} from './dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ICurrentUser } from './interfaces/current-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Endpoint đăng nhập cấp phát Access Token & Refresh Token
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    return this.authService.login(loginDto);
  }

  /**
   * Endpoint làm mới Access Token từ Refresh Token (Refresh Token Rotation)
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto): Promise<TokenResponseDto> {
    return this.authService.refreshTokens(refreshTokenDto);
  }

  /**
   * Endpoint đăng xuất và thu hồi Refresh Token / Revoke Session
   * Hỗ trợ xác thực qua Bearer Token hoặc truyền Refresh Token trực tiếp
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
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@CurrentUser() currentUser: ICurrentUser): ICurrentUser {
    return currentUser;
  }
}
