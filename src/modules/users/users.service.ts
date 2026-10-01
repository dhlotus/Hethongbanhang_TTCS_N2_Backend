import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { BCRYPT_SALT_ROUNDS } from '../../common/constants/auth.constant';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import {
  CreateUserDto,
  QueryUsersDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto';
import { SafeUser, UserEntity } from './entities/user.entity';

export interface PaginatedUsersResult {
  data: SafeUser[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateUserResult {
  user: SafeUser;
  temporaryPassword?: string;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private users: Map<string, UserEntity> = new Map();
  private sessionRevoker?: (userId: string) => void;

  constructor() {
    this.seedInitialUsersSync();
  }

  async onModuleInit(): Promise<void> {
    if (this.users.size === 0) {
      this.seedInitialUsersSync();
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
        fullName: 'Trần Văn Nam (Nhân Viên Kinh Doanh)',
        phone: '0923456789',
        role: UserRole.SALES_REP,
        status: UserStatus.ACTIVE,
        assignedWarehouse: 'Địa bàn TP. Hồ Chí Minh',
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
      },
      {
        id: 'usr-salesmgr-003',
        email: 'salesmanager@loha.vn',
        username: 'salesmanager',
        fullName: 'Lê Hoàng Trưởng Phòng (Quản Lý Kinh Doanh)',
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
        id: 'usr-cust-007',
        email: 'dealer@loha.vn',
        username: 'dealer',
        fullName: 'Đại Lý Cửa Hàng Minh Khang (B2B)',
        phone: '0978901234',
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

  private static readonly EMAIL_ALIASES: Record<string, string> = {
    'quantrihethong@loha.vn': 'admin@loha.vn',
    'nhanvienkinhdoanh@loha.vn': 'sales@loha.vn',
    'quanlykinhdoanh@loha.vn': 'salesmanager@loha.vn',
    'thukho@loha.vn': 'warehouse@loha.vn',
    'quanlykho@loha.vn': 'warehousemanager@loha.vn',
    'ketoan@loha.vn': 'accountant@loha.vn',
    'ketoancongno@loha.vn': 'accountant@loha.vn',
    'daily@loha.vn': 'dealer@loha.vn',
    'khachhang@loha.vn': 'dealer@loha.vn',
  };

  /**
   * Lấy danh sách người dùng có hỗ trợ tìm kiếm, lọc và phân trang (GET /api/users)
   */
  async findAll(query: QueryUsersDto): Promise<PaginatedUsersResult> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 10));
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
          u.phone.includes(search),
      );
    }

    // 2. Lọc theo Vai trò
    if (role) {
      userList = userList.filter((u) => u.role === role);
    }

    // 3. Lọc theo Trạng thái
    if (status) {
      userList = userList.filter((u) => u.status === status);
    }

    // Sắp xếp người dùng mới nhất lên trước
    userList.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

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
   * Tạo mới tài khoản nhân sự (POST /api/users)
   */
  async create(dto: CreateUserDto): Promise<CreateUserResult> {
    const username = dto.username.trim().toLowerCase();
    const email = dto.email.trim().toLowerCase();

    // Kiểm tra trùng username hoặc email
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === username) {
        throw new BadRequestException(`Tên đăng nhập "${dto.username}" đã tồn tại trong hệ thống.`);
      }
      if (u.email.toLowerCase() === email) {
        throw new BadRequestException(`Địa chỉ email "${dto.email}" đã được đăng ký.`);
      }
    }

    // Mật khẩu khởi tạo: sử dụng mật khẩu admin nhập hoặc tự sinh mặc định
    const rawPassword = dto.password?.trim() || 'Loha@2026';
    const passwordHash = bcrypt.hashSync(rawPassword, BCRYPT_SALT_ROUNDS);

    const newUser = new UserEntity({
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      username,
      email,
      fullName: dto.fullName.trim(),
      phone: dto.phone?.trim() || '',
      role: dto.role,
      status: UserStatus.ACTIVE,
      assignedWarehouse: dto.assignedWarehouse?.trim(),
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.users.set(newUser.id, newUser);

    return {
      user: newUser.toSafeUser(),
      temporaryPassword: dto.password ? undefined : rawPassword,
    };
  }

  /**
   * Cập nhật thông tin người dùng (PATCH /api/users/:id)
   */
  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng có ID: ${id}`);
    }

    if (dto.email) {
      const email = dto.email.trim().toLowerCase();
      for (const u of this.users.values()) {
        if (u.id !== id && u.email.toLowerCase() === email) {
          throw new BadRequestException(`Địa chỉ email "${dto.email}" đã thuộc về người dùng khác.`);
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

    if (dto.role) {
      user.role = dto.role;
    }

    if (dto.assignedWarehouse !== undefined) {
      user.assignedWarehouse = dto.assignedWarehouse.trim();
    }

    if (dto.password) {
      user.passwordHash = bcrypt.hashSync(dto.password.trim(), BCRYPT_SALT_ROUNDS);
    }

    user.updatedAt = new Date();
    this.users.set(user.id, user);

    return user.toSafeUser();
  }

  /**
   * Khóa hoặc Mở khóa tài khoản (PATCH /api/users/:id/status)
   * Khi khóa: Thu hồi toàn bộ Refresh Token / Session đang hoạt động
   */
  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    currentAdmin?: { userId?: string; email?: string; username?: string } | string,
  ): Promise<SafeUser> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`Không tìm thấy người dùng có ID: ${id}`);
    }

    // Không cho phép quản trị viên tự khóa tài khoản của chính mình (kiểm tra theo ID, Email, hoặc Username)
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
    user.lockReason = dto.reason.trim();
    user.updatedAt = new Date();

    if (dto.status === UserStatus.LOCKED) {
      // Tự động thu hồi toàn bộ token và phiên đăng nhập của user này
      this.revokeSessions(user.id);
    } else if (dto.status === UserStatus.ACTIVE) {
      user.failedAttempts = 0;
      user.lockedUntil = null;
    }

    this.users.set(user.id, user);
    return user.toSafeUser();
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
}
