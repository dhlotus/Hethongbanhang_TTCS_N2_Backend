import { Injectable, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { BCRYPT_SALT_ROUNDS } from '../../common/constants/auth.constant';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService implements OnModuleInit {
  private users: Map<string, UserEntity> = new Map();

  async onModuleInit(): Promise<void> {
    await this.seedInitialUsers();
  }

  private async seedInitialUsers(): Promise<void> {
    const defaultPassword = '123456';
    const passwordHash = await bcrypt.hash(defaultPassword, BCRYPT_SALT_ROUNDS);

    const initialUsers: Array<Partial<UserEntity>> = [
      {
        id: 'usr-admin-001',
        email: 'admin@loha.vn',
        username: 'admin',
        fullName: 'Nguyễn Văn Admin',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-sales-002',
        email: 'sales@loha.vn',
        username: 'sales',
        fullName: 'Trần Văn Nam',
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-salesmgr-003',
        email: 'salesmanager@loha.vn',
        username: 'salesmanager',
        fullName: 'Lê Hoàng Trưởng Phòng',
        role: UserRole.SALES_MANAGER,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-wh-004',
        email: 'warehouse@loha.vn',
        username: 'warehouse',
        fullName: 'Phạm Hùng Kho',
        role: UserRole.WAREHOUSE_KEEPER,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-whmgr-005',
        email: 'warehousemanager@loha.vn',
        username: 'warehousemanager',
        fullName: 'Đỗ Quốc Bảo',
        role: UserRole.WAREHOUSE_MANAGER,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-acc-006',
        email: 'accountant@loha.vn',
        username: 'accountant',
        fullName: 'Vũ Mai Hoa',
        role: UserRole.ACCOUNTANT,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-cust-007',
        email: 'dealer@loha.vn',
        username: 'dealer',
        fullName: 'Cửa Hàng Minh Khang',
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
    ];

    for (const user of initialUsers) {
      const entity = new UserEntity(user);
      this.users.set(entity.id, entity);
    }
  }

  async findByEmailOrUsername(identifier: string): Promise<UserEntity | null> {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (
        user.email.toLowerCase() === normalizedIdentifier ||
        user.username.toLowerCase() === normalizedIdentifier
      ) {
        return user;
      }
    }
    return null;
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.users.get(id) ?? null;
  }

  async updateFailedAttempts(
    userId: string,
    failedAttempts: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    const user = this.users.get(userId);
    if (!user) {
      return;
    }
    user.failedAttempts = failedAttempts;
    user.lockedUntil = lockedUntil;
    user.updatedAt = new Date();
  }

  async resetFailedAttempts(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) {
      return;
    }
    user.failedAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = new Date();
  }
}
