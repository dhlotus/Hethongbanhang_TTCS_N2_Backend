import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CustomersService } from '../customers/customers.service';
import { CustomerStatus } from '../customers/entities/customer.entity';
import { AuditAction, AuditEntity } from '../../common/enums';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { CreditStatus } from './enums/credit-status.enum';
import { CreditLimitEntity } from './entities/credit-limit.entity';
import { CreditLimitHistoryEntity } from './entities/credit-limit-history.entity';
import { QueryCreditLimitDto } from './dto/query-credit-limit.dto';
import { UpdateCreditLimitDto } from './dto/update-credit-limit.dto';
import { UpdateCreditStatusDto } from './dto/update-credit-status.dto';
import { CreditLimitStatsDto } from './dto/credit-limit-stats.dto';

export interface PaginatedCreditLimitResult {
  data: CreditLimitEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Service Quản lý và Khai báo Hạn mức Công nợ Đại lý (SN-34)
 */
@Injectable()
export class CreditLimitService implements OnModuleInit {
  private readonly creditLimits = new Map<string, CreditLimitEntity>();
  private readonly histories: CreditLimitHistoryEntity[] = [];

  constructor(
    private readonly customersService: CustomersService,
    private readonly auditLogsService: AuditLogsService,
    @Optional() private readonly dbService?: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncFromCustomers();
    this.seedInitialHistories();
  }

  /**
   * Đồng bộ dữ liệu đại lý ban đầu vào danh mục hạn mức công nợ
   */
  private async syncFromCustomers(): Promise<void> {
    const customers = await this.customersService.findAllCustomers();
    for (const c of customers) {
      const entity = new CreditLimitEntity({
        id: `crd-${c.id}`,
        customerId: c.id,
        customerCode: c.code,
        customerName: c.name,
        customerGroup: c.customerGroup,
        phone: c.phone,
        email: c.email,
        region: c.region,
        salesRepId: c.salesRepId,
        salesRepName: c.salesRepName,
        creditLimit: c.creditLimit,
        currentDebt: c.currentDebt,
        maxDebtDays: c.maxDebtDays,
        paymentTerms: 'NET_30',
        temporaryCreditLimit: 0,
        allowOverLimitOrder: false,
        status:
          c.status === CustomerStatus.LOCKED
            ? CreditStatus.BLOCKED
            : undefined,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });

      this.creditLimits.set(c.id, entity);
    }
  }

  /**
   * Khởi tạo lịch sử điều chỉnh hạn mức mẫu để hiển thị trực quan
   */
  private seedInitialHistories(): void {
    const initialSeedData: Partial<CreditLimitHistoryEntity>[] = [
      {
        id: randomUUID(),
        customerId: 'cust-001',
        customerCode: 'DL-HCM-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        oldCreditLimit: 80000000,
        newCreditLimit: 100000000,
        oldMaxDebtDays: 20,
        newMaxDebtDays: 30,
        oldPaymentTerms: 'NET_20',
        newPaymentTerms: 'NET_30',
        oldTemporaryLimit: 0,
        newTemporaryLimit: 0,
        reason: 'Nâng hạn mức công nợ quý theo doanh số đại lý phân phối cấp 1',
        adjustedBy: 'Kế toán trưởng Nguyễn Thu Hà',
        adjustedRole: 'Kế toán công nợ',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
      },
      {
        id: randomUUID(),
        customerId: 'cust-005',
        customerCode: 'DL-HCM-004',
        customerName: 'Công Ty TNHH Thương Mại & Dịch Vụ Hoàng Gia',
        oldCreditLimit: 150000000,
        newCreditLimit: 200000000,
        oldMaxDebtDays: 30,
        newMaxDebtDays: 30,
        oldPaymentTerms: 'NET_30',
        newPaymentTerms: 'NET_30',
        oldTemporaryLimit: 0,
        newTemporaryLimit: 0,
        reason: 'Đại lý ký hợp đồng cam kết doanh số năm, nâng trần hạn mức',
        adjustedBy: 'Trưởng phòng KD Trần Văn Long',
        adjustedRole: 'Quản lý kinh doanh',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12),
      },
    ];

    for (const h of initialSeedData) {
      this.histories.push(new CreditLimitHistoryEntity(h));
    }
  }

