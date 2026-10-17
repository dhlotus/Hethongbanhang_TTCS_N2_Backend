import { Injectable, OnModuleInit, Optional, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditAction, AuditEntity } from '../../common/enums';
import { UsersService } from '../users/users.service';
import { DatabaseService } from '../../database/database.service';
import { CreateAuditLogDto, QueryAuditLogsDto } from './dto';
import { AuditLogEntity, AuditLogUserInfo } from './entities/audit-log.entity';

export interface PaginatedAuditLogsResult {
  data: AuditLogEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Service quản lý Nhật ký Kiểm toán hệ thống (Audit Logs - SN-19):
 * - Đảm bảo dữ liệu bất biến (Append-only)
 * - Tự động liên kết với thực thể Users để trả về đầy đủ thông tin người thực hiện
 * - Hỗ trợ lọc theo thời gian, người dùng, phân hệ, hành động và phân trang
 * - Đồng bộ trực tiếp PostgreSQL table audit_logs khi có kết nối
 */
@Injectable()
export class AuditLogsService implements OnModuleInit {
  private auditLogs: AuditLogEntity[] = [];

  constructor(
    private readonly usersService: UsersService,
    @Optional() private readonly dbService?: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<{
          id: string;
          user_id: string;
          action: AuditAction;
          entity_name: AuditEntity;
          entity_id: string;
          old_values: Record<string, unknown> | null;
          new_values: Record<string, unknown> | null;
          ip_address: string;
          created_at: Date;
        }>(
          `SELECT id, user_id, action, entity_name, entity_id, old_values, new_values, ip_address, created_at
           FROM audit_logs
           ORDER BY created_at DESC
           LIMIT 200;`,
        );

        if (rows && rows.length > 0) {
          this.auditLogs = rows.map(
            (r) =>
              new AuditLogEntity({
                id: r.id,
                user_id: r.user_id,
                action: r.action,
                entity_name: r.entity_name,
                entity_id: r.entity_id,
                old_values: r.old_values,
                new_values: r.new_values,
                ip_address: r.ip_address,
                created_at: new Date(r.created_at),
              }),
          );
        }
      } catch {
        // Fallback
      }
    }

