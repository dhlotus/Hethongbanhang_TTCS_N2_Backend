export interface IAuthUserInfo {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roles: string[];
  role?: string;
  status?: string;
  assignedWarehouse?: string;
  avatarUrl?: string | null;
}

export class TokenResponseDto {
  accessToken!: string;
  tokenType!: string;
  expiresIn!: string;
  refreshToken?: string;
}

export class LoginResponseDto extends TokenResponseDto {
  user!: IAuthUserInfo;
  access_token?: string;
  refresh_token?: string;
}

export class LogoutResponseDto {
  success!: boolean;
  message!: string;
}
