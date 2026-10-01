import { UserRole } from '../../../common/enums/user-role.enum';

export interface IJwtPayload {
  sub: string;
  email: string;
  role?: UserRole;
  roles?: UserRole[];
  username?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}

export type JwtPayload = IJwtPayload;
