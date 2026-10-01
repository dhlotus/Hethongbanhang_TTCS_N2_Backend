import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { BCRYPT_SALT_ROUNDS } from '../../common/constants/auth.constant';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { MailService } from '../mail/mail.service';
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

  constructor(@Optional() private readonly mailService?: MailService) {
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
   * Tạo mới tài khoản nhân sự (POST /api/users - SN-13 & SN-14):
   * - Hỗ trợ Đa vai trò (Multi-role): gán mảng roles
   * - Ràng buộc cứng: Nhân sự thuộc vai trò kho bắt buộc phải gắn với ít nhất một kho
   * - Kiểm tra trùng lặp username hoặc email: Trả về BadRequestException kèm thông báo cụ thể
   * - Tự động sinh mật khẩu tạm an toàn nếu không nhập
   * - Gửi email kích hoạt tài khoản kèm mật khẩu tạm thời cho nhân viên mới
   */
  async create(dto: CreateUserDto): Promise<CreateUserResult> {
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
    const passwordHash = bcrypt.hashSync(rawPassword, BCRYPT_SALT_ROUNDS);

    const newUser = new UserEntity({
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      username,
      email,
      fullName: dto.fullName.trim(),
      phone: dto.phone?.trim() || '',
      role: roles[0],
      roles,
      status: UserStatus.ACTIVE,
      assignedWarehouse: dto.assignedWarehouse?.trim(),
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.users.set(newUser.id, newUser);

    // 5. Gửi email kích hoạt tài khoản kèm mật khẩu tạm tới hộp thư nhân viên mới
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

    return {
      user: newUser.toSafeUser(),
      temporaryPassword: rawPassword,
    };
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

    if (targetRoles) {
      user.roles = targetRoles;
      user.role = targetRoles[0];
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
