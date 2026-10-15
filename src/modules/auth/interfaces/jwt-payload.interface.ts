import { UserRole } from '../../../common/enums/user-role.enum';

export interface IJwtPayload {
  sub: string;
  email: string;
  role?: UserRole;
  roles?: UserRole[];
  username?: string;
  warehouseId?: string | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  assignedWarehouse?: string | null;
  jti?: string;
  iat?: number;
  exp?: number;
}

export type JwtPayload = IJwtPayload;
