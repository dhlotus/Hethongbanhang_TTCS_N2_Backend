export interface IAuthUserInfo {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roles: string[];
}

export class TokenResponseDto {
  accessToken!: string;
  tokenType!: string;
  expiresIn!: string;
  refreshToken?: string;
}

export class LoginResponseDto extends TokenResponseDto {
  user!: IAuthUserInfo;
}

export class LogoutResponseDto {
  success!: boolean;
  message!: string;
}
