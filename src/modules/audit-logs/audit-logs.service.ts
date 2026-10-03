import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditAction, AuditEntity } from '../../common/enums';
import { UsersService } from '../users/users.service';
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
 */
@Injectable()
export class AuditLogsService implements OnModuleInit {
  private auditLogs: AuditLogEntity[] = [];

  constructor(private readonly usersService: UsersService) {}

  onModuleInit(): void {
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
    const salesManagerUser = 'usr-sm-003';
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
    return logItem;
  }

  /**
   * Lấy thông tin user liên kết (JOIN) từ UsersService
   */
  private async joinUserInfo(log: AuditLogEntity): Promise<AuditLogUserInfo> {
    try {
      const user = await this.usersService.findById(log.user_id);
      if (user) {
        return {
          id: user.id,
          full_name: user.fullName,
          email: user.email,
          role: (user.roles && user.roles[0]) || user.role || 'ADMIN',
          ip_address: log.ip_address,
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
    };
  }

  /**
   * Truy vấn danh sách Audit Logs có hỗ trợ bộ lọc và phân trang (GET /api/audit-logs)
   */
  async findAll(query: QueryAuditLogsDto): Promise<PaginatedAuditLogsResult> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Math.min(100, Number(query.limit || 20)));

    let filtered = [...this.auditLogs];

    // 1. Lọc theo khoảng thời gian (startDate, endDate)
    if (query.startDate) {
      const start = new Date(query.startDate);
      if (!isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        filtered = filtered.filter((log) => new Date(log.created_at) >= start);
      }
    }

    if (query.endDate) {
      const end = new Date(query.endDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        filtered = filtered.filter((log) => new Date(log.created_at) <= end);
      }
    }

    // 2. Lọc theo người thực hiện (userId)
    if (query.userId && query.userId !== 'ALL') {
      filtered = filtered.filter((log) => log.user_id === query.userId);
    }

    // 3. Lọc theo phân hệ tác động (entityName hoặc entity)
    const targetEntity = query.entityName || query.entity;
    if (targetEntity && targetEntity !== 'ALL') {
      filtered = filtered.filter(
        (log) => log.entity_name.toUpperCase() === targetEntity.toUpperCase(),
      );
    }

    // 4. Lọc theo loại hành động (action)
    if (query.action && query.action !== 'ALL') {
      filtered = filtered.filter(
        (log) => log.action.toUpperCase() === query.action?.toUpperCase(),
      );
    }

    // 5. Tìm kiếm tự do theo tên người dùng, email hoặc địa chỉ IP
    if (query.searchUser?.trim()) {
      const q = query.searchUser.trim().toLowerCase();
      const matchedUserIds = new Set<string>();

      // Tìm trong danh sách users
      const allUsers = (await this.usersService.findAll({ limit: 100 })).data;
      for (const u of allUsers) {
        if (
          u.fullName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        ) {
          matchedUserIds.add(u.id);
        }
      }

      filtered = filtered.filter(
        (log) =>
          matchedUserIds.has(log.user_id) ||
          log.ip_address.toLowerCase().includes(q) ||
          log.entity_id.toLowerCase().includes(q) ||
          (log.summary && log.summary.toLowerCase().includes(q)),
      );
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
}