    if (this.auditLogs.length === 0) {
      this.seedInitialAuditLogs();
    }
  }

  /**
   * Khởi tạo dữ liệu mẫu ban đầu bám sát các nghiệp vụ thực tế của OMS/WMS LOHA SALES
   */
  private seedInitialAuditLogs(): void {
    const adminUser = 'usr-admin-001';
    const warehouseUser = 'usr-wh-004';
    const salesManagerUser = 'usr-salesmgr-003';
    const accountantUser = 'usr-acc-006';

    const initialSeeds: Partial<AuditLogEntity>[] = [
      {
        id: randomUUID(),
        user_id: warehouseUser,
        action: AuditAction.STOCK_ADJUST,
        entity_name: AuditEntity.INVENTORY,
        entity_id: 'LH-MILK-900G',
        old_values: {
          sku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
          stockQuantity: 340,
          warehouseLocation: 'Kệ A02-Ô 04 (Kho Tổng Miền Nam)',
          lotNumber: 'LOT-2026-09-A1',
          expiryDate: '2027-09-30',
        },
        new_values: {
          sku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
          stockQuantity: 360,
          quantityChange: 20,
          reason: 'Kiểm kê định kỳ cuối tháng - Bù số lượng thực tế tại kệ A02',
          warehouseLocation: 'Kệ A02-Ô 04 (Kho Tổng Miền Nam)',
          lotNumber: 'LOT-2026-09-A1',
          expiryDate: '2027-09-30',
        },
        ip_address: '192.168.1.45',
        summary: 'Điều chỉnh tăng 20 hộp tồn kho thực tế SKU LH-MILK-900G sau kiểm kê',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 4), // 4 giờ trước
      },
      {
        id: randomUUID(),
        user_id: salesManagerUser,
        action: AuditAction.UPDATE,
        entity_name: AuditEntity.DEBT,
        entity_id: 'CUST-B2B-0089',
        old_values: {
          customerCode: 'CUST-B2B-0089',
          customerName: 'Đại Lý Phân Phối Sữa Miền Đông - Hoàng Gia',
          creditLimit: 500000000,
          creditTermDays: 30,
          debtLimitStatus: 'NORMAL',
          currentDebt: 320000000,
        },
        new_values: {
          customerCode: 'CUST-B2B-0089',
          customerName: 'Đại Lý Phân Phối Sữa Miền Đông - Hoàng Gia',
          creditLimit: 700000000,
          creditTermDays: 45,
          debtLimitStatus: 'NORMAL',
          currentDebt: 320000000,
          reason: 'Tăng hạn mức công nợ quý 4 theo kết quả doanh số đạt chuẩn VIP',
        },
        ip_address: '192.168.1.18',
        summary: 'Nâng hạn mức công nợ từ 500.000.000 đ lên 700.000.000 đ cho Đại Lý Hoàng Gia',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 18), // 18 giờ trước
      },
      {
        id: randomUUID(),
        user_id: adminUser,
        action: AuditAction.UPDATE,
        entity_name: AuditEntity.PRICING,
        entity_id: 'PRICE-BOOK-B2B-T10',
        old_values: {
          policyCode: 'PB-RETAIL-GOLD',
          sku: 'LH-NUT-180ML',
          unitPrice: 16500,
          discountPercent: 5,
          status: 'ACTIVE',
        },
        new_values: {
          policyCode: 'PB-RETAIL-GOLD',
          sku: 'LH-NUT-180ML',
          unitPrice: 18000,
          discountPercent: 7,
          status: 'ACTIVE',
          reason: 'Điều chỉnh giá niêm yết và chiết khấu bậc thang theo biến động nguyên liệu nhập khẩu',
        },
        ip_address: '118.69.182.24',
        summary: 'Cập nhật giá bán niêm yết SKU LH-NUT-180ML lên 18.000 đ và chiết khấu 7%',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 36), // 1.5 ngày trước
      },
      {
        id: randomUUID(),
        user_id: accountantUser,
        action: AuditAction.APPROVE,
        entity_name: AuditEntity.ORDER,
        entity_id: 'ORD-202610-0042',
        old_values: {
          orderCode: 'ORD-202610-0042',
          orderStatus: 'PENDING',
          totalAmount: 145000000,
          paymentMethod: 'DEBT',
          customerId: 'CUST-B2B-0089',
        },
        new_values: {
          orderCode: 'ORD-202610-0042',
          orderStatus: 'APPROVED',
          totalAmount: 145000000,
          paymentMethod: 'DEBT',
          customerId: 'CUST-B2B-0089',
          approvalNote: 'Phê duyệt xuất kho theo bảo lãnh hạn mức công nợ còn hiệu lực',
        },
        ip_address: '192.168.1.33',
        summary: 'Phê duyệt đơn hàng bán buôn ORD-202610-0042 trị giá 145.000.000 đ',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 50), // 2 ngày trước
      },
      {
        id: randomUUID(),
        user_id: adminUser,
        action: AuditAction.UPDATE,
        entity_name: AuditEntity.USER,
        entity_id: 'usr-sales-002',
        old_values: {
          username: 'sales',
          fullName: 'Trần Thị Thu (Nhân Viên Kinh Doanh)',
          status: 'ACTIVE',
          isLocked: false,
          lockReason: null,
        },
        new_values: {
          username: 'sales',
          fullName: 'Trần Thị Thu (Nhân Viên Kinh Doanh)',
          status: 'LOCKED',
          isLocked: true,
          lockReason: 'Nghỉ thai sản - Tạm thời bàn giao đại lý quản lý cho Quản lý kinh doanh',
        },
        ip_address: '118.69.182.24',
        summary: 'Khóa tài khoản nhân viên kinh doanh sales và thu hồi toàn bộ phiên đăng nhập',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 72), // 3 ngày trước
      },
      {
        id: randomUUID(),
        user_id: warehouseUser,
        action: AuditAction.STOCK_ADJUST,
        entity_name: AuditEntity.INVENTORY,
        entity_id: 'LH-NEST-70ML',
        old_values: {
          sku: 'LH-NEST-70ML',
          productName: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
          stockQuantity: 180,
          warehouseLocation: 'Kệ B01-Ô 02',
        },
        new_values: {
          sku: 'LH-NEST-70ML',
          productName: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
          stockQuantity: 175,
          quantityChange: -5,
          reason: 'Xuất hủy 5 hũ vỡ nứt bao bì trong quá trình bốc dỡ',
        },
        ip_address: '192.168.1.45',
        summary: 'Điều chỉnh giảm 5 hũ tồn kho SKU LH-NEST-70ML do hỏng nứt bao bì',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 96), // 4 ngày trước
      },
    ];

    for (const item of initialSeeds) {
      this.auditLogs.push(new AuditLogEntity(item));
    }
  }

  /**
   * Ghi nhận một bản ghi Audit Log mới (Append-only, Bất biến)
   */
  async recordLog(dto: CreateAuditLogDto): Promise<AuditLogEntity> {
    const logItem = new AuditLogEntity({
      id: randomUUID(),
      user_id: dto.userId,
      action: dto.action,
      entity_name: dto.entityName,
      entity_id: dto.entityId,
      old_values: dto.oldValues ?? null,
      new_values: dto.newValues ?? null,
      ip_address: dto.ipAddress || '127.0.0.1',
      summary: dto.summary,
      created_at: new Date(),
    });

    // Append-only: Thêm vào đầu danh sách để truy vấn mới nhất trước
    this.auditLogs.unshift(logItem);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_name, entity_id, old_values, new_values, ip_address, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING;`,
          [
            logItem.id,
            logItem.user_id,
            logItem.action,
            logItem.entity_name,
            logItem.entity_id,
            logItem.old_values ? JSON.stringify(logItem.old_values) : null,
            logItem.new_values ? JSON.stringify(logItem.new_values) : null,
            logItem.ip_address,
            logItem.created_at,
          ],
        );
      } catch {
        // Fallback an toàn không làm gián đoạn luồng nghiệp vụ
      }
    }

    return logItem;
  }

  /**
   * Lấy thông tin user liên kết (JOIN) từ UsersService
   */
  private async joinUserInfo(log: AuditLogEntity): Promise<AuditLogUserInfo> {
    try {
      let user = await this.usersService.findById(log.user_id);
      if (!user) {
        const allUsers = (await this.usersService.findAll({ limit: 200 })).data;
        user = allUsers.find(
          (u) =>
            u.id.toLowerCase() === log.user_id?.toLowerCase() ||
            u.username.toLowerCase() === log.user_id?.toLowerCase() ||
            (log.user_id === 'usr-sm-003' && u.id === 'usr-salesmgr-003'),
        ) as any;
      }

      if (user) {
        return {
          id: user.id,
          full_name: user.fullName,
          email: user.email,
          role: (user.roles && user.roles[0]) || user.role || 'ADMIN',
          ip_address: log.ip_address,
          avatarUrl: user.avatarUrl ?? null,
          avatar_url: user.avatarUrl ?? null,
        };
      }
    } catch {
      // Ignored
    }

    return {
      id: log.user_id,
      full_name: 'Người dùng hệ thống',
      email: '',
      role: 'ADMIN',
      ip_address: log.ip_address,
      avatarUrl: null,
      avatar_url: null,
    };
  }

  /**
   * Truy vấn danh sách Audit Logs có hỗ trợ bộ lọc và phân trang (GET /api/audit-logs)
   * - Khi PostgreSQL có kết nối: Chạy câu lệnh SQL trực tiếp (JOIN users & roles) với ILIKE và WHERE
   * - Khi chạy cục bộ/fallback: Tìm kiếm toàn diện trên dữ liệu bộ nhớ bao gồm cả trường JSONB
   */
  async findAll(query: QueryAuditLogsDto): Promise<PaginatedAuditLogsResult> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));

    const getCleanDatePart = (str?: string): string | null => {
      if (!str) return null;
      const match = str.trim().match(/^\d{4}-\d{2}-\d{2}/);
      return match ? match[0] : null;
    };

    const getVietnamDateStr = (date: Date | string): string => {
      try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
      } catch {
        return new Date(date).toISOString().slice(0, 10);
      }
    };

    // 1. TRUY VẤN TRỰC TIẾP TỪ CƠ SỞ DỮ LIỆU POSTGRESQL (NẾU KẾT NỐI SẴN SÀNG)
    if (this.dbService?.isConnected()) {
      try {
        const whereClauses: string[] = ['1=1'];
        const params: unknown[] = [];
        let paramIdx = 1;

        // Chuẩn hóa và lọc theo khoảng thời gian múi giờ Việt Nam (UTC+7)
        const cleanStart = getCleanDatePart(query.startDate || query.date_from);
        if (cleanStart) {
          whereClauses.push(`(a.created_at AT TIME ZONE '+07:00')::date >= $${paramIdx++}::date`);
          params.push(cleanStart);
        }

        const cleanEnd = getCleanDatePart(query.endDate || query.date_to);
        if (cleanEnd) {
          whereClauses.push(`(a.created_at AT TIME ZONE '+07:00')::date <= $${paramIdx++}::date`);
          params.push(cleanEnd);
        }

        // Lọc theo người thực hiện (userId, username hoặc tên nhân viên)
        if (query.userId && query.userId !== 'ALL') {
          whereClauses.push(`(
            a.user_id::text = $${paramIdx} OR
            u.username ILIKE $${paramIdx} OR
            u.full_name ILIKE $${paramIdx}
          )`);
          params.push(query.userId.trim());
          paramIdx++;
        }

        // Lọc theo phân hệ nghiệp vụ tác động
        const targetEntity = query.entityName || query.entity || query.module;
        if (targetEntity && targetEntity !== 'ALL') {
          whereClauses.push(`UPPER(a.entity_name) = UPPER($${paramIdx++})`);
          params.push(targetEntity);
        }

        // Lọc theo loại hành động
        if (query.action && query.action !== 'ALL') {
          whereClauses.push(`UPPER(a.action) = UPPER($${paramIdx++})`);
          params.push(query.action);
        }

        // Tìm kiếm tự do theo tên người thực hiện (fullName), username, email, IP hoặc nội dung
        const searchKeyword = (query.searchUser || query.search || query.q)?.trim();
        if (searchKeyword) {
          const searchPattern = `%${searchKeyword}%`;
          whereClauses.push(`(
            u.full_name ILIKE $${paramIdx} OR
            u.username ILIKE $${paramIdx} OR
            u.email ILIKE $${paramIdx} OR
            a.user_id::text ILIKE $${paramIdx} OR
            a.entity_id ILIKE $${paramIdx} OR
            a.ip_address ILIKE $${paramIdx} OR
            a.old_values::text ILIKE $${paramIdx} OR
            a.new_values::text ILIKE $${paramIdx}
          )`);
          params.push(searchPattern);
          paramIdx++;
        }

        const whereSql = whereClauses.join(' AND ');

        // Đếm tổng số bản ghi khớp điều kiện
        const countResult = await this.dbService.query<{ total: string }>(
          `SELECT COUNT(*) AS total
           FROM audit_logs a
           LEFT JOIN users u ON a.user_id = u.id
           WHERE ${whereSql};`,
          params,
        );
        const total = parseInt(countResult[0]?.total || '0', 10);
        const totalPages = Math.ceil(total / limit) || 1;
        const offset = (page - 1) * limit;

        // Lấy danh sách bản ghi theo trang
        const dataRows = await this.dbService.query<{
          id: string;
          user_id: string;
          action: AuditAction;
          entity_name: AuditEntity;
          entity_id: string;
          old_values: Record<string, unknown> | null;
          new_values: Record<string, unknown> | null;
          ip_address: string;
          summary?: string;
          created_at: Date;
          user_full_name?: string;
          user_email?: string;
          user_role?: string;
          user_avatar_url?: string;
        }>(
          `SELECT 
             a.id,
             a.user_id,
             a.action,
             a.entity_name,
             a.entity_id,
             a.old_values,
             a.new_values,
             a.ip_address,
             a.created_at,
             u.full_name AS user_full_name,
             u.email AS user_email,
             u.avatar_url AS user_avatar_url,
             COALESCE(r.code, 'ADMIN') AS user_role
           FROM audit_logs a
           LEFT JOIN users u ON a.user_id = u.id
           LEFT JOIN roles r ON u.role_id = r.id
           WHERE ${whereSql}
           ORDER BY a.created_at DESC
           LIMIT $${paramIdx++} OFFSET $${paramIdx++};`,
          [...params, limit, offset],
        );

        const data = dataRows.map((r) => {
          return new AuditLogEntity({
            id: r.id,
            user_id: r.user_id,
            action: r.action,
            entity_name: r.entity_name,
            entity_id: r.entity_id,
            old_values: r.old_values,
            new_values: r.new_values,
            ip_address: r.ip_address,
            summary: r.summary,
            created_at: new Date(r.created_at),
            user: {
              id: r.user_id,
              full_name: r.user_full_name || 'Người dùng hệ thống',
              email: r.user_email || '',
              role: r.user_role || 'ADMIN',
              ip_address: r.ip_address,
              avatarUrl: r.user_avatar_url || null,
              avatar_url: r.user_avatar_url || null,
            },
          });
        });

        return {
          data,
          total,
          page,
          limit,
          totalPages,
        };
      } catch {
        // Fallback mượt mà sang in-memory filtering nếu bảng PostgreSQL chưa tạo hoặc mất kết nối
      }
    }

    // 2. TÌM KIẾM TRÊN DỮ LIỆU BỘ NHỚ (KHI CSDL CHƯA SẴN SÀNG HOẶC FALLBACK)
    let filtered = [...this.auditLogs];

    // 1. Lọc theo khoảng thời gian chuẩn hóa theo múi giờ Việt Nam (UTC+7)
    const cleanStartFallback = getCleanDatePart(query.startDate || query.date_from);
    if (cleanStartFallback) {
      filtered = filtered.filter((log) => getVietnamDateStr(log.created_at) >= cleanStartFallback);
    }

    const cleanEndFallback = getCleanDatePart(query.endDate || query.date_to);
    if (cleanEndFallback) {
      filtered = filtered.filter((log) => getVietnamDateStr(log.created_at) <= cleanEndFallback);
    }

    // 2. Lọc theo người thực hiện (userId, username hoặc tên)
    if (query.userId && query.userId !== 'ALL') {
      const targetUser = query.userId.toLowerCase().trim();
      const allUsers = (await this.usersService.findAll({ limit: 200 })).data;
      const matchedIds = new Set<string>();
      for (const u of allUsers) {
        if (
          u.id.toLowerCase() === targetUser ||
          u.username.toLowerCase() === targetUser ||
          u.fullName.toLowerCase() === targetUser
        ) {
          matchedIds.add(u.id.toLowerCase());
        }
      }
      matchedIds.add(targetUser);
      filtered = filtered.filter((log) => matchedIds.has(log.user_id?.toLowerCase() || ''));
    }

    // 3. Lọc theo phân hệ tác động (entityName hoặc entity hoặc module)
    const targetEntityFallback = query.entityName || query.entity || query.module;
    if (targetEntityFallback && targetEntityFallback !== 'ALL') {
      filtered = filtered.filter(
        (log) => log.entity_name.toUpperCase() === targetEntityFallback.toUpperCase(),
      );
    }

    // 4. Lọc theo loại hành động (action)
    if (query.action && query.action !== 'ALL') {
      filtered = filtered.filter(
        (log) => log.action.toUpperCase() === query.action?.toUpperCase(),
      );
    }

    // 5. Tìm kiếm tự do theo tên người thực hiện (fullName), username, email, mã đối tượng hoặc nội dung JSON
    const searchKeywordFallback = (query.searchUser || query.search || query.q)?.trim();
    if (searchKeywordFallback) {
      const q = searchKeywordFallback.toLowerCase();
      const allUsers = (await this.usersService.findAll({ limit: 200 })).data;
      const userMap = new Map<string, string>();
      for (const u of allUsers) {
        userMap.set(u.id.toLowerCase(), `${u.fullName} ${u.username} ${u.email}`.toLowerCase());
      }

      filtered = filtered.filter((log) => {
        const userInfoText = userMap.get(log.user_id?.toLowerCase() || '') || '';
        return (
          userInfoText.includes(q) ||
          log.user_id?.toLowerCase().includes(q) ||
          log.ip_address?.toLowerCase().includes(q) ||
          log.entity_id?.toLowerCase().includes(q) ||
          (log.summary && log.summary.toLowerCase().includes(q)) ||
          JSON.stringify(log.old_values || {}).toLowerCase().includes(q) ||
          JSON.stringify(log.new_values || {}).toLowerCase().includes(q)
        );
      });
    }

    // Sắp xếp giảm dần theo thời gian tạo (mới nhất lên trước)
    filtered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const offset = (page - 1) * limit;
    const sliced = filtered.slice(offset, offset + limit);

    // JOIN thông tin người dùng cho danh sách trang hiện tại
    const dataWithUsers = await Promise.all(
      sliced.map(async (log) => {
        const userInfo = await this.joinUserInfo(log);
        return new AuditLogEntity({
          ...log,
          user: userInfo,
        });
      }),
    );

    return {
      data: dataWithUsers,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Lấy chi tiết một bản ghi Audit Log theo ID (GET /api/audit-logs/:id)
   */
  async findById(id: string): Promise<AuditLogEntity> {
    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<{
          id: string;
          user_id: string;
          action: AuditAction;
          entity_name: AuditEntity;
          entity_id: string;
          old_values: Record<string, unknown> | null;
          new_values: Record<string, unknown> | null;
          ip_address: string;
          created_at: Date;
          user_full_name?: string;
          user_email?: string;
          user_role?: string;
          user_avatar_url?: string;
        }>(
          `SELECT 
             a.id,
             a.user_id,
             a.action,
             a.entity_name,
             a.entity_id,
             a.old_values,
             a.new_values,
             a.ip_address,
             a.created_at,
             u.full_name AS user_full_name,
             u.email AS user_email,
             u.avatar_url AS user_avatar_url,
             COALESCE(r.code, 'ADMIN') AS user_role
           FROM audit_logs a
           LEFT JOIN users u ON a.user_id = u.id
           LEFT JOIN roles r ON u.role_id = r.id
           WHERE a.id = $1
           LIMIT 1;`,
          [id],
        );

        if (rows && rows.length > 0) {
          const r = rows[0];
          return new AuditLogEntity({
            id: r.id,
            user_id: r.user_id,
            action: r.action,
            entity_name: r.entity_name,
            entity_id: r.entity_id,
            old_values: r.old_values,
            new_values: r.new_values,
            ip_address: r.ip_address,
            created_at: r.created_at,
            user: {
              id: r.user_id,
              full_name: r.user_full_name || 'Người dùng hệ thống',
              email: r.user_email || '',
              role: r.user_role || 'ADMIN',
              ip_address: r.ip_address,
              avatarUrl: r.user_avatar_url || null,
              avatar_url: r.user_avatar_url || null,
            },
          });
        }
      } catch {
        // Fallback sang in-memory
      }
    }

    const found = this.auditLogs.find((l) => l.id === id);
    if (!found) {
      throw new NotFoundException(`Không tìm thấy bản ghi nhật ký với mã: ${id}`);
    }

    const userInfo = await this.joinUserInfo(found);
    return new AuditLogEntity({
      ...found,
      user: userInfo,
    });
  }
}
