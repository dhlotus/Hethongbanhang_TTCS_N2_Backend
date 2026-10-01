import { UserRole } from '../../../common/enums/user-role.enum';

export interface IJwtPayload {
  sub: string;
  email: string;
  roles: UserRole[];
  username?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}
