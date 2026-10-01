import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtConfig } from '../../../config/jwt.config';
import { AUTH_CONSTANTS } from '../constants/auth.constant';
import { IJwtPayload } from '../interfaces/jwt-payload.interface';
import { ICurrentUser } from '../interfaces/current-user.interface';

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
    if (!payload || !payload.sub || !payload.roles) {
      throw new UnauthorizedException(AUTH_CONSTANTS.UNAUTHORIZED_ACCESS_MESSAGE);
    }

    return {
      userId: payload.sub,
      email: payload.email,
      roles: payload.roles,
      username: payload.username,
    };
  }
}
