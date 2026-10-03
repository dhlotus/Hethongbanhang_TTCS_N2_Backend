import { Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { jwtConfig } from '../../../config/jwt.config';
import { UsersService } from '../../users/users.service';
import { AUTH_CONSTANTS } from '../constants/auth.constant';
import { ICurrentUser } from '../interfaces/current-user.interface';
import { IJwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(UsersService)
    @Optional()
    private readonly usersService?: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.secret,
    });
  }

  /**
   * Xác thực và phân giải payload của Access Token
   * Kiểm tra trực tiếp trạng thái tài khoản: Nếu bị LOCKED, từ chối ngay lập tức!
   */
  async validate(payload: IJwtPayload): Promise<ICurrentUser> {
    const roles = payload.roles ?? (payload.role ? [payload.role] : []);
    if (!payload || !payload.sub || roles.length === 0) {
      throw new UnauthorizedException(AUTH_CONSTANTS.UNAUTHORIZED_ACCESS_MESSAGE);
    }

    let avatarUrl: string | null = null;
    if (this.usersService) {
      const user = await this.usersService.findById(payload.sub);
      if (user && user.status === UserStatus.LOCKED) {
        throw new UnauthorizedException(
          `Tài khoản của bạn đã bị khóa bởi Quản trị viên.${user.lockReason ? ' Lý do: ' + user.lockReason : ''}`,
        );
      }
      if (user) {
        avatarUrl = user.avatarUrl ?? null;
      }
    }

    return {
      userId: payload.sub,
      email: payload.email,
      roles,
      username: payload.username,
      avatarUrl,
    };
  }
}

