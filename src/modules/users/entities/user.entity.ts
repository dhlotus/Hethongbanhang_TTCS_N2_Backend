import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';

export class UserEntity {
  id: string;
  email: string;
  username: string;
  fullName: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  failedAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<UserEntity>) {
    this.id = partial.id ?? '';
    this.email = partial.email ?? '';
    this.username = partial.username ?? '';
    this.fullName = partial.fullName ?? '';
    this.passwordHash = partial.passwordHash ?? '';
    this.role = partial.role ?? UserRole.CUSTOMER;
    this.status = partial.status ?? UserStatus.ACTIVE;
    this.failedAttempts = partial.failedAttempts ?? 0;
    this.lockedUntil = partial.lockedUntil ?? null;
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();
  }
}
