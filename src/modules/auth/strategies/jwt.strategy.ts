import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtConfig } from '../../../config/jwt.config';
import { AUTH_CONSTANTS } from '../constants/auth.constant';
import { ICurrentUser } from '../interfaces/current-user.interface';
import { IJwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.secret,
    });
  }

  /**
   * Xác thực và phân giải payload của Access Token
   */
  async validate(payload: IJwtPayload): Promise<ICurrentUser> {
    const roles = payload.roles ?? (payload.role ? [payload.role] : []);
    if (!payload || !payload.sub || roles.length === 0) {
      throw new UnauthorizedException(AUTH_CONSTANTS.UNAUTHORIZED_ACCESS_MESSAGE);
    }

    return {
      userId: payload.sub,
      email: payload.email,
      roles,
      username: payload.username,
    };
  }
}