  /**
   * Lấy danh sách hạn mức công nợ kèm tìm kiếm, lọc và phân trang (SN-34)
   */
  async getCreditLimits(
    query?: QueryCreditLimitDto,
  ): Promise<PaginatedCreditLimitResult> {
    // Luôn đảm bảo đồng bộ mới nhất từ danh sách khách hàng
    if (this.creditLimits.size === 0) {
      await this.syncFromCustomers();
    }

    let items = Array.from(this.creditLimits.values());

    // 1. Tìm kiếm theo từ khóa (Mã, tên, số điện thoại)
    if (query?.search) {
      const searchKey = query.search.toLowerCase().trim();
      items = items.filter(
        (item) =>
          item.customerName.toLowerCase().includes(searchKey) ||
          item.customerCode.toLowerCase().includes(searchKey) ||
          item.phone.includes(searchKey),
      );
    }

    // 2. Lọc theo trạng thái hạn mức
    if (query?.status) {
      items = items.filter((item) => item.status === query.status);
    }

    // 3. Lọc theo nhóm đại lý
    if (query?.customerGroup) {
      items = items.filter(
        (item) => item.customerGroup === query.customerGroup,
      );
    }

    // 4. Sắp xếp (Sort)
    const sortBy = query?.sortBy || 'debtUsagePercentage';
    const sortOrder = query?.sortOrder || 'DESC';

    items.sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      if (sortBy === 'creditLimit') {
        valA = a.creditLimit;
        valB = b.creditLimit;
      } else if (sortBy === 'currentDebt') {
        valA = a.currentDebt;
        valB = b.currentDebt;
      } else if (sortBy === 'availableCredit') {
        valA = a.availableCredit;
        valB = b.availableCredit;
      } else if (sortBy === 'debtUsagePercentage') {
        valA = a.debtUsagePercentage;
        valB = b.debtUsagePercentage;
      } else if (sortBy === 'customerName') {
        valA = a.customerName;
        valB = b.customerName;
      } else {
        valA = a.updatedAt.getTime();
        valB = b.updatedAt.getTime();
      }

      if (valA < valB) return sortOrder === 'ASC' ? -1 : 1;
      if (valA > valB) return sortOrder === 'ASC' ? 1 : -1;
      return 0;
    });

    // 5. Phân trang
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 20;
    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginatedItems = items.slice(startIndex, startIndex + limit);

    return {
      data: paginatedItems,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Lấy chi tiết hạn mức công nợ theo customerId
   */
  async getCreditLimitById(customerId: string): Promise<CreditLimitEntity> {
    const item = this.creditLimits.get(customerId);
    if (!item) {
      throw new NotFoundException(
        `Không tìm thấy dữ liệu hạn mức công nợ cho đại lý: ${customerId}`,
      );
    }
    return item;
  }

  /**
   * Thống kê tổng quan hạn mức công nợ toàn hệ thống (SN-34)
   */
  async getCreditLimitStats(): Promise<CreditLimitStatsDto> {
    if (this.creditLimits.size === 0) {
      await this.syncFromCustomers();
    }

    const items = Array.from(this.creditLimits.values());
    let totalCreditLimit = 0;
    let totalCurrentDebt = 0;
    let totalAvailableCredit = 0;
    let normalCount = 0;
    let warningCount = 0;
    let exceededCount = 0;
    let blockedCount = 0;

    for (const item of items) {
      totalCreditLimit += item.creditLimit + item.temporaryCreditLimit;
      totalCurrentDebt += item.currentDebt;
      totalAvailableCredit += item.availableCredit;

      if (item.status === CreditStatus.NORMAL) normalCount++;
      else if (item.status === CreditStatus.WARNING) warningCount++;
      else if (item.status === CreditStatus.EXCEEDED) exceededCount++;
      else if (item.status === CreditStatus.BLOCKED) blockedCount++;
    }

    const averageUsageRate =
      totalCreditLimit > 0
        ? Math.round((totalCurrentDebt / totalCreditLimit) * 10000) / 100
        : 0;

    return {
      totalCreditLimit,
      totalCurrentDebt,
      totalAvailableCredit,
      totalCustomers: items.length,
      normalCount,
      warningCount,
      exceededCount,
      blockedCount,
      averageUsageRate,
    };
  }

  /**
   * Khai báo / Cập nhật Hạn mức Công nợ Đại lý kèm Transaction và Audit Log (SN-34)
   */
  async updateCreditLimit(
    customerId: string,
    dto: UpdateCreditLimitDto,
    currentUser?: ICurrentUser,
  ): Promise<CreditLimitEntity> {
    const currentEntity = await this.getCreditLimitById(customerId);

    // Lưu lại giá trị cũ để ghi vết Audit Log
    const oldValues: Record<string, unknown> = {
      creditLimit: currentEntity.creditLimit,
      maxDebtDays: currentEntity.maxDebtDays,
      paymentTerms: currentEntity.paymentTerms,
      temporaryCreditLimit: currentEntity.temporaryCreditLimit,
      temporaryLimitExpiry: currentEntity.temporaryLimitExpiry,
      allowOverLimitOrder: currentEntity.allowOverLimitOrder,
      status: currentEntity.status,
    };

    const actorName =
      currentUser?.username || currentUser?.email || 'Kế toán công nợ';
    const actorRole = currentUser?.roles?.[0] || 'ACCOUNTANT';

    // 1. Thực hiện Database Transaction nếu kết nối DB sẵn sàng
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query('BEGIN;');

        await this.dbService.query(
          `UPDATE customers
           SET credit_limit = $1,
               max_debt_days = $2,
               payment_terms = $3,
               updated_at = NOW()
           WHERE id = $4 OR code = $4;`,
          [
            dto.creditLimit,
            dto.maxDebtDays ?? currentEntity.maxDebtDays,
            dto.paymentTerms ?? currentEntity.paymentTerms,
            customerId,
          ],
        );

        await this.dbService.query('COMMIT;');
      } catch (err: unknown) {
        await this.dbService.query('ROLLBACK;');
        throw new BadRequestException(
          `Lỗi khi cập nhật hạn mức công nợ vào cơ sở dữ liệu: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. Cập nhật đối tượng CustomerEntity trong CustomersService
    await this.customersService.updateCustomerCredit(customerId, {
      creditLimit: dto.creditLimit,
      maxDebtDays: dto.maxDebtDays,
      paymentTerms: dto.paymentTerms,
    });

    // 3. Cập nhật CreditLimitEntity
    const newCreditLimit = dto.creditLimit;
    const newMaxDebtDays = dto.maxDebtDays ?? currentEntity.maxDebtDays;
    const newPaymentTerms = dto.paymentTerms ?? currentEntity.paymentTerms;
    const newTemporaryLimit =
      dto.temporaryCreditLimit ?? currentEntity.temporaryCreditLimit;
    const newTemporaryExpiry = dto.temporaryLimitExpiry
      ? new Date(dto.temporaryLimitExpiry)
      : currentEntity.temporaryLimitExpiry;
    const newAllowOverLimit =
      dto.allowOverLimitOrder !== undefined
        ? dto.allowOverLimitOrder
        : currentEntity.allowOverLimitOrder;

    currentEntity.creditLimit = newCreditLimit;
    currentEntity.maxDebtDays = newMaxDebtDays;
    currentEntity.paymentTerms = newPaymentTerms;
    currentEntity.temporaryCreditLimit = newTemporaryLimit;
    currentEntity.temporaryLimitExpiry = newTemporaryExpiry;
    currentEntity.allowOverLimitOrder = newAllowOverLimit;
    currentEntity.lastAdjustedAt = new Date();
    currentEntity.lastAdjustedBy = actorName;
    currentEntity.updatedAt = new Date();

    // Tính toán lại hạn mức khả dụng và trạng thái
    const effectiveLimit =
      currentEntity.creditLimit + currentEntity.temporaryCreditLimit;
    currentEntity.availableCredit = Math.max(
      0,
      effectiveLimit - currentEntity.currentDebt,
    );
    currentEntity.debtUsagePercentage =
      effectiveLimit > 0
        ? Math.round((currentEntity.currentDebt / effectiveLimit) * 10000) / 100
        : currentEntity.currentDebt > 0
          ? 100
          : 0;

    if (currentEntity.status !== CreditStatus.BLOCKED) {
      if (
        currentEntity.currentDebt > effectiveLimit &&
        effectiveLimit > 0
      ) {
        currentEntity.status = CreditStatus.EXCEEDED;
      } else if (currentEntity.debtUsagePercentage >= 80) {
        currentEntity.status = CreditStatus.WARNING;
      } else {
        currentEntity.status = CreditStatus.NORMAL;
      }
    }

    // 4. Lưu lại lịch sử điều chỉnh hạn mức
    const historyItem = new CreditLimitHistoryEntity({
      id: randomUUID(),
      customerId,
      customerCode: currentEntity.customerCode,
      customerName: currentEntity.customerName,
      oldCreditLimit: Number(oldValues.creditLimit),
      newCreditLimit,
      oldMaxDebtDays: Number(oldValues.maxDebtDays),
      newMaxDebtDays,
      oldPaymentTerms: String(oldValues.paymentTerms),
      newPaymentTerms,
      oldTemporaryLimit: Number(oldValues.temporaryCreditLimit),
      newTemporaryLimit,
      reason: dto.reason.trim(),
      adjustedBy: actorName,
      adjustedRole: actorRole,
      createdAt: new Date(),
    });
    this.histories.unshift(historyItem);

    // 5. Ghi nhận Nhật ký Kiểm toán hệ thống (Audit Log - SN-19 & SN-34)
    const newValues: Record<string, unknown> = {
      creditLimit: currentEntity.creditLimit,
      maxDebtDays: currentEntity.maxDebtDays,
      paymentTerms: currentEntity.paymentTerms,
      temporaryCreditLimit: currentEntity.temporaryCreditLimit,
      temporaryLimitExpiry: currentEntity.temporaryLimitExpiry,
      allowOverLimitOrder: currentEntity.allowOverLimitOrder,
      status: currentEntity.status,
      reason: dto.reason.trim(),
    };

    await this.auditLogsService.recordLog({
      userId: currentUser?.userId || 'usr-acc-006',
      action: AuditAction.UPDATE,
      entityName: AuditEntity.DEBT,
      entityId: currentEntity.customerCode,
      oldValues,
      newValues,
      ipAddress: '127.0.0.1',
      summary: `Điều chỉnh hạn mức công nợ đại lý ${currentEntity.customerCode} (${currentEntity.customerName}) từ ${Number(oldValues.creditLimit).toLocaleString('vi-VN')} đ lên ${newCreditLimit.toLocaleString('vi-VN')} đ. Lý do: ${dto.reason.trim()}`,
    });

    return currentEntity;
  }

  /**
   * Khóa hoặc Mở khóa hạn mức tín dụng đại lý (SN-34)
   */
  async updateCreditStatus(
    customerId: string,
    dto: UpdateCreditStatusDto,
    currentUser?: ICurrentUser,
  ): Promise<CreditLimitEntity> {
    const currentEntity = await this.getCreditLimitById(customerId);

    const oldStatus = currentEntity.status;
    const actorName =
      currentUser?.username || currentUser?.email || 'Kế toán công nợ';

    currentEntity.status = dto.status;
    currentEntity.lockReason =
      dto.status === CreditStatus.BLOCKED ? dto.reason.trim() : undefined;
    currentEntity.updatedAt = new Date();

    // Đồng bộ với trạng thái khách hàng
    await this.customersService.updateCustomerStatus(
      customerId,
      dto.status === CreditStatus.BLOCKED
        ? CustomerStatus.LOCKED
        : CustomerStatus.ACTIVE,
      dto.reason.trim(),
    );

    // Ghi nhận Audit Log
    await this.auditLogsService.recordLog({
      userId: currentUser?.userId || 'usr-acc-006',
      action: AuditAction.UPDATE,
      entityName: AuditEntity.DEBT,
      entityId: currentEntity.customerCode,
      oldValues: { status: oldStatus },
      newValues: { status: dto.status, reason: dto.reason.trim() },
      ipAddress: '127.0.0.1',
      summary: `${dto.status === CreditStatus.BLOCKED ? 'Khóa hạn mức' : 'Mở khóa hạn mức'} công nợ đại lý ${currentEntity.customerCode} (${currentEntity.customerName}). Lý do: ${dto.reason.trim()} (Bởi ${actorName})`,
    });

    return currentEntity;
  }

  /**
   * Lấy danh sách lịch sử điều chỉnh hạn mức của một đại lý (SN-34)
   */
  async getCreditLimitHistory(
    customerId: string,
  ): Promise<CreditLimitHistoryEntity[]> {
    return this.histories.filter((h) => h.customerId === customerId);
  }
}
