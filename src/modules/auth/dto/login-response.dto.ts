import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';

export interface SafeUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
}

export class LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  access_token: string;
  refresh_token: string;
  user: SafeUser;

  constructor(data: {
    accessToken: string;
    refreshToken: string;
    user: SafeUser;
  }) {
    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    this.access_token = data.accessToken;
    this.refresh_token = data.refreshToken;
    this.user = data.user;
  }
}
