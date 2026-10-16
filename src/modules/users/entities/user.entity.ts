import { UserRole } from '../../../common/enums/user-role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';

export interface UserWarehouseItem {
  id: string;
  code: string;
  name: string;
  isPrimary?: boolean;
}

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
  warehouseId?: string | null;
  assignedWarehouseId?: string | null;
  warehouseCode?: string | null;
  assignedWarehouseCode?: string | null;
  warehouseIds?: string[];
  warehouses?: UserWarehouseItem[];
  dateOfBirth?: string | null;
  gender?: string | null;
  isIdentityLocked?: boolean;
  lockReason?: string | null;
  resetCode?: string | null;
  resetCodeCreatedAt?: Date | null;
  customerId?: string | null;
  customerCode?: string | null;
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
  warehouseId?: string | null;
  assignedWarehouseId?: string | null;
  warehouseCode?: string | null;
  assignedWarehouseCode?: string | null;
  warehouseIds?: string[];
  warehouses?: UserWarehouseItem[];
  customerId?: string | null;
  customerCode?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  isIdentityLocked?: boolean;
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
    this.customerId = partial.customerId ?? null;
    this.customerCode = partial.customerCode ?? null;

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
    this.warehouseId = partial.warehouseId ?? (partial as any).assignedWarehouseId ?? null;
    this.assignedWarehouseId = this.warehouseId;
    this.warehouseCode = partial.warehouseCode ?? (partial as any).assignedWarehouseCode ?? null;
    this.assignedWarehouseCode = this.warehouseCode;
    this.warehouses = partial.warehouses ?? [];
    this.warehouseIds =
      partial.warehouseIds ??
      (this.warehouses.length > 0
        ? this.warehouses.map((w) => w.id)
        : this.warehouseId
        ? [this.warehouseId]
        : []);
    this.dateOfBirth = partial.dateOfBirth ?? null;
    this.gender = partial.gender ?? null;
    this.isIdentityLocked = partial.isIdentityLocked ?? false;
    this.lockReason = partial.lockReason ?? null;
    this.resetCode = partial.resetCode ?? null;
    this.resetCodeCreatedAt = partial.resetCodeCreatedAt ?? null;
    this.failedAttempts = partial.failedAttempts ?? 0;
    this.lockedUntil = partial.lockedUntil ?? null;
    this.createdAt =
      partial.createdAt instanceof Date
        ? partial.createdAt
        : partial.createdAt
        ? new Date(partial.createdAt)
        : new Date();
    this.updatedAt =
      partial.updatedAt instanceof Date
        ? partial.updatedAt
        : partial.updatedAt
        ? new Date(partial.updatedAt)
        : new Date();
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
      warehouseId: this.warehouseId,
      assignedWarehouseId: this.assignedWarehouseId,
      warehouseCode: this.warehouseCode,
      assignedWarehouseCode: this.assignedWarehouseCode,
      warehouseIds: this.warehouseIds || (this.warehouseId ? [this.warehouseId] : []),
      warehouses: this.warehouses,
      customerId: this.customerId,
      customerCode: this.customerCode,
      dateOfBirth: this.dateOfBirth,
      gender: this.gender,
      isIdentityLocked: this.isIdentityLocked,
      lockReason: this.lockReason,
      resetCode: this.resetCode,
      resetCodeCreatedAt: this.resetCodeCreatedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

