import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { OrdersService } from '../orders/orders.service';
import { CustomersService } from '../customers/customers.service';
import { OrderStatus, isRecognizedSalesStatus } from '../orders/entities/order-status.enum';
import { SalesTargetEntity, SalesTargetType } from './entities/sales-target.entity';
import { SalesTargetAdjustmentLogEntity } from './entities/sales-target-adjustment-log.entity';
import {
  CreateSalesTargetDto,
  QuerySalesTargetDto,
  UpdateSalesTargetDto,
} from './dto/sales-target.dto';

export interface SalesTargetProgressItem extends SalesTargetEntity {
  actualAmount: number; // Doanh số thực tế đã đạt được (VNĐ)
  completionRate: number | null; // % Hoàn thành (null nếu targetAmount = 0 hoặc chưa giao)
  shortageOrExcess: number; // Chênh lệch (dương: vượt, âm: còn thiếu)
  isExceeded: boolean;
  ordersCount: number; // Số đơn hàng ghi nhận doanh số
  statusLabel: string;
}

@Injectable()
export class SalesTargetsService implements OnModuleInit {
  private readonly logger = new Logger(SalesTargetsService.name);
  private readonly targets = new Map<string, SalesTargetEntity>();
  private readonly adjustmentLogs = new Map<string, SalesTargetAdjustmentLogEntity[]>();

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    @Optional() private readonly databaseService?: DatabaseService,
  ) {
    this.seedInitialTargets();
  }

  async onModuleInit(): Promise<void> {
    if (this.databaseService?.isConnected()) {
      await this.ensureTables();
    }
  }

  private async ensureTables(): Promise<void> {
    try {
      await this.databaseService?.query(`
        CREATE TABLE IF NOT EXISTS app_sales_targets (
          id TEXT PRIMARY KEY,
          period VARCHAR(10) NOT NULL,
          target_type VARCHAR(20) NOT NULL,
          target_id TEXT NOT NULL,
          target_name TEXT NOT NULL,
          target_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
          note TEXT,
          is_locked BOOLEAN NOT NULL DEFAULT FALSE,
          created_by_id TEXT NOT NULL,
          created_by_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uq_sales_target_period_scope UNIQUE (period, target_type, target_id)
        );

        CREATE INDEX IF NOT EXISTS idx_sales_targets_period ON app_sales_targets(period);
        CREATE INDEX IF NOT EXISTS idx_sales_targets_scope ON app_sales_targets(target_type, target_id);

        CREATE TABLE IF NOT EXISTS app_sales_target_adjustment_logs (
          id TEXT PRIMARY KEY,
          target_id TEXT NOT NULL,
          period VARCHAR(10) NOT NULL,
          target_type VARCHAR(20) NOT NULL,
          target_name TEXT NOT NULL,
          old_amount NUMERIC(15, 2) NOT NULL,
          new_amount NUMERIC(15, 2) NOT NULL,
          reason TEXT NOT NULL,
          adjusted_by_id TEXT NOT NULL,
          adjusted_by_name TEXT NOT NULL,
          adjusted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_sales_target_logs_target ON app_sales_target_adjustment_logs(target_id);
      `);
      this.logger.log('[PostgreSQL] Đã khởi tạo / đồng bộ các bảng chỉ tiêu doanh số app_sales_targets.');
    } catch (err) {
      this.logger.warn(`[PostgreSQL] Lỗi tạo bảng app_sales_targets: ${err}`);
    }
  }

  /**
   * Lấy kỳ tháng hiện tại theo chuẩn YYYY-MM
   */
  /**
   * Lấy kỳ tháng hiện tại theo chuẩn YYYY-MM theo múi giờ hệ thống (Việt Nam GMT+7)
   */
  getCurrentPeriod(): string {
    const now = new Date();
    // Định dạng YYYY-MM theo giờ Việt Nam
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
    });
    return formatter.format(now).substring(0, 7);
  }

  /**
   * Kiểm tra xem một kỳ tháng đã kết thúc và bị khóa tự động hay chưa
   * Kỳ nhỏ hơn tháng hiện tại theo giờ hệ thống được tự động khóa sửa thông thường
   */
  isPeriodLocked(period: string): boolean {
    const current = this.getCurrentPeriod();
    return period < current;
  }

  private seedInitialTargets(): void {
    const currentPeriod = this.getCurrentPeriod();
    const prevMonthDate = new Date();
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevPeriod = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

    const initialData: Partial<SalesTargetEntity>[] = [
      // Chỉ tiêu nhân viên kỳ hiện tại
      {
        id: 'st-emp-01',
        period: currentPeriod,
        targetType: 'EMPLOYEE',
        targetId: 'usr-sale-01',
        targetName: 'Trần Văn Long',
        targetAmount: 150000000,
        note: 'Chỉ tiêu bán hàng kênh phân phối Miền Nam',
        isLocked: false,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
      {
        id: 'st-emp-02',
        period: currentPeriod,
        targetType: 'EMPLOYEE',
        targetId: 'usr-sales-002',
        targetName: 'Phạm Minh Hùng',
        targetAmount: 120000000,
        note: 'Chỉ tiêu khu vực Đông Nam Bộ',
        isLocked: false,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
      {
        id: 'st-emp-03',
        period: currentPeriod,
        targetType: 'EMPLOYEE',
        targetId: 'usr-sale-02',
        targetName: 'Lê Thị Hoa',
        targetAmount: 90000000,
        note: 'Chỉ tiêu đại lý cấp 2 Miền Bắc',
        isLocked: false,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
      // Chỉ tiêu khu vực kỳ hiện tại
      {
        id: 'st-reg-south',
        period: currentPeriod,
        targetType: 'REGION',
        targetId: 'Miền Nam',
        targetName: 'Khu vực Miền Nam',
        targetAmount: 350000000,
        note: 'Chỉ tiêu tổng hợp vùng Miền Nam & TP.HCM',
        isLocked: false,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
      {
        id: 'st-reg-north',
        period: currentPeriod,
        targetType: 'REGION',
        targetId: 'Miền Bắc',
        targetName: 'Khu vực Miền Bắc',
        targetAmount: 200000000,
        note: 'Chỉ tiêu vùng Hà Nội & lân cận',
        isLocked: false,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
      {
        id: 'st-reg-central',
        period: currentPeriod,
        targetType: 'REGION',
        targetId: 'Miền Trung',
        targetName: 'Khu vực Miền Trung',
        targetAmount: 150000000,
        note: 'Chỉ tiêu vùng Duyên hải & Tây Nguyên',
        isLocked: false,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
      {
        id: 'st-reg-west',
        period: currentPeriod,
        targetType: 'REGION',
        targetId: 'Miền Tây',
        targetName: 'Khu vực Miền Tây',
        targetAmount: 100000000,
        note: 'Chỉ tiêu vùng Đồng bằng sông Cửu Long',
        isLocked: false,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
      // Chỉ tiêu kỳ trước đã khóa (để kiểm tra nghiệp vụ khóa kỳ & điều chỉnh có nhật ký)
      {
        id: 'st-prev-emp-01',
        period: prevPeriod,
        targetType: 'EMPLOYEE',
        targetId: 'usr-sale-01',
        targetName: 'Trần Văn Long',
        targetAmount: 130000000,
        note: 'Kỳ tháng trước đã chốt',
        isLocked: true,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
      {
        id: 'st-prev-reg-south',
        period: prevPeriod,
        targetType: 'REGION',
        targetId: 'Miền Nam',
        targetName: 'Khu vực Miền Nam',
        targetAmount: 300000000,
        note: 'Kỳ tháng trước đã chốt',
        isLocked: true,
        createdById: 'usr-admin-01',
        createdByName: 'Quản trị viên',
      },
    ];

    for (const item of initialData) {
      const entity = new SalesTargetEntity(item);
      this.targets.set(entity.id, entity);
    }
  }

  /**
   * Tính toán doanh số thực tế trong một kỳ (YYYY-MM) cho nhân viên hoặc khu vực
   */
  async calculateActualSales(
    period: string,
    targetType: SalesTargetType,
    targetId: string,
  ): Promise<{ actualSales: number; ordersCount: number }> {
    const { data: allOrders } = await this.ordersService.findAllOrders({ limit: 10000 });

    // Xác định khoảng thời gian đầu tháng và cuối tháng của kỳ
    const [yearStr, monthStr] = period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const startOfPeriod = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endOfPeriod = new Date(year, month, 0, 23, 59, 59, 999);

    let actualSales = 0;
    let ordersCount = 0;

    for (const order of allOrders) {
      // SN-215: Chỉ ghi nhận các đơn hàng có trạng thái ĐÃ ĐƯỢC DUYỆT hoặc giao hàng thành công
      // Tuyệt đối không ghi nhận đơn chờ duyệt, nháp, hủy hoặc bị từ chối
      if (!isRecognizedSalesStatus(order.status)) {
        continue;
      }

      const orderDate = new Date(order.createdAt);
      if (orderDate < startOfPeriod || orderDate > endOfPeriod) {
        continue;
      }

      let isMatch = false;

      if (targetType === 'EMPLOYEE') {
        const orderRepId = order.salesRepId || '';
        const orderRepName = (order.salesRepName || '').toLowerCase();
        const targetIdLower = targetId.toLowerCase();

        if (
          orderRepId === targetId ||
          (orderRepName && targetIdLower && orderRepName.includes(targetIdLower))
        ) {
          isMatch = true;
        }
      } else if (targetType === 'REGION') {
        const orderRegion = (order.region || '').trim().toLowerCase();
        const targetRegion = targetId.trim().toLowerCase();
        if (orderRegion === targetRegion || orderRegion.includes(targetRegion) || targetRegion.includes(orderRegion)) {
          isMatch = true;
        }
      }

      if (isMatch) {
        actualSales += order.grandTotal || 0;
        ordersCount++;
      }
    }

    return { actualSales, ordersCount };
  }

  /**
   * Lấy danh sách chỉ tiêu kèm tiến độ thực tế (SN-215)
   */
  async findAll(query: QuerySalesTargetDto, currentUser: ICurrentUser): Promise<{
    items: SalesTargetProgressItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    summary: {
      totalEmployeeTarget: number;
      totalEmployeeActual: number;
      employeeCompletionRate: number | null;
      totalRegionTarget: number;
      totalRegionActual: number;
      regionCompletionRate: number | null;
      period: string;
      isPeriodLocked: boolean;
    };
    lastUpdated: string;
  }> {
    const roles = currentUser.roles || [];
    const isManager = roles.some((r) => r === UserRole.ADMIN || r === UserRole.SALES_MANAGER);
    const isSalesRep = roles.includes(UserRole.SALES_REP);

    const period = query.period || this.getCurrentPeriod();
    const isLocked = this.isPeriodLocked(period);

    let list = Array.from(this.targets.values()).filter((t) => t.period === period);

    // Phân quyền Data Scope:
    // Nhân viên kinh doanh (SALES_REP) chỉ xem được tiến độ của chính mình
    if (isSalesRep && !isManager) {
      const repId = currentUser.userId;
      list = list.filter((t) => t.targetType === 'EMPLOYEE' && t.targetId === repId);
      
      // Nếu chưa có bản ghi chỉ tiêu cho nhân viên trong kỳ, tạo item ảo để hiển thị
      if (list.length === 0) {
        const placeholder = new SalesTargetEntity({
          id: `virtual-${repId}-${period}`,
          period,
          targetType: 'EMPLOYEE',
          targetId: repId,
          targetName: (currentUser as any).fullName || currentUser.username || 'Nhân viên kinh doanh',
          targetAmount: 0,
          note: 'Chưa được giao chỉ tiêu trong kỳ này',
          isLocked,
          createdById: 'SYSTEM',
          createdByName: 'Hệ thống',
        });
        list.push(placeholder);
      }
    } else {
      // Quản lý: Lọc theo targetType hoặc search
      if (query.targetType) {
        list = list.filter((t) => t.targetType === query.targetType);
      }
      if (query.targetId) {
        list = list.filter((t) => t.targetId === query.targetId);
      }
      if (query.search) {
        const s = query.search.toLowerCase();
        list = list.filter((t) => t.targetName.toLowerCase().includes(s) || (t.note && t.note.toLowerCase().includes(s)));
      }
    }

    const items: SalesTargetProgressItem[] = [];

    for (const target of list) {
      const { actualSales, ordersCount } = await this.calculateActualSales(
        target.period,
        target.targetType,
        target.targetId,
      );

      const targetAmt = Number(target.targetAmount);
      let completionRate: number | null = null;
      if (targetAmt > 0) {
        completionRate = Number(((actualSales / targetAmt) * 100).toFixed(1));
      }

      const shortageOrExcess = actualSales - targetAmt;
      const isExceeded = shortageOrExcess > 0;

      // Trạng thái khóa tự động theo kỳ
      const effectiveLocked = target.isLocked || this.isPeriodLocked(target.period);

      let statusLabel = 'Đang diễn ra';
      if (effectiveLocked) {
        statusLabel = 'Đã khóa';
      } else if (targetAmt <= 0) {
        statusLabel = 'Chưa giao';
      } else if (isExceeded) {
        statusLabel = 'Vượt mục tiêu';
      } else if (completionRate && completionRate >= 80) {
        statusLabel = 'Tiến độ tốt';
      }

      items.push({
        ...target,
        isLocked: effectiveLocked,
        actualAmount: actualSales,
        completionRate,
        shortageOrExcess,
        isExceeded,
        ordersCount,
        statusLabel,
      });
    }

    // Tính tổng hợp KHÔNG CỘNG TRÙNG giữa chỉ tiêu nhân viên và chỉ tiêu khu vực
    let totalEmployeeTarget = 0;
    let totalEmployeeActual = 0;
    let totalRegionTarget = 0;
    let totalRegionActual = 0;

    for (const item of items) {
      if (item.targetType === 'EMPLOYEE') {
        totalEmployeeTarget += item.targetAmount;
        totalEmployeeActual += item.actualAmount;
      } else if (item.targetType === 'REGION') {
        totalRegionTarget += item.targetAmount;
        totalRegionActual += item.actualAmount;
      }
    }

    const employeeCompletionRate =
      totalEmployeeTarget > 0
        ? Number(((totalEmployeeActual / totalEmployeeTarget) * 100).toFixed(1))
        : null;

    const regionCompletionRate =
      totalRegionTarget > 0
        ? Number(((totalRegionActual / totalRegionTarget) * 100).toFixed(1))
        : null;

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const paginatedItems = items.slice((page - 1) * limit, page * limit);

    return {
      items: paginatedItems,
      total,
      page,
      limit,
      totalPages,
      summary: {
        totalEmployeeTarget,
        totalEmployeeActual,
        employeeCompletionRate,
        totalRegionTarget,
        totalRegionActual,
        regionCompletionRate,
        period,
        isPeriodLocked: isLocked,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Lấy chi tiết một chỉ tiêu cùng danh sách đơn hàng ghi nhận và lịch sử điều chỉnh
   */
  async findOne(id: string, currentUser: ICurrentUser): Promise<{
    item: SalesTargetProgressItem;
    contributingOrders: Array<{
      id: string;
      orderCode: string;
      customerName: string;
      createdAt: string;
      grandTotal: number;
      status: string;
    }>;
    logs: SalesTargetAdjustmentLogEntity[];
  }> {
    const roles = currentUser.roles || [];
    const isManager = roles.some((r) => r === UserRole.ADMIN || r === UserRole.SALES_MANAGER);
    const isSalesRep = roles.includes(UserRole.SALES_REP);

    const target = this.targets.get(id);
    if (!target) {
      throw new NotFoundException(`Không tìm thấy chỉ tiêu doanh số với mã ${id}`);
    }

    if (isSalesRep && !isManager && target.targetType === 'EMPLOYEE' && target.targetId !== currentUser.userId) {
      throw new ForbiddenException('Bạn không có quyền xem chỉ tiêu của nhân viên khác');
    }

    const { data: allOrders } = await this.ordersService.findAllOrders({ limit: 10000 });
    const [yearStr, monthStr] = target.period.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const startOfPeriod = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endOfPeriod = new Date(year, month, 0, 23, 59, 59, 999);

    const contributingOrders: Array<{
      id: string;
      orderCode: string;
      customerName: string;
      createdAt: string;
      grandTotal: number;
      status: string;
    }> = [];

    let actualSales = 0;

    for (const order of allOrders) {
      if (!isRecognizedSalesStatus(order.status)) continue;
      const orderDate = new Date(order.createdAt);
      if (orderDate < startOfPeriod || orderDate > endOfPeriod) continue;

      let isMatch = false;
      if (target.targetType === 'EMPLOYEE') {
        const orderRepId = order.salesRepId || '';
        const orderRepName = (order.salesRepName || '').toLowerCase();
        const targetIdLower = target.targetId.toLowerCase();
        if (orderRepId === target.targetId || (orderRepName && targetIdLower && orderRepName.includes(targetIdLower))) {
          isMatch = true;
        }
      } else if (target.targetType === 'REGION') {
        const orderRegion = (order.region || '').trim().toLowerCase();
        const targetRegion = target.targetId.trim().toLowerCase();
        if (orderRegion === targetRegion || orderRegion.includes(targetRegion) || targetRegion.includes(orderRegion)) {
          isMatch = true;
        }
      }

      if (isMatch) {
        actualSales += order.grandTotal || 0;
        contributingOrders.push({
          id: order.id,
          orderCode: order.orderCode || order.id.slice(0, 8),
          customerName: order.customerName || 'Khách hàng',
          createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : String(order.createdAt),
          grandTotal: order.grandTotal || 0,
          status: order.status,
        });
      }
    }

    const targetAmt = Number(target.targetAmount);
    let completionRate: number | null = null;
    if (targetAmt > 0) {
      completionRate = Number(((actualSales / targetAmt) * 100).toFixed(1));
    }
    const shortageOrExcess = actualSales - targetAmt;
    const isExceeded = shortageOrExcess > 0;
    const effectiveLocked = target.isLocked || this.isPeriodLocked(target.period);

    let statusLabel = 'Đang diễn ra';
    if (effectiveLocked) {
      statusLabel = 'Đã khóa';
    } else if (targetAmt <= 0) {
      statusLabel = 'Chưa giao';
    } else if (isExceeded) {
      statusLabel = 'Vượt mục tiêu';
    } else if (completionRate && completionRate >= 80) {
      statusLabel = 'Tiến độ tốt';
    }

    const progressItem: SalesTargetProgressItem = {
      ...target,
      isLocked: effectiveLocked,
      actualAmount: actualSales,
      completionRate,
      shortageOrExcess,
      isExceeded,
      ordersCount: contributingOrders.length,
      statusLabel,
    };

    const logs = this.adjustmentLogs.get(target.id) || [];

    return {
      item: progressItem,
      contributingOrders,
      logs,
    };
  }

  /**
   * Lấy tiến độ cá nhân của chính nhân viên đang đăng nhập (Mobile Friendly)
   */
  async getMyProgress(periodQuery: string | undefined, currentUser: ICurrentUser): Promise<{
    item: SalesTargetProgressItem;
    period: string;
    isLocked: boolean;
    lastUpdated: string;
  }> {
    const period = periodQuery || this.getCurrentPeriod();
    const repId = currentUser.userId;

    let target = Array.from(this.targets.values()).find(
      (t) => t.period === period && t.targetType === 'EMPLOYEE' && t.targetId === repId,
    );

    const isLocked = this.isPeriodLocked(period);

    if (!target) {
      target = new SalesTargetEntity({
        id: `virtual-${repId}-${period}`,
        period,
        targetType: 'EMPLOYEE',
        targetId: repId,
        targetName: (currentUser as any).fullName || currentUser.username || 'Nhân viên kinh doanh',
        targetAmount: 0,
        note: 'Chưa được giao chỉ tiêu trong tháng này',
        isLocked,
        createdById: 'SYSTEM',
        createdByName: 'Hệ thống',
      });
    }

    const { actualSales, ordersCount } = await this.calculateActualSales(
      target.period,
      target.targetType,
      target.targetId,
    );

    const targetAmt = Number(target.targetAmount);
    let completionRate: number | null = null;
    if (targetAmt > 0) {
      completionRate = Number(((actualSales / targetAmt) * 100).toFixed(1));
    }

    const shortageOrExcess = actualSales - targetAmt;
    const isExceeded = shortageOrExcess > 0;
    const effectiveLocked = target.isLocked || isLocked;

    let statusLabel = 'Đang diễn ra';
    if (effectiveLocked) statusLabel = 'Đã khóa';
    else if (targetAmt <= 0) statusLabel = 'Chưa giao';
    else if (isExceeded) statusLabel = 'Vượt mục tiêu';
    else if (completionRate && completionRate >= 80) statusLabel = 'Tiến độ tốt';

    const item: SalesTargetProgressItem = {
      ...target,
      isLocked: effectiveLocked,
      actualAmount: actualSales,
      completionRate,
      shortageOrExcess,
      isExceeded,
      ordersCount,
      statusLabel,
    };

    return {
      item,
      period,
      isLocked: effectiveLocked,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Tạo mới chỉ tiêu doanh số (chỉ dành cho SALES_MANAGER & ADMIN)
   */
  async create(dto: CreateSalesTargetDto, currentUser: ICurrentUser): Promise<SalesTargetEntity> {
    const roles = currentUser.roles || [];
    const isManager = roles.some((r) => r === UserRole.ADMIN || r === UserRole.SALES_MANAGER);
    if (!isManager) {
      throw new ForbiddenException('Chỉ Quản lý kinh doanh hoặc Quản trị viên mới có quyền đặt chỉ tiêu!');
    }

    // Kiểm tra trùng lặp cùng kỳ và cùng phạm vi (Ngăn tạo bản ghi trùng cùng kỳ và cùng phạm vi)
    const existing = Array.from(this.targets.values()).find(
      (t) => t.period === dto.period && t.targetType === dto.targetType && t.targetId === dto.targetId,
    );
    if (existing) {
      throw new BadRequestException(
        `Đã tồn tại chỉ tiêu cho đối tượng ${dto.targetName} trong kỳ ${dto.period}. Vui lòng cập nhật thay vì tạo mới.`,
      );
    }

    const isLocked = this.isPeriodLocked(dto.period);

    const newTarget = new SalesTargetEntity({
      id: `st-${randomUUID().substring(0, 8)}`,
      period: dto.period,
      targetType: dto.targetType,
      targetId: dto.targetId,
      targetName: dto.targetName,
      targetAmount: dto.targetAmount,
      note: dto.note || '',
      isLocked,
      createdById: currentUser.userId,
      createdByName: (currentUser as any).fullName || currentUser.username || 'Quản lý',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.targets.set(newTarget.id, newTarget);

    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `INSERT INTO app_sales_targets (id, period, target_type, target_id, target_name, target_amount, note, is_locked, created_by_id, created_by_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            newTarget.id,
            newTarget.period,
            newTarget.targetType,
            newTarget.targetId,
            newTarget.targetName,
            newTarget.targetAmount,
            newTarget.note,
            newTarget.isLocked,
            newTarget.createdById,
            newTarget.createdByName,
          ],
        );
      } catch (err) {
        this.logger.warn(`Lỗi lưu target vào database: ${err}`);
      }
    }

    return newTarget;
  }

  /**
   * Cập nhật chỉ tiêu doanh số (SN-215: Nếu kỳ đã khóa, bắt buộc có lý do và ghi nhật ký đồng thời)
   */
  async update(id: string, dto: UpdateSalesTargetDto, currentUser: ICurrentUser): Promise<SalesTargetEntity> {
    const roles = currentUser.roles || [];
    const isManager = roles.some((r) => r === UserRole.ADMIN || r === UserRole.SALES_MANAGER);
    if (!isManager) {
      throw new ForbiddenException('Chỉ Quản lý kinh doanh hoặc Quản trị viên mới có quyền sửa chỉ tiêu!');
    }

    const target = this.targets.get(id);
    if (!target) {
      throw new NotFoundException(`Không tìm thấy chỉ tiêu với mã ${id}`);
    }

    const isLocked = target.isLocked || this.isPeriodLocked(target.period);

    // Nếu kỳ đã khóa, bắt buộc nhập lý do điều chỉnh tối thiểu 5 ký tự
    if (isLocked) {
      if (!dto.reason || dto.reason.trim().length < 5) {
        throw new BadRequestException(
          'Kỳ chỉ tiêu này đã kết thúc và bị khóa. Thao tác điều chỉnh bắt buộc phải nhập lý do giải trình tối thiểu 5 ký tự!',
        );
      }
    }

    const oldAmount = target.targetAmount;
    const newAmount = Number(dto.targetAmount);

    let log: SalesTargetAdjustmentLogEntity | null = null;
    if (isLocked || oldAmount !== newAmount) {
      log = new SalesTargetAdjustmentLogEntity({
        id: `log-${randomUUID().substring(0, 8)}`,
        targetId: target.id,
        period: target.period,
        targetType: target.targetType,
        targetName: target.targetName,
        oldAmount,
        newAmount,
        reason: dto.reason?.trim() || 'Điều chỉnh trong kỳ hoạt động',
        adjustedById: currentUser.userId,
        adjustedByName: (currentUser as any).fullName || currentUser.username || 'Quản lý',
        adjustedAt: new Date(),
      });
    }

    // Thực hiện trong một Transaction SQL atomic nếu database connected
    if (this.databaseService?.isConnected()) {
      let client;
      try {
        client = await this.databaseService.getClient();
        await client.query('BEGIN');
        await client.query(
          `UPDATE app_sales_targets SET target_amount = $1, note = $2, updated_at = NOW() WHERE id = $3`,
          [newAmount, dto.note !== undefined ? dto.note : target.note, target.id],
        );
        if (log) {
          await client.query(
            `INSERT INTO app_sales_target_adjustment_logs (id, target_id, period, target_type, target_name, old_amount, new_amount, reason, adjusted_by_id, adjusted_by_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              log.id,
              log.targetId,
              log.period,
              log.targetType,
              log.targetName,
              log.oldAmount,
              log.newAmount,
              log.reason,
              log.adjustedById,
              log.adjustedByName,
            ],
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        if (client) {
          await client.query('ROLLBACK').catch(() => {});
        }
        this.logger.warn(`Lỗi transaction cập nhật chỉ tiêu: ${err}`);
        throw err;
      } finally {
        if (client) {
          client.release();
        }
      }
    }

    // Cập nhật in-memory sau khi transaction database thành công
    target.targetAmount = newAmount;
    if (dto.note !== undefined) {
      target.note = dto.note;
    }
    target.updatedAt = new Date();

    if (log) {
      const logs = this.adjustmentLogs.get(target.id) || [];
      logs.unshift(log);
      this.adjustmentLogs.set(target.id, logs);
    }

    return target;
  }

  /**
   * Lấy lịch sử nhật ký điều chỉnh của một chỉ tiêu
   */
  async getAdjustmentLogs(targetId: string, currentUser: ICurrentUser): Promise<SalesTargetAdjustmentLogEntity[]> {
    const roles = currentUser.roles || [];
    const isManager = roles.some((r) => r === UserRole.ADMIN || r === UserRole.SALES_MANAGER);
    if (!isManager) {
      throw new ForbiddenException('Chỉ Quản lý kinh doanh mới có quyền xem nhật ký điều chỉnh chỉ tiêu!');
    }

    return this.adjustmentLogs.get(targetId) || [];
  }
}
