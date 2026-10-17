export interface IAuthUserInfo {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roles: string[];
  role?: string;
  status?: string;
  assignedWarehouse?: string;
  warehouseId?: string | null;
  assignedWarehouseId?: string | null;
  warehouseCode?: string | null;
  assignedWarehouseCode?: string | null;
  warehouseName?: string | null;
  warehouseIds?: string[];
  warehouses?: Array<{ id: string; code: string; name: string; isPrimary?: boolean }>;
  avatarUrl?: string | null;
  customerId?: string | null;
  customerCode?: string | null;
  agencyId?: string | null;
}

export class TokenResponseDto {
  accessToken!: string;
  tokenType!: string;
  expiresIn!: string;
  refreshToken?: string;
  access_token?: string;
  refresh_token?: string;
}

export class LoginResponseDto extends TokenResponseDto {
  user!: IAuthUserInfo;
}

export class LogoutResponseDto {
  success!: boolean;
  message!: string;
}
