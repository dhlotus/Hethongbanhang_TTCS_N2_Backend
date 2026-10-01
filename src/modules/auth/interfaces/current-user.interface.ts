import { UserRole } from '../../../common/enums/user-role.enum';

export interface ICurrentUser {
  userId: string;
  email: string;
  roles: UserRole[];
  username?: string;
}
