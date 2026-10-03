import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';

export interface SafeUser {
  id: string;
  email: string;
  username: string;
  fullName: string;
  phone: string;
  role: UserRole;
  roles: UserRole[];
  status: UserStatus;
  avatarUrl?: string | null;
  assignedWarehouse?: string;
  lockReason?: string | null;
  resetCode?: string | null;
  resetCodeCreatedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class UserEntity {
  id: string;
  email: string;
  username: string;
  fullName: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  roles: UserRole[];
  status: UserStatus;
  avatarUrl: string | null;
  assignedWarehouse?: string;
  lockReason?: string | null;
  resetCode?: string | null;
  resetCodeCreatedAt?: Date | null;
  failedAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<UserEntity>) {
    this.id = partial.id ?? '';
    this.email = partial.email ?? '';
    this.username = partial.username ?? '';
    this.fullName = partial.fullName ?? '';
    this.phone = partial.phone ?? '';
    this.passwordHash = partial.passwordHash ?? '';

    // Hỗ trợ Đa vai trò (Multi-role - SN-14)
    if (partial.roles && partial.roles.length > 0) {
      this.roles = Array.from(new Set(partial.roles));
      this.role = this.roles[0];
    } else if (partial.role) {
      this.role = partial.role;
      this.roles = [partial.role];
    } else {
      this.role = UserRole.CUSTOMER;
      this.roles = [UserRole.CUSTOMER];
    }

    this.status = partial.status ?? UserStatus.ACTIVE;
    this.avatarUrl = partial.avatarUrl ?? null;
    this.assignedWarehouse = partial.assignedWarehouse;
    this.lockReason = partial.lockReason ?? null;
    this.resetCode = partial.resetCode ?? null;
    this.resetCodeCreatedAt = partial.resetCodeCreatedAt ?? null;
    this.failedAttempts = partial.failedAttempts ?? 0;
    this.lockedUntil = partial.lockedUntil ?? null;
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();
  }

  /**
   * Chuyển đổi sang đối tượng SafeUser an toàn, tuyệt đối không lộ passwordHash
   */
  toSafeUser(): SafeUser {
    return {
      id: this.id,
      email: this.email,
      username: this.username,
      fullName: this.fullName,
      phone: this.phone,
      role: this.role,
      roles: this.roles,
      status: this.status,
      avatarUrl: this.avatarUrl ?? null,
      assignedWarehouse: this.assignedWarehouse,
      lockReason: this.lockReason,
      resetCode: this.resetCode,
      resetCodeCreatedAt: this.resetCodeCreatedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

