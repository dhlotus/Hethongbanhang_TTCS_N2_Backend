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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      const request = context.switchToHttp().getRequest<{ headers?: Record<string, string> }>();
      const authHeader = request.headers?.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
          const res = super.canActivate(context);
          if (res instanceof Promise) {
            return await res;
          } else if (typeof res === 'boolean') {
            return res;
          }
          return true;
        } catch {
          return true;
        }
      }
      return true;
    }

    const result = super.canActivate(context);
    if (result instanceof Promise) {
      return await result;
    }
    if (typeof result === 'boolean') {
      return result;
    }
    return true;
  }

  handleRequest<TUser = ICurrentUser>(
    err: unknown,
    user: TUser,
    info: unknown,
    context?: ExecutionContext,
  ): TUser {
    if (context) {
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isPublic) {
        return (user || undefined) as unknown as TUser;
      }
    }
    if (err || !user) {
      throw new UnauthorizedException(AUTH_CONSTANTS.UNAUTHORIZED_ACCESS_MESSAGE);
    }
    return user;
  }
}

