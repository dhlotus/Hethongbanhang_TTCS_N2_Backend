import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY, AUTH_CONSTANTS } from '../../modules/auth/constants/auth.constant';
import { ICurrentUser } from '../../modules/auth/interfaces/current-user.interface';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = ICurrentUser>(
    err: unknown,
    user: TUser,
  ): TUser {
    if (err || !user) {
      throw new UnauthorizedException(AUTH_CONSTANTS.UNAUTHORIZED_ACCESS_MESSAGE);
    }
    return user;
  }
}
