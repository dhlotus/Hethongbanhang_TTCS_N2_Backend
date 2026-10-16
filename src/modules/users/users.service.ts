import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { BCRYPT_SALT_ROUNDS } from '../../common/constants/auth.constant';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { DatabaseService } from '../../database/database.service';
import { MailService } from '../mail/mail.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import {
  AVATAR_MESSAGES,
  AVATAR_URL_PREFIX,
} from './constants/avatar.constant';
import {
  AvatarResponseDto,
  CreateUserDto,
  QueryUsersDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto';
import { SafeUser, UserEntity } from './entities/user.entity';

export interface UserSummaryStats {
  total: number;
  active: number;
  locked: number;
  pendingReset: number;
}

export interface PaginatedUsersResult {
  data: SafeUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: UserSummaryStats;
}

export interface CreateUserResult {
  user: SafeUser;
  temporaryPassword?: string;
}

export interface CreateUserOptions {
  skipEmail?: boolean;
  skipDiskSync?: boolean;
  saltRounds?: number;
}



export interface AssignedCustomerItem {
  id: string;
  code: string;
  name: string;
  region: string;
  phone?: string;
  email?: string;
  status: string;
  salesRepId: string;
}

export interface UpdateUserStatusResult extends SafeUser {
  user: SafeUser;
  assignedCustomers: AssignedCustomerItem[];
  assignedCustomersCount: number;
  handoverWarning?: string;
  summary?: UserSummaryStats;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private users: Map<string, UserEntity> = new Map();
  private sessionRevoker?: (userId: string) => void;

  private customers: Map<string, AssignedCustomerItem> = new Map([
    [
      '55555555-0000-0000-0000-000000000001',
      {
        id: '55555555-0000-0000-0000-000000000001',
        code: 'DL-MK-001',
        name: 'Đại Lý Cửa Hàng Minh Khang',
        region: 'Miền Nam',
        phone: '0907000007',
        email: 'dealer@loha.vn',
        status: 'ACTIVE',
        salesRepId: 'usr-sales-002',
      },
    ],
    [
      '55555555-0000-0000-0000-000000000002',
      {
        id: '55555555-0000-0000-0000-000000000002',
        code: 'DL-AB-002',
        name: 'Đại Lý Bán Buôn An Bình',
        region: 'Miền Bắc',
        phone: '0907000017',
        email: 'daily@loha.vn',
        status: 'ACTIVE',
        salesRepId: 'usr-sales-002',
      },
    ],
    [
      '55555555-0000-0000-0000-000000000003',
      {
        id: '55555555-0000-0000-0000-000000000003',
        code: 'DL-HT-003',
        name: 'Tạp Hóa Phân Phối Hưng Thịnh',
        region: 'Tây Nam Bộ',
        phone: '0909112233',
        email: 'hungthinh@gmail.com',
        status: 'LOCKED',
        salesRepId: 'usr-sales-002',
      },
    ],
    [
      '55555555-0000-0000-0000-000000000004',
      {
        id: '55555555-0000-0000-0000-000000000004',
        code: 'DL-TH-004',
        name: 'Đại Lý Phân Phối Thuận Hòa',
        region: 'Đông Nam Bộ',
        phone: '0918223344',
        email: 'thuanhoa@loha.vn',
        status: 'ACTIVE',
        salesRepId: 'usr-salesmgr-003',
      },
    ],
  ]);

  constructor(
    @Optional() private readonly mailService?: MailService,
    @Optional() private readonly dbService?: DatabaseService,
  ) {
    this.seedInitialUsersSync();
  }

  async onModuleInit(): Promise<void> {
    if (this.users.size === 0) {
      this.seedInitialUsersSync();
    }
    this.loadUsersFromDisk();
    if (this.dbService?.isConnected()) {
      await this.loadUsersFromDatabase();
    }
  }

  /**
   * Đăng ký callback thu hồi phiên đăng nhập khi tài khoản bị khóa
   */
  registerSessionRevoker(revoker: (userId: string) => void): void {
    this.sessionRevoker = revoker;
  }

  /**
   * Thu hồi toàn bộ phiên hoạt động của người dùng
   */
  revokeSessions(userId: string): void {
    if (this.sessionRevoker) {
      this.sessionRevoker(userId);
    }
  }

  public resolveWarehouseInfo(warehouseStr?: string): {
    warehouseId?: string;
    warehouseCode?: string;
    warehouseName?: string;
  } {
    if (!warehouseStr || !warehouseStr.trim()) return {};
    const raw = warehouseStr.trim().toLowerCase();

    // 1. Kho Miền Bắc (Hà Nội)
    if (
      raw.includes('hà nội') ||
      raw.includes('ha noi') ||
      raw.includes('kho-mb') ||
      raw.includes('miền bắc') ||
      raw.includes('mien bac') ||
      raw === '11111111-0000-0000-0000-000000000002'
    ) {
      return {
        warehouseId: '11111111-0000-0000-0000-000000000002',
        warehouseCode: 'KHO-MB-01',
        warehouseName: 'Kho Miền Bắc (Hà Nội)',
      };
    }

    // 2. Kho Miền Trung (Đà Nẵng)
    if (
      raw.includes('đà nẵng') ||
      raw.includes('da nang') ||
      raw.includes('kho-mt') ||
      raw.includes('miền trung') ||
      raw.includes('mien trung') ||
      raw === '11111111-0000-0000-0000-000000000004'
    ) {
      return {
        warehouseId: '11111111-0000-0000-0000-000000000004',
        warehouseCode: 'KHO-MT-01',
        warehouseName: 'Kho Miền Trung (Đà Nẵng)',
      };
    }

    // 3. Kho Miền Tây (Cần Thơ)
    if (
      raw.includes('tây nam bộ') ||
      raw.includes('tay nam bo') ||
      raw.includes('miền tây') ||
      raw.includes('mien tay') ||
      raw.includes('kho-west') ||
      raw.includes('cần thơ') ||
      raw.includes('can tho') ||
      raw === '11111111-0000-0000-0000-000000000003'
    ) {
      return {
        warehouseId: '11111111-0000-0000-0000-000000000003',
        warehouseCode: 'KHO-WEST-01',
        warehouseName: 'Kho Miền Tây (Cần Thơ)',
      };
    }

    // 4. Kho Miền Nam (TP. Hồ Chí Minh)
    if (
      raw.includes('miền nam') ||
      raw.includes('mien nam') ||
      raw.includes('loha wh01') ||
      raw.includes('wh01') ||
      raw.includes('kho-mn') ||
      raw.includes('hồ chí minh') ||
      raw.includes('ho chi minh') ||
      raw.includes('sóng thần') ||
      raw.includes('song than') ||
      raw === '11111111-0000-0000-0000-000000000001' ||
      raw === '11111111-0000-4000-8000-000000000001'
    ) {
      return {
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseCode: 'KHO-MN-01',
        warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
      };
    }

    if (
      /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/.test(raw)
    ) {
      return {
        warehouseId: raw,
        warehouseCode: raw,
        warehouseName: raw,
      };
    }

    return {};
  }

  private seedInitialUsersSync(): void {
    const defaultPassword = '123456';
    const passwordHash = bcrypt.hashSync(defaultPassword, BCRYPT_SALT_ROUNDS);

    const initialUsers: Array<Partial<UserEntity>> = [
      {
        id: 'usr-admin-pduc',
        email: 'phucducha12@gmail.com',
        username: 'phucducha12',
        fullName: 'Nguyễn Phúc Đức (Quản Trị Viên)',
        phone: '0901234567',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-admin-001',
        email: 'admin@loha.vn',
        username: 'admin',
        fullName: 'Nguyễn Văn Admin (Quản Trị Viên)',
        phone: '0912345678',
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
        phone: '0923456789',
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE,
        assignedWarehouse: 'Địa bàn Miền Bắc',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-sale-01',
        email: 'long.tran@loha.vn',
        username: 'long_tran',
        fullName: 'Trần Văn Long',
        phone: '0907000001',
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE,
        assignedWarehouse: 'Địa bàn Miền Nam',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-sale-02',
        email: 'hang.nguyen@loha.vn',
        username: 'hang_nguyen',
        fullName: 'Nguyễn Thị Hằng',
        phone: '0907000002',
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE,
        assignedWarehouse: 'Địa bàn Miền Nam',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-sale-03',
        email: 'tuan.pham@loha.vn',
        username: 'tuan_pham',
        fullName: 'Phạm Minh Tuấn',
        phone: '0907000003',
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE,
        assignedWarehouse: 'Địa bàn Miền Bắc',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-salesmgr-003',
        email: 'salesmanager@loha.vn',
        username: 'salesmanager',
        fullName: 'Lê Hoàng',
        phone: '0934567890',
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
        fullName: 'Phạm Hùng Kho (Thủ Kho)',
        phone: '0945678901',
        role: UserRole.WAREHOUSE_KEEPER,
        status: UserStatus.ACTIVE,
        assignedWarehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-whmgr-005',
        email: 'warehousemanager@loha.vn',
        username: 'warehousemanager',
        fullName: 'Đỗ Quốc Bảo (Quản Lý Kho)',
        phone: '0956789012',
        role: UserRole.WAREHOUSE_MANAGER,
        status: UserStatus.ACTIVE,
        assignedWarehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-acc-006',
        email: 'accountant@loha.vn',
        username: 'accountant',
        fullName: 'Vũ Mai Hoa (Kế Toán Công Nợ)',
        phone: '0967890123',
        role: UserRole.ACCOUNTANT,
        status: UserStatus.ACTIVE,
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-dealer-007',
        email: 'dealer@loha.vn',
        username: 'dealer',
        fullName: 'Đại Lý Cửa Hàng Minh Khang',
        phone: '0901234561',
        role: UserRole.CUSTOMER,
        roles: [UserRole.CUSTOMER],
        status: UserStatus.ACTIVE,
        customerId: 'cust-001',
        customerCode: 'DL-0001',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-dealer-008',
        email: 'daily@loha.vn',
        username: 'daily',
        fullName: 'Đại Lý Bán Buôn An Bình',
        phone: '0901234562',
        role: UserRole.CUSTOMER,
        roles: [UserRole.CUSTOMER],
        status: UserStatus.ACTIVE,
        customerId: 'cust-dl-0002',
        customerCode: 'DL-0002',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
    ];

    const deletedSet = this.loadDeletedUsersFromDisk();
    for (const user of initialUsers) {
      if (
        (user.id && deletedSet.has(user.id.toLowerCase())) ||
        (user.username && deletedSet.has(user.username.toLowerCase())) ||
        (user.email && deletedSet.has(user.email.toLowerCase()))
      ) {
        continue;
      }
      if (!user.id) continue;
      const whInfo = this.resolveWarehouseInfo(user.assignedWarehouse);
      if (whInfo.warehouseId) {
        user.warehouseId = whInfo.warehouseId;
        user.assignedWarehouseId = whInfo.warehouseId;
        user.warehouseCode = whInfo.warehouseCode;
        user.assignedWarehouseCode = whInfo.warehouseCode;
        user.warehouses = [
          {
            id: whInfo.warehouseId,
            code: whInfo.warehouseCode || '',
            name: whInfo.warehouseName || user.assignedWarehouse || '',
            isPrimary: true,
          },
        ];
      }
      const entity = new UserEntity(user);
      this.users.set(entity.id, entity);
    }

    // Sau khi seed xong, khôi phục avatarUrl từ file đã lưu trên đĩa
    this.restoreAvatarsFromDisk();

    // Khôi phục và đồng bộ các thay đổi người dùng đã lưu từ đĩa
    this.loadUsersFromDisk();
  }

  private getStorageFilePath(): string {
    const dataDir = path.join(process.cwd(), 'uploads', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'users.json');
  }

  private getDeletedUsersFilePath(): string {
    const dataDir = path.join(process.cwd(), 'uploads', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'deleted_users.json');
  }

  private loadDeletedUsersFromDisk(): Set<string> {
    try {
      const filePath = this.getDeletedUsersFilePath();
      if (!fs.existsSync(filePath)) return new Set();
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) return new Set();
      const list: Array<{ id?: string; username?: string; email?: string }> = JSON.parse(content);
      const set = new Set<string>();
      for (const item of list) {
        if (item.id) set.add(item.id.toLowerCase());
        if (item.username) set.add(item.username.toLowerCase());
        if (item.email) set.add(item.email.toLowerCase());
      }
      return set;
    } catch {
      return new Set();
    }
  }

  private recordDeletedUser(user: { id: string; username: string; email: string }): void {
    try {
      const filePath = this.getDeletedUsersFilePath();
      let list: Array<{ id: string; username: string; email: string; deletedAt: string }> = [];
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          if (content.trim()) {
            list = JSON.parse(content);
          }
        } catch {}
      }
      list = list.filter(
        (u) =>
          u.id.toLowerCase() !== user.id.toLowerCase() &&
          u.username.toLowerCase() !== user.username.toLowerCase() &&
          u.email.toLowerCase() !== user.email.toLowerCase(),
      );
      list.push({
        id: user.id,
        username: user.username,
        email: user.email,
        deletedAt: new Date().toISOString(),
      });
      fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[USERS_SERVICE] Lỗi ghi nhận deleted_users.json:', err);
    }
  }

  private loadUsersFromDisk(): void {
    try {
      const filePath = this.getStorageFilePath();
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) return;
      const rawList: Array<Partial<UserEntity>> = JSON.parse(content);
      const deletedSet = this.loadDeletedUsersFromDisk();
      
      const isMock = (fullName?: string, username?: string) => {
        if (!fullName && !username) return false;
        return (
          /Nhân Viên \d+/i.test(fullName || '') ||
          /vũ văn bảy/i.test(fullName || '') ||
          /nguyễn văn một/i.test(fullName || '') ||
          /nguyen van a/i.test(fullName || '') ||
          (username || '').startsWith('employee_') ||
          (username || '').startsWith('test_')
        );
      };

      // Dọn sạch các user mock hoặc user đã bị xóa khỏi Map
      for (const [id, u] of this.users.entries()) {
        if (
          isMock(u.fullName, u.username) ||
          deletedSet.has(id.toLowerCase()) ||
          deletedSet.has(u.username.toLowerCase()) ||
          deletedSet.has(u.email.toLowerCase())
        ) {
          this.users.delete(id);
        }
      }

      for (const item of rawList) {
        if (!item.id) continue;
        if (isMock(item.fullName, item.username)) continue;
        if (
          deletedSet.has(item.id.toLowerCase()) ||
          (item.username && deletedSet.has(item.username.toLowerCase())) ||
          (item.email && deletedSet.has(item.email.toLowerCase()))
        ) {
          continue;
        }
        const whInfo = this.resolveWarehouseInfo(
          item.assignedWarehouse || (item as any).warehouseName || item.warehouseCode,
        );
        if (whInfo.warehouseId) {
          item.warehouseId = item.warehouseId || whInfo.warehouseId;
          item.assignedWarehouseId = item.assignedWarehouseId || whInfo.warehouseId;
          item.warehouseCode = item.warehouseCode || whInfo.warehouseCode;
          item.assignedWarehouseCode = item.assignedWarehouseCode || whInfo.warehouseCode;
          if (!item.warehouses || item.warehouses.length === 0) {
            item.warehouses = [
              {
                id: whInfo.warehouseId,
                code: whInfo.warehouseCode || '',
                name: whInfo.warehouseName || item.assignedWarehouse || '',
                isPrimary: true,
              },
            ];
          }
        }

        const existing = this.users.get(item.id);
        if (existing) {
          Object.assign(existing, {
            ...item,
            createdAt: item.createdAt ? new Date(item.createdAt) : existing.createdAt,
            updatedAt: item.updatedAt ? new Date(item.updatedAt) : existing.updatedAt,
          });
        } else {
          this.users.set(item.id, new UserEntity(item));
        }
      }
    } catch (err) {
      console.warn('[USERS_SERVICE] Lỗi khi nạp dữ liệu người dùng từ đĩa:', err);
    }
  }

  private saveUsersToDisk(): void {
    try {
      const filePath = this.getStorageFilePath();
      const list = Array.from(this.users.values());
      fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[USERS_SERVICE] Lỗi khi lưu dữ liệu người dùng ra đĩa:', err);
    }
  }

  public async loadUsersFromDatabase(): Promise<void> {
    if (!this.dbService?.isConnected()) return;
    try {
      // 1. Nạp danh sách quan hệ phân quyền kho từ user_warehouses kèm thông tin kho
      const uwRows = await this.dbService.query<{
        user_id: string;
        warehouse_id: string;
        is_primary: boolean;
        warehouse_code: string;
        warehouse_name: string;
      }>(
        `SELECT uw.user_id, uw.warehouse_id, uw.is_primary, w.code AS warehouse_code, w.name AS warehouse_name
         FROM user_warehouses uw
         JOIN warehouses w ON w.id = uw.warehouse_id
         ORDER BY uw.is_primary DESC, w.code ASC;`,
      );
      const userWarehousesMap = new Map<
        string,
        Array<{ id: string; code: string; name: string; isPrimary: boolean }>
      >();
      for (const uw of uwRows) {
        const list = userWarehousesMap.get(uw.user_id) || [];
        list.push({
          id: uw.warehouse_id,
          code: uw.warehouse_code,
          name: uw.warehouse_name,
          isPrimary: uw.is_primary,
        });
        userWarehousesMap.set(uw.user_id, list);
      }

      // Nạp thêm các kho mà user đang được gán trực tiếp làm manager_id
      try {
        const mgrRows = await this.dbService.query<{
          manager_id: string;
          id: string;
          code: string;
          name: string;
        }>(`SELECT manager_id, id, code, name FROM warehouses WHERE manager_id IS NOT NULL;`);
        for (const m of mgrRows) {
          const list = userWarehousesMap.get(m.manager_id) || [];
          if (!list.some((w) => w.id === m.id)) {
            list.push({
              id: m.id,
              code: m.code,
              name: m.name,
              isPrimary: list.length === 0,
            });
            userWarehousesMap.set(m.manager_id, list);
          }
        }
      } catch {}

      const rows = await this.dbService.query<{
        id: string;
        username: string;
        email: string;
        password_hash: string;
        full_name: string;
        phone: string | null;
        role_code: string;
        status: string;
        failed_attempts: number;
        locked_until: Date | null;
        created_at: Date;
        updated_at: Date;
        warehouse_id?: string;
        warehouse_name?: string;
        warehouse_code?: string;
      }>(
        `SELECT u.id, u.username, u.email, u.password_hash, u.full_name, u.phone,
                r.code as role_code, u.status, u.failed_attempts, u.locked_until,
                u.created_at, u.updated_at,
                COALESCE(w.id, wm.id) AS warehouse_id,
                COALESCE(w.name, wm.name) AS warehouse_name,
                COALESCE(w.code, wm.code) AS warehouse_code
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN user_warehouses uw ON uw.user_id = u.id AND uw.is_primary = true
         LEFT JOIN warehouses w ON w.id = uw.warehouse_id
         LEFT JOIN warehouses wm ON wm.manager_id = u.id;`,
      );

      const deletedSet = this.loadDeletedUsersFromDisk();

      for (const row of rows) {
        if (
          deletedSet.has(row.id.toLowerCase()) ||
          deletedSet.has(row.username.toLowerCase()) ||
          deletedSet.has(row.email.toLowerCase())
        ) {
          // Xóa triệt để khỏi PostgreSQL nếu còn tồn tại
          try {
            await this.dbService.query(`DELETE FROM refresh_tokens WHERE user_id = $1::uuid OR user_id::text = $1`, [row.id]);
            await this.dbService.query(`DELETE FROM user_warehouses WHERE user_id = $1::uuid OR user_id::text = $1`, [row.id]);
            await this.dbService.query(`UPDATE warehouses SET manager_id = NULL WHERE manager_id = $1::uuid OR manager_id::text = $1`, [row.id]);
            await this.dbService.query(`DELETE FROM audit_logs WHERE user_id = $1::uuid OR user_id::text = $1`, [row.id]);
            await this.dbService.query(`DELETE FROM users WHERE id = $1::uuid OR id::text = $1`, [row.id]);
          } catch {}
          continue;
        }

        const isManager =
          row.role_code === 'WAREHOUSE_MANAGER' || row.role_code === 'WH_MANAGER';
        const isKeeper =
          row.role_code === 'WAREHOUSE_KEEPER' || row.role_code === 'WAREHOUSE';

        const userWhList = userWarehousesMap.get(row.id) || [];
        let assignedWarehouses: Array<{
          id: string;
          code: string;
          name: string;
          isPrimary?: boolean;
        }> = [];
        let warehouseIds: string[] = [];
        let warehouseId: string | undefined = undefined;
        let warehouseCode: string | undefined = undefined;
        let warehouseName: string | undefined = undefined;

        if (isKeeper) {
          // QUAN HỆ 1 - 1 (One-to-One): Thủ kho bám sát duy nhất 1 kho tác nghiệp
          const single = userWhList.find((w) => w.isPrimary) || userWhList[0];
          if (single) {
            assignedWarehouses = [{ ...single, isPrimary: true }];
            warehouseIds = [single.id];
            warehouseId = single.id;
            warehouseCode = single.code;
            warehouseName = single.name;
          }
        } else if (isManager) {
          // QUAN HỆ N - N (Many-to-Many): Quản lý kho giám sát nhiều kho cùng lúc
          assignedWarehouses = userWhList;
          warehouseIds = userWhList.map((w) => w.id);
          const prim = userWhList.find((w) => w.isPrimary) || userWhList[0];
          if (prim) {
            warehouseId = prim.id;
            warehouseCode = prim.code;
            warehouseName = prim.name;
          }
        } else if (userWhList.length > 0) {
          assignedWarehouses = userWhList;
          warehouseIds = userWhList.map((w) => w.id);
          const prim = userWhList.find((w) => w.isPrimary) || userWhList[0];
          if (prim) {
            warehouseId = prim.id;
            warehouseCode = prim.code;
            warehouseName = prim.name;
          }
        }

        // Fallback resolve nếu chưa có trong user_warehouses
        if (!warehouseId && (row.warehouse_name || row.warehouse_code || row.warehouse_id)) {
          const whInfo = this.resolveWarehouseInfo(
            row.warehouse_name || row.warehouse_code || row.warehouse_id,
          );
          if (whInfo.warehouseId) {
            warehouseId = whInfo.warehouseId;
            warehouseCode = whInfo.warehouseCode;
            warehouseName = whInfo.warehouseName;
            assignedWarehouses = [
              {
                id: whInfo.warehouseId,
                code: whInfo.warehouseCode || '',
                name: whInfo.warehouseName || '',
                isPrimary: true,
              },
            ];
            warehouseIds = [whInfo.warehouseId];
          }
        }

        const warehouseStr = warehouseName
          ? warehouseName
          : undefined;

        // Xóa mọi bản ghi cũ trong Map có cùng username hoặc email nhưng id khác (tránh duplicate theo username/email nhưng khác ID)
        for (const [existingId, existingUser] of this.users.entries()) {
          if (
            existingId !== row.id &&
            (existingUser.username.toLowerCase() === row.username.toLowerCase() ||
             existingUser.email.toLowerCase() === row.email.toLowerCase())
          ) {
            this.users.delete(existingId);
          }
        }

        const entity = new UserEntity({
          id: row.id,
          username: row.username,
          email: row.email,
          fullName: row.full_name,
          phone: row.phone || undefined,
          role: (row.role_code as UserRole) || UserRole.SALES_REP,
          roles: [(row.role_code as UserRole) || UserRole.SALES_REP],
          status: (row.status as UserStatus) || UserStatus.ACTIVE,
          assignedWarehouse: warehouseStr,
          warehouseId,
          assignedWarehouseId: warehouseId,
          warehouseCode,
          assignedWarehouseCode: warehouseCode,
          warehouseIds,
          warehouses: assignedWarehouses,
          passwordHash: row.password_hash,
          failedAttempts: row.failed_attempts || 0,
          lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
          createdAt: new Date(row.created_at),
          updatedAt: new Date(row.updated_at),
        });
        this.users.set(entity.id, entity);
      }
    } catch (err) {
      console.warn('[USERS_SERVICE] Lỗi nạp users từ PostgreSQL:', err);
    }
  }


  public async saveUserToDatabase(user: UserEntity): Promise<void> {
    if (!this.dbService?.isConnected()) return;
    try {
      const roleIdMap: Record<string, number> = {
        ADMIN: 1,
        SALES_MANAGER: 2,
        SALES_REP: 3,
        WAREHOUSE_MANAGER: 4,
        WAREHOUSE_KEEPER: 5,
        ACCOUNTANT: 6,
        CUSTOMER: 7,
      };
      const roleId = roleIdMap[user.role] || 3;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id);
      const userId = isUuid ? user.id : crypto.randomUUID();

      await this.dbService.query(
        `INSERT INTO users (id, username, email, password_hash, full_name, phone, role_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (username) DO UPDATE
         SET email = EXCLUDED.email,
             full_name = EXCLUDED.full_name,
             phone = EXCLUDED.phone,
             role_id = EXCLUDED.role_id,
             status = EXCLUDED.status,
             updated_at = CURRENT_TIMESTAMP`,
        [
          userId,
          user.username,
          user.email,
          user.passwordHash,
          user.fullName,
          user.phone || null,
          roleId,
          user.status,
        ],
      );

      const isManager =
        user.roles?.includes(UserRole.WAREHOUSE_MANAGER) ||
        user.role === UserRole.WAREHOUSE_MANAGER;
      const isKeeper =
        user.roles?.includes(UserRole.WAREHOUSE_KEEPER) ||
        user.role === UserRole.WAREHOUSE_KEEPER;

      if (isKeeper) {
        // QUAN HỆ 1 - 1: Thủ kho chỉ gán duy nhất 1 kho tác nghiệp
        const whId =
          user.warehouseId ||
          user.assignedWarehouseId ||
          (user.warehouses && user.warehouses[0]?.id);

        if (whId) {
          try {
            await this.dbService.query(
              `DELETE FROM user_warehouses WHERE user_id = $1::uuid OR user_id::text = $1;`,
              [userId],
            );
            await this.dbService.query(
              `INSERT INTO user_warehouses (user_id, warehouse_id, is_primary)
               VALUES ($1, $2::uuid, true)
               ON CONFLICT (user_id, warehouse_id) DO UPDATE SET is_primary = true;`,
              [userId, whId],
            );
          } catch (kErr) {
            console.warn('[USERS_SERVICE] Lỗi gán kho thủ kho (1-1):', kErr);
          }
        }
      } else if (isManager) {
        // QUAN HỆ N - N: Quản lý kho có thể quản lý nhiều kho cùng lúc
        const targetIds: string[] = [];
        if (user.warehouseIds && user.warehouseIds.length > 0) {
          targetIds.push(...user.warehouseIds);
        } else if (user.warehouses && user.warehouses.length > 0) {
          targetIds.push(...user.warehouses.map((w) => w.id));
        } else if (user.assignedWarehouse) {
          const parts = user.assignedWarehouse.split(/[,;\n]+/);
          for (const p of parts) {
            const wh = this.resolveWarehouseInfo(p);
            if (wh.warehouseId && !targetIds.includes(wh.warehouseId)) {
              targetIds.push(wh.warehouseId);
            }
          }
        }

        if (targetIds.length > 0) {
          try {
            await this.dbService.query(
              `DELETE FROM user_warehouses WHERE user_id = $1::uuid OR user_id::text = $1;`,
              [userId],
            );
            for (let i = 0; i < targetIds.length; i++) {
              await this.dbService.query(
                `INSERT INTO user_warehouses (user_id, warehouse_id, is_primary)
                 VALUES ($1, $2::uuid, $3)
                 ON CONFLICT (user_id, warehouse_id) DO UPDATE SET is_primary = EXCLUDED.is_primary;`,
                [userId, targetIds[i], i === 0],
              );
            }
            await this.dbService.query(
              `UPDATE warehouses SET manager_id = $1 WHERE id = ANY($2::uuid[]);`,
              [userId, targetIds],
            );
          } catch (mErr) {
            console.warn('[USERS_SERVICE] Lỗi gán kho quản lý (N-N):', mErr);
          }
        }
      } else if (user.warehouseId) {
        // Vai trò khác nếu có gán kho
        try {
          await this.dbService.query(
            `INSERT INTO user_warehouses (user_id, warehouse_id, is_primary)
             VALUES ($1, $2::uuid, true)
             ON CONFLICT (user_id, warehouse_id) DO UPDATE SET is_primary = true;`,
            [userId, user.warehouseId],
          );
        } catch {}
      }
    } catch (dbErr) {
      console.warn('[USERS_SERVICE] Lỗi lưu user vào PostgreSQL:', dbErr);
    }
  }


  /**
   * Quét thư mục uploads/avatars/ và khôi phục avatarUrl cho user dựa trên tên file.
   * File avatar theo pattern: avatar-{userId}-{timestamp}-{hash}.{ext}
   * Nếu 1 user có nhiều file, chọn file mới nhất (theo thời gian chỉnh sửa).
   */
  private restoreAvatarsFromDisk(): void {
    try {
      const uploadDir = path.join(process.cwd(), 'uploads', 'avatars');
      if (!fs.existsSync(uploadDir)) {
        return;
      }

      const files = fs.readdirSync(uploadDir);
      // Map: userId -> { filename, mtime }
      const latestAvatarMap = new Map<string, { filename: string; mtime: number }>();

      for (const file of files) {
        // Bỏ qua .gitkeep và các file không phải avatar
        if (!file.startsWith('avatar-')) continue;

        // Parse userId từ tên file: avatar-{userId}-{timestamp}-{hash}.{ext}
        const parts = file.split('-');
        // userId có thể chứa dấu '-', ví dụ: usr-admin-001
        // Pattern: avatar-{userId}-{timestamp}-{hash}.ext
        // timestamp là số 13 chữ số, hash là 16 ký tự hex
        // Tìm timestamp bằng cách duyệt ngược từ cuối
        const fileWithoutExt = file.replace(/\.[^.]+$/, '');
        const allParts = fileWithoutExt.split('-');
        // Phần cuối: hash (16 hex), phần áp cuối: timestamp (13 digits)
        // => userId = các phần từ index 1 đến length-3
        if (allParts.length < 4) continue;

        const hash = allParts[allParts.length - 1];
        const timestamp = allParts[allParts.length - 2];

        // Validate timestamp (phải là số) và hash (phải là hex)
        if (!/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{16}$/.test(hash)) continue;

        const userId = allParts.slice(1, allParts.length - 2).join('-');
        if (!userId) continue;

        // Kiểm tra user có tồn tại trong Map không
        if (!this.users.has(userId)) continue;

        // Lấy thời gian chỉnh sửa file
        const filePath = path.join(uploadDir, file);
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;

        const existing = latestAvatarMap.get(userId);
        if (!existing || mtime > existing.mtime) {
          latestAvatarMap.set(userId, { filename: file, mtime });
        }
      }

      // Gán avatarUrl cho các user tìm thấy
      let restoredCount = 0;
      for (const [userId, { filename }] of latestAvatarMap) {
        const user = this.users.get(userId);
        if (user) {
          user.avatarUrl = `${AVATAR_URL_PREFIX}${filename}`;
          user.updatedAt = new Date();
          restoredCount++;
        }
      }

      if (restoredCount > 0) {
        console.log(
          `[UsersService] ✅ Đã khôi phục avatarUrl cho ${restoredCount} người dùng từ đĩa.`,
        );
      }
    } catch (error) {
      console.warn(
        '[UsersService] ⚠️ Không thể quét và khôi phục avatar từ đĩa:',
        error,
      );
    }
  }

  private static readonly EMAIL_ALIASES: Record<string, string> = {
    'quantrihethong@loha.vn': 'admin@loha.vn',
    'nhanvienkinhdoanh@loha.vn': 'sales@loha.vn',
    'quanlykinhdoanh@loha.vn': 'salesmanager@loha.vn',
    'thukho@loha.vn': 'warehouse@loha.vn',
    'quanlykho@loha.vn': 'warehousemanager@loha.vn',
    'ketoan@loha.vn': 'accountant@loha.vn',
    'ketoancongno@loha.vn': 'accountant@loha.vn',
  };

  /**
   * Lấy danh sách người dùng có hỗ trợ tìm kiếm, lọc và phân trang (GET /api/users)
   */
  async findAll(query: QueryUsersDto): Promise<PaginatedUsersResult> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 20));
    const search = query.search?.trim().toLowerCase();
    const role = query.role;
    const status = query.status;

    let userList = Array.from(this.users.values());

    // 1. Lọc theo từ khóa tìm kiếm (Tên, username, email, phone)
    if (search) {
      userList = userList.filter(
        (u) =>
          u.fullName.toLowerCase().includes(search) ||
          u.username.toLowerCase().includes(search) ||
          u.email.toLowerCase().includes(search) ||
          u.phone.toLowerCase().includes(search),
      );
    }

    // 2. Lọc theo Vai trò (Hỗ trợ kiểm tra cả trong mảng roles đa vai trò)
    if (role) {
      userList = userList.filter((u) => u.roles?.includes(role) || u.role === role);
    }

    // 3. Lọc theo Trạng thái
    if (status) {
      userList = userList.filter((u) => u.status === status);
    }

    // Sắp xếp người dùng mới nhất lên trước
    userList.sort((a, b) => {
      const timeA =
        a.createdAt instanceof Date
          ? a.createdAt.getTime()
          : new Date(a.createdAt || 0).getTime();
      const timeB =
        b.createdAt instanceof Date
          ? b.createdAt.getTime()
          : new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    const total = userList.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = userList.slice(startIndex, startIndex + limit);

    return {
      data: paginated.map((u) => u.toSafeUser()),
      total,
      page,
      limit,
      totalPages,
      summary: this.getSummary(),
    };
  }

  /**
   * Thống kê tổng số lượng nhân sự toàn hệ thống (không phụ thuộc phân trang limit/page)
   */
  getSummary(): UserSummaryStats {
    const allUsers = Array.from(this.users.values());
    const total = allUsers.length;
    const active = allUsers.filter((u) => u.status === UserStatus.ACTIVE).length;
    const locked = allUsers.filter((u) => u.status === UserStatus.LOCKED).length;
    const pendingReset = allUsers.filter((u) => Boolean(u.resetCode)).length;

    return {
      total,
      active,
      locked,
      pendingReset,
    };
  }

  async findByEmailOrUsername(identifier: string): Promise<UserEntity | null> {
    const rawNormalized = identifier.trim().toLowerCase();
    const normalizedIdentifier =
      UsersService.EMAIL_ALIASES[rawNormalized] || rawNormalized;

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

  async findSafeById(id: string): Promise<SafeUser> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng có ID: ${id}`);
    }
    return user.toSafeUser();
  }

  /**
   * Tạo mới tài khoản nhân sự (POST /api/users - SN-13 & SN-14):
   * - Hỗ trợ Đa vai trò (Multi-role): gán mảng roles
   * - Ràng buộc cứng: Nhân sự thuộc vai trò kho bắt buộc phải gắn với ít nhất một kho
   * - Kiểm tra trùng lặp username hoặc email: Trả về BadRequestException kèm thông báo cụ thể
   * - Tự động sinh mật khẩu tạm an toàn nếu không nhập
   * - Gửi email kích hoạt tài khoản kèm mật khẩu tạm thời cho nhân viên mới
   */
  async create(
    dto: CreateUserDto,
    options?: CreateUserOptions,
  ): Promise<CreateUserResult> {
    const username = dto.username.trim().toLowerCase();
    const email = dto.email.trim().toLowerCase();

    // 1. Kiểm tra trùng lặp username hoặc email trong hệ thống
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === username) {
        throw new BadRequestException(
          `Tên đăng nhập hoặc email đã tồn tại trên hệ thống: Tên đăng nhập "${dto.username}" đã được sử dụng.`,
        );
      }
      if (u.email.toLowerCase() === email) {
        throw new BadRequestException(
          `Tên đăng nhập hoặc email đã tồn tại trên hệ thống: Địa chỉ email "${dto.email}" đã được đăng ký.`,
        );
      }
    }

    // 2. Xác định danh sách vai trò (Hỗ trợ Đa vai trò - SN-14)
    let roles: UserRole[];
    if (dto.roles && dto.roles.length > 0) {
      roles = Array.from(new Set(dto.roles));
    } else if (dto.role) {
      roles = [dto.role];
    } else {
      throw new BadRequestException('Vai trò người dùng không được để trống.');
    }

    // 2.1. Rào chắn bảo mật: Chặn cứng tạo tài khoản Đại lý / Khách hàng B2B (CUSTOMER / AGENCY) qua API nhân sự
    const hasForbiddenRole = roles.some((r) => {
      const roleStr = String(r).toUpperCase();
      return roleStr === UserRole.CUSTOMER || roleStr === 'CUSTOMER' || roleStr === 'AGENCY';
    });

    if (hasForbiddenRole) {
      throw new BadRequestException(
        'Không được phép tạo tài khoản Đại lý / Khách hàng B2B qua tính năng quản lý nhân sự. Tài khoản Đại lý chỉ được cấp tự động thông qua quy trình tạo Hồ sơ Đại lý.',
      );
    }

    // 3. Ràng buộc cứng: Nhân sự thuộc vai trò kho bắt buộc phải gắn với ít nhất một kho
    const isWarehouseStaff =
      roles.includes(UserRole.WAREHOUSE_KEEPER) ||
      roles.includes(UserRole.WAREHOUSE_MANAGER);

    if (isWarehouseStaff && (!dto.assignedWarehouse || !dto.assignedWarehouse.trim())) {
      throw new BadRequestException(
        'Nhân sự thuộc vai trò kho (Thủ kho / Quản lý kho) bắt buộc phải được gắn với ít nhất một kho cụ thể.',
      );
    }

    // 4. Mật khẩu khởi tạo: sử dụng mật khẩu admin nhập hoặc tự sinh mật khẩu tạm ngẫu nhiên an toàn
    const rawPassword =
      dto.password?.trim() ||
      `Loha@${Math.floor(100000 + Math.random() * 900000)}`;
    const saltRounds = options?.saltRounds ?? BCRYPT_SALT_ROUNDS;
    const passwordHash = await bcrypt.hash(rawPassword, saltRounds);


    const isKeeperRole = roles.includes(UserRole.WAREHOUSE_KEEPER);
    const isManagerRole = roles.includes(UserRole.WAREHOUSE_MANAGER);

    let assignedWarehouseIds: string[] = [];
    if (dto.warehouseIds && dto.warehouseIds.length > 0) {
      assignedWarehouseIds = [...dto.warehouseIds];
    } else if (dto.warehouseId) {
      assignedWarehouseIds = [dto.warehouseId];
    } else if (dto.assignedWarehouse) {
      const parts = dto.assignedWarehouse.split(/[,;\n]+/);
      for (const p of parts) {
        const wh = this.resolveWarehouseInfo(p);
        if (wh.warehouseId && !assignedWarehouseIds.includes(wh.warehouseId)) {
          assignedWarehouseIds.push(wh.warehouseId);
        }
      }
    }

    // Thủ kho chỉ nhận duy nhất 1 kho (1 - 1)
    if (isKeeperRole && assignedWarehouseIds.length > 1) {
      assignedWarehouseIds = [assignedWarehouseIds[0]];
    }

    const assignedWarehouseObjects: Array<{
      id: string;
      code: string;
      name: string;
      isPrimary?: boolean;
    }> = [];

    for (let i = 0; i < assignedWarehouseIds.length; i++) {
      const wh = this.resolveWarehouseInfo(assignedWarehouseIds[i]);
      if (wh.warehouseId) {
        assignedWarehouseObjects.push({
          id: wh.warehouseId,
          code: wh.warehouseCode || '',
          name: wh.warehouseName || '',
          isPrimary: i === 0,
        });
      }
    }

    const primaryWh = assignedWarehouseObjects[0];
    const displayWarehouseName = assignedWarehouseObjects.map((w) => w.name).join(', ') || dto.assignedWarehouse?.trim();

    const newUser = new UserEntity({
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      username,
      email,
      fullName: dto.fullName.trim(),
      phone: dto.phone?.trim() || '',
      role: roles[0],
      roles,
      status: UserStatus.ACTIVE,
      assignedWarehouse: displayWarehouseName,
      warehouseId: primaryWh?.id,
      assignedWarehouseId: primaryWh?.id,
      warehouseCode: primaryWh?.code,
      assignedWarehouseCode: primaryWh?.code,
      warehouseIds: assignedWarehouseIds,
      warehouses: assignedWarehouseObjects,
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.users.set(newUser.id, newUser);
    if (!options?.skipDiskSync) {
      this.saveUsersToDisk();
      await this.saveUserToDatabase(newUser);
    }

    // 5. Gửi email kích hoạt tài khoản kèm mật khẩu tạm tới hộp thư nhân viên mới
    // Khi batch import hàng loạt (options?.skipEmail = true), bỏ qua gửi email để đạt hiệu năng siêu tốc, mật khẩu tạm được tổng hợp trong báo cáo cho Admin
    if (!options?.skipEmail) {
      if (this.mailService) {
        try {
          await this.mailService.sendAccountActivationEmail({
            to: newUser.email,
            fullName: newUser.fullName,
            username: newUser.username,
            temporaryPassword: rawPassword,
            role: roles.join(', '),
            assignedWarehouse: newUser.assignedWarehouse,
          });
        } catch (err) {
          console.warn(
            `[USERS_SERVICE] Lỗi gửi email kích hoạt tới ${newUser.email}:`,
            err,
          );
        }
      } else {
        console.log(
          `✉️ [ACCOUNT ACTIVATION SIMULATION] Đã kích hoạt tài khoản: ${newUser.fullName} (${newUser.email}) | Username: ${newUser.username} | Mật khẩu tạm: ${rawPassword}`,
        );
      }
    }

    return {
      user: newUser.toSafeUser(),
      temporaryPassword: rawPassword,
    };
  }

  /**
   * Lưu toàn bộ dữ liệu người dùng ra đĩa và cơ sở dữ liệu PostgreSQL (Dùng sau khi hoàn thành batch import)
   */
  public async flushUsersToDisk(): Promise<void> {
    this.saveUsersToDisk();
    if (this.dbService?.isConnected()) {
      for (const user of this.users.values()) {
        await this.saveUserToDatabase(user);
      }
    }
  }


  /**
   * Cập nhật thông tin người dùng (PATCH /api/users/:id - SN-13 & SN-14):
   * - Hỗ trợ cập nhật Đa vai trò (roles array)
   * - Bảo mật Admin: Chặn tuyệt đối hành động tự loại bỏ vai trò ADMIN của chính mình
   * - Ràng buộc cứng: Nhân sự thuộc vai trò kho bắt buộc phải gắn với ít nhất một kho cụ thể
   * - Kiểm tra trùng lặp email và username đối với các user khác
   */
  async update(
    id: string,
    dto: UpdateUserDto,
    currentAdmin?: { userId?: string; email?: string; username?: string; roles?: string[] } | string,
  ): Promise<SafeUser> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng có ID: ${id}`);
    }

    // 1. Kiểm tra Admin tự thu hồi quyền quản trị của chính mình
    const adminId = typeof currentAdmin === 'string' ? currentAdmin : currentAdmin?.userId;
    const adminEmail = typeof currentAdmin === 'object' ? currentAdmin?.email?.toLowerCase() : undefined;
    const adminUsername = typeof currentAdmin === 'object' ? currentAdmin?.username?.toLowerCase() : undefined;

    const isSelf =
      (adminId && (id === adminId || user.id === adminId)) ||
      (adminEmail && user.email.toLowerCase() === adminEmail) ||
      (adminUsername && user.username.toLowerCase() === adminUsername);

    let targetRoles: UserRole[] | undefined = undefined;
    if (dto.roles && dto.roles.length > 0) {
      targetRoles = Array.from(new Set(dto.roles));
    } else if (dto.role) {
      targetRoles = [dto.role];
    }

    if (isSelf && targetRoles) {
      if (!targetRoles.includes(UserRole.ADMIN)) {
        throw new BadRequestException('Bạn không thể tự thu hồi quyền Quản trị hệ thống của chính mình.');
      }
    }

    // 2. Ràng buộc cứng: Nhân sự thuộc vai trò kho bắt buộc gắn với ít nhất 1 kho cụ thể
    const effectiveRoles = targetRoles || user.roles || [user.role];
    const isWarehouseStaff =
      effectiveRoles.includes(UserRole.WAREHOUSE_KEEPER) ||
      effectiveRoles.includes(UserRole.WAREHOUSE_MANAGER);

    const effectiveWarehouse =
      dto.assignedWarehouse !== undefined
        ? dto.assignedWarehouse.trim()
        : user.assignedWarehouse;

    if (isWarehouseStaff && (!effectiveWarehouse || !effectiveWarehouse.trim())) {
      throw new BadRequestException(
        'Nhân sự thuộc vai trò kho (Thủ kho / Quản lý kho) bắt buộc phải được gắn với ít nhất một kho cụ thể.',
      );
    }

    // 3. Kiểm tra trùng lặp username
    if (dto.username) {
      const username = dto.username.trim().toLowerCase();
      for (const u of this.users.values()) {
        if (u.id !== id && u.username.toLowerCase() === username) {
          throw new BadRequestException(
            `Tên đăng nhập hoặc email đã tồn tại trên hệ thống: Tên đăng nhập "${dto.username}" đã thuộc về người dùng khác.`,
          );
        }
      }
      user.username = username;
    }

    // 4. Kiểm tra trùng lặp email
    if (dto.email) {
      const email = dto.email.trim().toLowerCase();
      for (const u of this.users.values()) {
        if (u.id !== id && u.email.toLowerCase() === email) {
          throw new BadRequestException(
            `Tên đăng nhập hoặc email đã tồn tại trên hệ thống: Địa chỉ email "${dto.email}" đã thuộc về người dùng khác.`,
          );
        }
      }
      user.email = email;
    }

    if (dto.fullName) {
      user.fullName = dto.fullName.trim();
    }

    if (dto.phone !== undefined) {
      user.phone = dto.phone.trim();
    }

    // Quản lý thông tin định danh cá nhân (Ngày sinh & Giới tính)
    if (user.isIdentityLocked) {
      if (
        (dto.dateOfBirth && dto.dateOfBirth !== user.dateOfBirth) ||
        (dto.gender && dto.gender !== user.gender)
      ) {
        throw new BadRequestException(
          'Thông tin Ngày sinh và Giới tính đã được xác thực định danh và khóa cố định, không thể thay đổi.',
        );
      }
    } else {
      if (dto.dateOfBirth !== undefined) {
        user.dateOfBirth = dto.dateOfBirth.trim() || null;
      }
      if (dto.gender !== undefined) {
        user.gender = dto.gender.trim() || null;
      }
      if (dto.isIdentityLocked) {
        user.isIdentityLocked = true;
      }
    }

    if (targetRoles) {
      user.roles = targetRoles;
      user.role = targetRoles[0];
    }

    if (
      dto.assignedWarehouse !== undefined ||
      dto.warehouseId !== undefined ||
      dto.warehouseIds !== undefined
    ) {
      const isKeeperRole = user.roles?.includes(UserRole.WAREHOUSE_KEEPER) || user.role === UserRole.WAREHOUSE_KEEPER;
      let assignedWarehouseIds: string[] = [];

      if (dto.warehouseIds && dto.warehouseIds.length > 0) {
        assignedWarehouseIds = [...dto.warehouseIds];
      } else if (dto.warehouseId) {
        assignedWarehouseIds = [dto.warehouseId];
      } else if (dto.assignedWarehouse !== undefined) {
        const parts = dto.assignedWarehouse.trim().split(/[,;\n]+/);
        for (const p of parts) {
          const wh = this.resolveWarehouseInfo(p);
          if (wh.warehouseId && !assignedWarehouseIds.includes(wh.warehouseId)) {
            assignedWarehouseIds.push(wh.warehouseId);
          }
        }
      }

      if (isKeeperRole && assignedWarehouseIds.length > 1) {
        assignedWarehouseIds = [assignedWarehouseIds[0]];
      }

      const assignedWarehouseObjects: Array<{
        id: string;
        code: string;
        name: string;
        isPrimary?: boolean;
      }> = [];

      for (let i = 0; i < assignedWarehouseIds.length; i++) {
        const wh = this.resolveWarehouseInfo(assignedWarehouseIds[i]);
        if (wh.warehouseId) {
          assignedWarehouseObjects.push({
            id: wh.warehouseId,
            code: wh.warehouseCode || '',
            name: wh.warehouseName || '',
            isPrimary: i === 0,
          });
        }
      }

      const primaryWh = assignedWarehouseObjects[0];
      user.warehouseId = primaryWh?.id;
      user.assignedWarehouseId = primaryWh?.id;
      user.warehouseCode = primaryWh?.code;
      user.assignedWarehouseCode = primaryWh?.code;
      user.warehouseIds = assignedWarehouseIds;
      user.warehouses = assignedWarehouseObjects;
      user.assignedWarehouse =
        assignedWarehouseObjects.map((w) => w.name).join(', ') ||
        dto.assignedWarehouse?.trim() ||
        user.assignedWarehouse;
    }

    if (dto.password) {
      user.passwordHash = bcrypt.hashSync(dto.password.trim(), BCRYPT_SALT_ROUNDS);
    }

    user.updatedAt = new Date();
    this.users.set(user.id, user);

    // Lưu dữ liệu cập nhật ra đĩa và PostgreSQL vĩnh viễn
    this.saveUsersToDisk();
    await this.saveUserToDatabase(user);

    return user.toSafeUser();
  }

  /**
   * Lấy danh sách đại lý phụ trách của nhân sự (SN-15)
   */
  getAssignedCustomers(userId: string): AssignedCustomerItem[] {
    const user = this.users.get(userId);
    const targetIds = new Set<string>([userId.toLowerCase()]);
    if (user) {
      targetIds.add(user.username.toLowerCase());
      if (user.username.toLowerCase() === 'sales') {
        targetIds.add('usr-sales-002');
      }
      if (user.username.toLowerCase() === 'salesmanager') {
        targetIds.add('usr-salesmgr-003');
      }
    }

    return Array.from(this.customers.values()).filter((c) =>
      targetIds.has(c.salesRepId.toLowerCase()),
    );
  }

  /**
   * Trả về kết quả truy vấn đại lý phụ trách kèm cảnh báo bàn giao (SN-15)
   */
  getAssignedCustomersResult(userId: string): {
    customers: AssignedCustomerItem[];
    total: number;
    warning?: string;
  } {
    const customers = this.getAssignedCustomers(userId);
    const warning =
      customers.length > 0
        ? `Nhân sự này đang phụ trách ${customers.length} đại lý. Sau khi khóa, hệ thống khuyến nghị bạn thực hiện chuyển giao địa bàn cho nhân viên kinh doanh khác.`
        : undefined;

    return {
      customers,
      total: customers.length,
      warning,
    };
  }

  /**
   * Khóa hoặc Mở khóa tài khoản (PATCH /api/users/:id/status - SN-15)
   * - Bắt buộc nhập lý do khi khóa tài khoản (ném 400 Bad Request nếu bỏ trống)
   * - Quản trị viên không thể tự khóa tài khoản của chính mình
   * - Khi khóa: Thu hồi toàn bộ Refresh Token / Session đang hoạt động tức thì
   * - Kiểm tra đại lý phụ trách khi khóa nhân sự kinh doanh và trả về cảnh báo bàn giao
   */
  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    currentAdmin?: { userId?: string; email?: string; username?: string } | string,
  ): Promise<UpdateUserStatusResult> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng có ID: ${id}`);
    }

    // 1. Kiểm tra lý do khóa tài khoản bắt buộc (SN-15)
    if (dto.status === UserStatus.LOCKED && (!dto.reason || !dto.reason.trim())) {
      throw new BadRequestException('Bắt buộc phải nhập lý do khi khóa tài khoản.');
    }

    // 2. Không cho phép quản trị viên tự khóa tài khoản của chính mình (kiểm tra theo ID, Email, hoặc Username)
    const adminId = typeof currentAdmin === 'string' ? currentAdmin : currentAdmin?.userId;
    const adminEmail = typeof currentAdmin === 'object' ? currentAdmin?.email?.toLowerCase() : undefined;
    const adminUsername = typeof currentAdmin === 'object' ? currentAdmin?.username?.toLowerCase() : undefined;

    const isSelf =
      (adminId && (id === adminId || user.id === adminId)) ||
      (adminEmail && user.email.toLowerCase() === adminEmail) ||
      (adminUsername && user.username.toLowerCase() === adminUsername);

    if (isSelf && dto.status === UserStatus.LOCKED) {
      throw new BadRequestException('Bạn không thể tự khóa tài khoản quản trị của chính mình.');
    }

    user.status = dto.status;
    user.lockReason = dto.reason ? dto.reason.trim() : null;
    user.updatedAt = new Date();

    if (dto.status === UserStatus.LOCKED) {
      // Tự động thu hồi toàn bộ token và phiên đăng nhập của user này
      this.revokeSessions(user.id);
    } else if (dto.status === UserStatus.ACTIVE) {
      user.failedAttempts = 0;
      user.lockedUntil = null;
      user.lockReason = null;
    }

    this.users.set(user.id, user);
    this.saveUsersToDisk();
    await this.saveUserToDatabase(user);

    // 3. Kiểm tra đại lý do nhân sự phụ trách khi khóa (SN-15)
    const assignedCustomers = this.getAssignedCustomers(user.id);
    const handoverWarning =
      dto.status === UserStatus.LOCKED && assignedCustomers.length > 0
        ? `Nhân sự này đang phụ trách ${assignedCustomers.length} đại lý. Sau khi khóa, hệ thống khuyến nghị bạn thực hiện chuyển giao địa bàn cho nhân viên kinh doanh khác.`
        : undefined;

    const safeUser = user.toSafeUser();
    return {
      ...safeUser,
      user: safeUser,
      assignedCustomers,
      assignedCustomersCount: assignedCustomers.length,
      handoverWarning,
      summary: this.getSummary(),
    };
  }

  /**
   * Admin sinh mã cấp đổi mật khẩu cho nhân sự (SN-10 Extension)
   * Mã này duy trì hiển thị cho đến khi nhân sự sử dụng để đổi mật khẩu thành công.
   */
  async generateResetCode(userId: string): Promise<{ resetCode: string; user: SafeUser }> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng có ID: ${userId}`);
    }

    // Sinh mã ngẫu nhiên 6 chữ số có tiền tố LH- (Ví dụ: LH-829401)
    const randomDigits = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCode = `LH-${randomDigits}`;

    user.resetCode = resetCode;
    user.resetCodeCreatedAt = new Date();
    user.updatedAt = new Date();
    this.users.set(user.id, user);
    this.saveUsersToDisk();

    return {
      resetCode,
      user: user.toSafeUser(),
    };
  }

  /**
   * Nhân sự sử dụng mã cấp từ Quản trị viên để đặt lại mật khẩu mới
   * Sau khi đổi thành công, mã cấp sẽ bị xóa và hủy toàn bộ phiên cũ.
   */
  async resetPasswordWithCode(
    identifier: string,
    resetCode: string,
    newPassword: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.findByEmailOrUsername(identifier);
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản nhân sự với thông tin đã cung cấp.');
    }

    if (user.status === UserStatus.LOCKED) {
      throw new BadRequestException(
        `Tài khoản đang bị khóa bởi Quản trị viên.${user.lockReason ? ' Lý do: ' + user.lockReason : ''} Vui lòng liên hệ Admin để mở khóa trước.`,
      );
    }

    if (!user.resetCode) {
      throw new BadRequestException('Tài khoản chưa được cấp mã đổi mật khẩu hoặc mã đã được sử dụng.');
    }

    const normalizedInputCode = resetCode.trim().toUpperCase();
    const normalizedUserCode = user.resetCode.trim().toUpperCase();

    if (normalizedInputCode !== normalizedUserCode) {
      throw new BadRequestException('Mã cấp đổi mật khẩu không chính xác.');
    }

    // Validate mật khẩu mới: tối thiểu 8 ký tự, có chữ và số
    if (!newPassword || newPassword.length < 8 || !/^(?=.*[A-Za-z])(?=.*\d).+$/.test(newPassword)) {
      throw new BadRequestException('Mật khẩu mới phải có ít nhất 8 ký tự, bao gồm cả chữ cái và chữ số.');
    }

    // Mã hóa mật khẩu mới
    const saltRounds = 10;
    user.passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Xóa mã cấp (Mã biến mất sau khi nhân sự đổi mật khẩu thành công)
    user.resetCode = null;
    user.resetCodeCreatedAt = null;
    user.failedAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = new Date();
    this.users.set(user.id, user);
    this.saveUsersToDisk();

    // Thu hồi toàn bộ phiên đăng nhập cũ
    this.revokeSessions(user.id);

    return {
      success: true,
      message: 'Đặt lại mật khẩu thành công. Bạn có thể đăng nhập ngay bằng mật khẩu mới.',
    };
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

  async updatePassword(userId: string, newPasswordHash: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) {
      return;
    }
    user.passwordHash = newPasswordHash;
    user.resetCode = null;
    user.resetCodeCreatedAt = null;
    user.failedAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = new Date();
  }

  /**
   * Tải lên và cập nhật ảnh đại diện người dùng (SN-144):
   * - Lưu trữ file ảnh an toàn trong thư mục uploads/avatars/
   * - Sinh tên file duy nhất (UUID/Timestamp + Hash) tránh trùng lặp và lộ tên gốc
   * - Tự động xóa file ảnh đại diện cũ trên đĩa nếu có để tránh rác dung lượng máy chủ
   * - Cập nhật avatarUrl trong UserEntity và cơ sở dữ liệu
   */
  async uploadAvatar(
    userId: string,
    file: Express.Multer.File,
  ): Promise<AvatarResponseDto> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(AVATAR_MESSAGES.USER_NOT_FOUND);
    }

    // 1. Đảm bảo thư mục lưu trữ uploads/avatars luôn tồn tại
    const uploadDir = path.join(process.cwd(), 'uploads', 'avatars');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // 2. Tạo tên file ngẫu nhiên, duy nhất
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const randomHash = crypto.randomBytes(8).toString('hex');
    const uniqueFileName = `avatar-${userId}-${Date.now()}-${randomHash}${ext}`;
    const targetFilePath = path.join(uploadDir, uniqueFileName);

    // 3. Ghi file từ memory buffer xuống đĩa lưu trữ
    await fs.promises.writeFile(targetFilePath, file.buffer);

    // 4. Nếu user đã có avatar cũ trước đó, tiến hành xóa file ảnh cũ để dọn dẹp bộ nhớ
    if (user.avatarUrl) {
      try {
        const oldFilename = path.basename(user.avatarUrl);
        const oldFilePath = path.join(uploadDir, oldFilename);
        if (fs.existsSync(oldFilePath)) {
          await fs.promises.unlink(oldFilePath);
        }
      } catch (error) {
        console.warn(
          `[UsersService] Không thể xóa file avatar cũ (${user.avatarUrl}):`,
          error,
        );
      }
    }

    // 5. Cập nhật đường dẫn avatarUrl vào thực thể người dùng
    const avatarUrl = `${AVATAR_URL_PREFIX}${uniqueFileName}`;
    user.avatarUrl = avatarUrl;
    user.updatedAt = new Date();
    this.users.set(user.id, user);

    return {
      statusCode: 200,
      message: AVATAR_MESSAGES.UPLOAD_SUCCESS,
      data: {
        avatarUrl,
      },
    };
  }

  /**
   * Xóa ảnh đại diện đưa về mặc định
   */
  async removeAvatar(userId: string): Promise<SafeUser> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(AVATAR_MESSAGES.USER_NOT_FOUND);
    }

    if (user.avatarUrl) {
      try {
        const uploadDir = path.join(process.cwd(), 'uploads', 'avatars');
        const oldFilename = path.basename(user.avatarUrl);
        const oldFilePath = path.join(uploadDir, oldFilename);
        if (fs.existsSync(oldFilePath)) {
          await fs.promises.unlink(oldFilePath);
        }
      } catch (error) {
        console.warn(
          `[UsersService] Không thể xóa file avatar (${user.avatarUrl}):`,
          error,
        );
      }
    }

    user.avatarUrl = null;
    user.updatedAt = new Date();
    this.users.set(user.id, user);

    return user.toSafeUser();
  }

  /**
   * Tạo tài khoản Đại lý B2B đồng bộ (gọi tự động từ CustomersService khi tạo đại lý mới)
   */
  async createDealerUser(data: {
    id: string;
    email: string;
    username: string;
    fullName: string;
    phone?: string;
    passwordHash: string;
    customerId?: string;
    customerCode?: string;
    status?: UserStatus;
  }): Promise<UserEntity> {
    const entity = new UserEntity({
      id: data.id,
      email: data.email,
      username: data.username,
      fullName: data.fullName,
      phone: data.phone || '',
      passwordHash: data.passwordHash,
      role: UserRole.CUSTOMER,
      roles: [UserRole.CUSTOMER],
      status: data.status || UserStatus.ACTIVE,
      customerId: data.customerId || null,
      customerCode: data.customerCode || null,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.users.set(entity.id, entity);
    this.saveUsersToDisk();

    if (this.dbService?.isConnected()) {
      await this.saveUserToDatabase(entity);
    }

    return entity;
  }

  /**
   * Xóa tài khoản người dùng theo ID hoặc Email (dùng khi xóa hồ sơ đại lý)
   */
  async deleteUserByIdOrEmail(userIdOrEmail: string): Promise<boolean> {
    const rawNormalized = (userIdOrEmail || '').trim().toLowerCase();
    if (!rawNormalized) return false;

    let targetUserId: string | null = null;
    for (const user of this.users.values()) {
      if (
        user.id.toLowerCase() === rawNormalized ||
        user.email.toLowerCase() === rawNormalized ||
        user.username.toLowerCase() === rawNormalized
      ) {
        targetUserId = user.id;
        break;
      }
    }

    if (!targetUserId) return false;

    this.users.delete(targetUserId);
    this.saveUsersToDisk();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `DELETE FROM users WHERE id::text = $1 OR LOWER(email) = $2 OR LOWER(username) = $2`,
          [targetUserId, rawNormalized],
        );
      } catch (err) {
        console.warn('[USERS_SERVICE] Lỗi xóa user khỏi DB:', err);
      }
    }

    return true;
  }

  /**
   * Xóa vĩnh viễn tài khoản người dùng khỏi hệ thống & cơ sở dữ liệu
   */
  async deleteUser(
    id: string,
    currentUser?: ICurrentUser,
  ): Promise<{ success: boolean; message: string; deletedId: string }> {
    const rawNormalized = (id || '').trim().toLowerCase();
    let targetUser: UserEntity | null = null;
    for (const u of this.users.values()) {
      if (
        u.id.toLowerCase() === rawNormalized ||
        u.username.toLowerCase() === rawNormalized ||
        u.email.toLowerCase() === rawNormalized
      ) {
        targetUser = u;
        break;
      }
    }

    if (!targetUser && this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<{
          id: string;
          username: string;
          email: string;
          full_name: string;
        }>(
          `SELECT id, username, email, full_name FROM users WHERE id::text = $1 OR LOWER(email) = $2 OR LOWER(username) = $3`,
          [id, rawNormalized, rawNormalized],
        );
        if (rows.length > 0) {
          targetUser = new UserEntity({
            id: rows[0].id,
            username: rows[0].username,
            email: rows[0].email,
            fullName: rows[0].full_name,
            role: UserRole.SALES_REP,
            status: UserStatus.ACTIVE,
          });
        }
      } catch {}
    }

    if (!targetUser) {
      throw new NotFoundException(`Không tìm thấy tài khoản người dùng với mã ID "${id}"`);
    }

    if (
      currentUser &&
      (currentUser.userId === targetUser.id ||
        currentUser.username?.toLowerCase() === targetUser.username.toLowerCase())
    ) {
      throw new BadRequestException('Bạn không thể tự xóa tài khoản của chính mình');
    }

    const targetUserId = targetUser.id;

    // Ghi nhận vào danh sách xóa vĩnh viễn (tombstone) để không bao giờ bị khôi phục lại khi restart backend
    this.recordDeletedUser({
      id: targetUserId,
      username: targetUser.username,
      email: targetUser.email,
    });

    // 1. Xóa khỏi in-memory Map & file disk
    this.users.delete(targetUserId);
    this.users.delete(targetUser.id);
    this.saveUsersToDisk();

    // 2. Xóa triệt để khỏi database
    if (this.dbService?.isConnected()) {
      try {
        // Tìm toàn bộ ID liên quan trong DB
        const dbUserIds: string[] = [targetUserId, targetUser.id];
        try {
          const pgUsers = await this.dbService.query<{ id: string }>(
            `SELECT id FROM users WHERE id::text = $1 OR LOWER(email) = $2 OR LOWER(username) = $3`,
            [targetUserId, targetUser.email.toLowerCase(), targetUser.username.toLowerCase()],
          );
          for (const pu of pgUsers) {
            dbUserIds.push(pu.id);
            this.recordDeletedUser({
              id: pu.id,
              username: targetUser.username,
              email: targetUser.email,
            });
          }
        } catch {}

        const uniqueUids = Array.from(new Set(dbUserIds.filter(Boolean)));

        for (const uid of uniqueUids) {
          try {
            await this.dbService.query(
              `DELETE FROM refresh_tokens WHERE user_id = $1::uuid OR user_id::text = $1`,
              [uid],
            );
          } catch {}
          try {
            await this.dbService.query(
              `DELETE FROM user_warehouses WHERE user_id = $1::uuid OR user_id::text = $1`,
              [uid],
            );
          } catch {}
          try {
            await this.dbService.query(
              `UPDATE warehouses SET manager_id = NULL WHERE manager_id = $1::uuid OR manager_id::text = $1`,
              [uid],
            );
          } catch {}
          try {
            await this.dbService.query(
              `DELETE FROM order_approvals WHERE approver_id = $1::uuid OR approver_id::text = $1`,
              [uid],
            );
          } catch {}
          try {
            await this.dbService.query(
              `DELETE FROM audit_logs WHERE user_id = $1::uuid OR user_id::text = $1`,
              [uid],
            );
          } catch {}
          try {
            await this.dbService.query(
              `UPDATE customers SET sales_rep_id = NULL WHERE sales_rep_id = $1::uuid OR sales_rep_id::text = $1`,
              [uid],
            );
          } catch {}
          try {
            await this.dbService.query(
              `UPDATE customers SET user_id = NULL WHERE user_id = $1::uuid OR user_id::text = $1`,
              [uid],
            );
          } catch {}
          try {
            await this.dbService.query(
              `UPDATE orders SET sales_rep_id = NULL WHERE sales_rep_id = $1::uuid OR sales_rep_id::text = $1`,
              [uid],
            );
          } catch {}
          try {
            await this.dbService.query(
              `DELETE FROM users WHERE id = $1::uuid OR id::text = $1`,
              [uid],
            );
          } catch {}
        }

        try {
          await this.dbService.query(
            `DELETE FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2`,
            [targetUser.email.toLowerCase(), targetUser.username.toLowerCase()],
          );
        } catch {}
      } catch (err) {
        console.warn('[USERS_SERVICE] Lỗi xóa user khỏi DB:', err);
      }
    }

    return {
      success: true,
      message: `Đã xóa vĩnh viễn tài khoản ${targetUser.fullName} (${targetUser.username}) khỏi hệ thống và cơ sở dữ liệu`,
      deletedId: targetUserId,
    };
  }

  /**
   * Đồng bộ trạng thái tài khoản người dùng (ACTIVE, LOCKED, INACTIVE)
   */
  async syncUserStatus(
    userIdOrEmail: string,
    status: UserStatus,
    lockReason?: string,
  ): Promise<void> {
    const rawNormalized = (userIdOrEmail || '').trim().toLowerCase();
    if (!rawNormalized) return;

    let targetUser: UserEntity | null = null;
    for (const user of this.users.values()) {
      if (
        user.id.toLowerCase() === rawNormalized ||
        user.email.toLowerCase() === rawNormalized ||
        user.username.toLowerCase() === rawNormalized
      ) {
        targetUser = user;
        break;
      }
    }

    if (!targetUser) return;

    targetUser.status = status;
    if (lockReason !== undefined) {
      targetUser.lockReason = lockReason;
    }
    targetUser.updatedAt = new Date();
    this.users.set(targetUser.id, targetUser);
    this.saveUsersToDisk();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE users SET status = $1, updated_at = NOW()
           WHERE id::text = $2 OR LOWER(email) = $3`,
          [status, targetUser.id, rawNormalized],
        );
      } catch (err) {
        // Fallback in-memory
      }
    }
  }
}

