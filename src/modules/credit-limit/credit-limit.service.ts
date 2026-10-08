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
import { AuditAction, AuditEntity, Role } from '../../common/enums';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { CreditStatus } from './enums/credit-status.enum';
import { AgencyCreditLimit } from './entities/agency-credit-limit.entity';
import { CreditLimitLog } from './entities/credit-limit-log.entity';
import { QueryCreditLimitDto } from './dto/query-credit-limit.dto';
import { UpdateCreditLimitDto } from './dto/update-credit-limit.dto';
import { UpdateCreditStatusDto } from './dto/update-credit-status.dto';
import { CreditLimitStatsDto } from './dto/credit-limit-stats.dto';

export interface PaginatedCreditLimitResult {
  data: AgencyCreditLimit[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Service Quản lý và Khai báo Hạn mức Công nợ Đại lý (SN-34)
 * Thực thi cập nhật hạn mức và ghi Audit Log trong cùng một Database Transaction
 */
@Injectable()
export class CreditLimitService implements OnModuleInit {
  private readonly agencyCreditLimits = new Map<string, AgencyCreditLimit>();
  private readonly creditLimitLogs: CreditLimitLog[] = [];

  constructor(
    private readonly customersService: CustomersService,
    private readonly auditLogsService: AuditLogsService,
    @Optional() private readonly dbService?: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncFromCustomers();
    this.seedInitialLogs();
  }

  /**
   * Đồng bộ dữ liệu đại lý vào AgencyCreditLimit
   */
  private async syncFromCustomers(): Promise<void> {
    const customers = await this.customersService.findAllCustomers();
    for (const c of customers) {
      const entity = new AgencyCreditLimit({
        id: `crd-${c.id}`,
        agencyId: c.id,
        agencyCode: c.code,
        agencyName: c.name,
        customerGroup: c.customerGroup,
        phone: c.phone,
        email: c.email,
        region: c.region,
        salesRepId: c.salesRepId,
        salesRepName: c.salesRepName,
        creditLimit: c.creditLimit,
        maxDebtDays: c.maxDebtDays,
        currentDebt: c.currentDebt,
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

      this.agencyCreditLimits.set(c.id, entity);
    }
  }

  /**
   * Khởi tạo các bản ghi lịch sử mẫu phục vụ kiểm toán và demo
   */
  private seedInitialLogs(): void {
    const initialSeedData: Partial<CreditLimitLog>[] = [
      {
        id: randomUUID(),
        agencyId: 'cust-001',
        agencyCode: 'DL-HCM-001',
        agencyName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        oldCreditLimit: 80000000,
        newCreditLimit: 100000000,
        oldMaxDebtDays: 20,
        newMaxDebtDays: 30,
        oldPaymentTerms: 'NET_20',
        newPaymentTerms: 'NET_30',
        oldTemporaryLimit: 0,
        newTemporaryLimit: 0,
        reason: 'Nâng hạn mức công nợ quý theo doanh số đại lý phân phối cấp 1',
        performedBy: 'Kế toán trưởng Nguyễn Thu Hà',
        performedByRole: Role.ACCOUNTANT_DEBT,
        performedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
      },
      {
        id: randomUUID(),
        agencyId: 'cust-005',
        agencyCode: 'DL-HCM-004',
        agencyName: 'Công Ty TNHH Thương Mại & Dịch Vụ Hoàng Gia',
        oldCreditLimit: 150000000,
        newCreditLimit: 200000000,
        oldMaxDebtDays: 30,
        newMaxDebtDays: 30,
        oldPaymentTerms: 'NET_30',
        newPaymentTerms: 'NET_30',
        oldTemporaryLimit: 0,
        newTemporaryLimit: 0,
        reason: 'Đại lý ký hợp đồng cam kết doanh số năm, nâng trần hạn mức',
        performedBy: 'Trưởng phòng KD Trần Văn Long',
        performedByRole: Role.BUSINESS_MANAGER,
        performedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12),
      },
    ];

    for (const item of initialSeedData) {
      this.creditLimitLogs.push(new CreditLimitLog(item));
    }
  }

  /**
   * Lấy danh sách hạn mức công nợ đại lý kèm tìm kiếm và phân trang
   */
  async getCreditLimits(
    query?: QueryCreditLimitDto,
  ): Promise<PaginatedCreditLimitResult> {
    if (this.agencyCreditLimits.size === 0) {
      await this.syncFromCustomers();
    }

    let items = Array.from(this.agencyCreditLimits.values());

    if (query?.search) {
      const searchKey = query.search.toLowerCase().trim();
      items = items.filter(
        (item) =>
          item.agencyName.toLowerCase().includes(searchKey) ||
          item.agencyCode.toLowerCase().includes(searchKey) ||
          item.phone.includes(searchKey),
      );
    }

    if (query?.status) {
      items = items.filter((item) => item.status === query.status);
    }

    if (query?.customerGroup) {
      items = items.filter(
        (item) => item.customerGroup === query.customerGroup,
      );
    }

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
      } else if (sortBy === 'agencyName' || sortBy === 'customerName') {
        valA = a.agencyName;
        valB = b.agencyName;
      } else {
        valA = a.updatedAt.getTime();
        valB = b.updatedAt.getTime();
      }

      if (valA < valB) return sortOrder === 'ASC' ? -1 : 1;
      if (valA > valB) return sortOrder === 'ASC' ? 1 : -1;
      return 0;
    });

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
   * Lấy chi tiết hạn mức công nợ theo agencyId (hoặc customerId)
   */
  async getAgencyCreditLimitById(agencyId: string): Promise<AgencyCreditLimit> {
    const item = this.agencyCreditLimits.get(agencyId);
    if (!item) {
      throw new NotFoundException(
        `Không tìm thấy dữ liệu hạn mức công nợ cho đại lý: ${agencyId}`,
      );
    }
    return item;
  }

  /** Alias cho tương thích ngược */
  async getCreditLimitById(agencyId: string): Promise<AgencyCreditLimit> {
    return this.getAgencyCreditLimitById(agencyId);
  }

  /**
   * Thống kê tổng quan hạn mức công nợ toàn hệ thống (SN-34)
   */
  async getCreditLimitStats(): Promise<CreditLimitStatsDto> {
    if (this.agencyCreditLimits.size === 0) {
      await this.syncFromCustomers();
    }

    const items = Array.from(this.agencyCreditLimits.values());
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
   * Cập nhật hạn mức công nợ và ghi Audit Log trong cùng 1 Database Transaction (SN-34)
   * Yêu cầu role ACCOUNTANT_DEBT hoặc BUSINESS_MANAGER
   */
  async updateCreditLimit(
    agencyId: string,
    dto: UpdateCreditLimitDto,
    currentUser?: ICurrentUser,
  ): Promise<AgencyCreditLimit> {
    const currentEntity = await this.getAgencyCreditLimitById(agencyId);

    const oldCreditLimit = currentEntity.creditLimit;
    const oldMaxDebtDays = currentEntity.maxDebtDays;
    const newCreditLimit = dto.creditLimit;
    const newMaxDebtDays = dto.maxDebtDays;

    const actorName =
      currentUser?.username || currentUser?.email || 'Kế toán công nợ';
    const actorRole =
      currentUser?.roles?.[0] || Role.ACCOUNTANT_DEBT;

    const oldValues: Record<string, unknown> = {
      creditLimit: oldCreditLimit,
      maxDebtDays: oldMaxDebtDays,
      paymentTerms: currentEntity.paymentTerms,
      temporaryCreditLimit: currentEntity.temporaryCreditLimit,
      status: currentEntity.status,
    };

    const newValues: Record<string, unknown> = {
      creditLimit: newCreditLimit,
      maxDebtDays: newMaxDebtDays,
      paymentTerms: dto.paymentTerms ?? currentEntity.paymentTerms,
      temporaryCreditLimit:
        dto.temporaryCreditLimit ?? currentEntity.temporaryCreditLimit,
      reason: dto.reason.trim(),
    };

    const auditSummary = `Điều chỉnh hạn mức công nợ đại lý ${currentEntity.agencyCode} (${currentEntity.agencyName}) từ ${oldCreditLimit.toLocaleString('vi-VN')} đ (thời hạn: ${oldMaxDebtDays} ngày) thành ${newCreditLimit.toLocaleString('vi-VN')} đ (thời hạn: ${newMaxDebtDays} ngày). Lý do: ${dto.reason.trim()}`;

    // =========================================================================
    // DATABASE TRANSACTION: Cập nhật hạn mức & Ghi Audit Log trong cùng 1 Transaction
    // =========================================================================
    if (this.dbService?.isConnected()) {
      const client = await this.dbService.getClient();
      try {
        await client.query('BEGIN');

        // 1. Cập nhật bảng customers
        await client.query(
          `UPDATE customers
           SET credit_limit = $1,
               max_debt_days = $2,
               payment_terms = $3,
               updated_at = NOW()
           WHERE id = $4 OR code = $4;`,
          [
            newCreditLimit,
            newMaxDebtDays,
            dto.paymentTerms ?? currentEntity.paymentTerms,
            agencyId,
          ],
        );

        // 2. Ghi Audit Log vào bảng audit_logs trong cùng transaction
        const auditLogId = randomUUID();
        const userId = currentUser?.userId || null;
        await client.query(
          `INSERT INTO audit_logs (id, user_id, action, entity_name, entity_id, old_values, new_values, ip_address, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (id) DO NOTHING;`,
          [
            auditLogId,
            userId,
            AuditAction.UPDATE,
            AuditEntity.DEBT,
            currentEntity.agencyCode,
            JSON.stringify(oldValues),
            JSON.stringify(newValues),
            '127.0.0.1',
          ],
        );

        await client.query('COMMIT');
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        const errorMsg = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(
          `Lỗi thực thi Database Transaction khi cập nhật hạn mức và ghi Audit Log: ${errorMsg}`,
        );
      } finally {
        client.release();
      }
    }

    // 3. Đồng bộ CustomersService in-memory
    await this.customersService.updateCustomerCredit(agencyId, {
      creditLimit: newCreditLimit,
      maxDebtDays: newMaxDebtDays,
      paymentTerms: dto.paymentTerms,
    });

    // 4. Cập nhật AgencyCreditLimit Entity
    currentEntity.creditLimit = newCreditLimit;
    currentEntity.maxDebtDays = newMaxDebtDays;
    if (dto.paymentTerms) currentEntity.paymentTerms = dto.paymentTerms;
    if (dto.temporaryCreditLimit !== undefined) {
      currentEntity.temporaryCreditLimit = dto.temporaryCreditLimit;
    }
    if (dto.temporaryLimitExpiry) {
      currentEntity.temporaryLimitExpiry = new Date(dto.temporaryLimitExpiry);
    }
    if (dto.allowOverLimitOrder !== undefined) {
      currentEntity.allowOverLimitOrder = dto.allowOverLimitOrder;
    }
    currentEntity.lastAdjustedAt = new Date();
    currentEntity.lastAdjustedBy = actorName;
    currentEntity.updatedAt = new Date();

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
      if (currentEntity.currentDebt > effectiveLimit && effectiveLimit > 0) {
        currentEntity.status = CreditStatus.EXCEEDED;
      } else if (currentEntity.debtUsagePercentage >= 80) {
        currentEntity.status = CreditStatus.WARNING;
      } else {
        currentEntity.status = CreditStatus.NORMAL;
      }
    }

    // 5. Ghi nhận CreditLimitLog (Lịch sử thay đổi)
    const logItem = new CreditLimitLog({
      id: randomUUID(),
      agencyId,
      agencyCode: currentEntity.agencyCode,
      agencyName: currentEntity.agencyName,
      oldCreditLimit,
      newCreditLimit,
      oldMaxDebtDays,
      newMaxDebtDays,
      oldPaymentTerms: String(oldValues.paymentTerms),
      newPaymentTerms: currentEntity.paymentTerms,
      reason: dto.reason.trim(),
      performedBy: actorName,
      performedByRole: String(actorRole),
      performedAt: new Date(),
    });
    this.creditLimitLogs.unshift(logItem);

    // 6. Ghi nhận AuditLog qua AuditLogsService
    await this.auditLogsService.recordLog({
      userId: currentUser?.userId || 'usr-acc-006',
      action: AuditAction.UPDATE,
      entityName: AuditEntity.DEBT,
      entityId: currentEntity.agencyCode,
      oldValues,
      newValues,
      ipAddress: '127.0.0.1',
      summary: auditSummary,
    });

    return currentEntity;
  }

  /**
   * Khóa hoặc Mở khóa hạn mức tín dụng đại lý
   */
  async updateCreditStatus(
    agencyId: string,
    dto: UpdateCreditStatusDto,
    currentUser?: ICurrentUser,
  ): Promise<AgencyCreditLimit> {
    const currentEntity = await this.getAgencyCreditLimitById(agencyId);

    const oldStatus = currentEntity.status;
    const actorName =
      currentUser?.username || currentUser?.email || 'Kế toán công nợ';

    currentEntity.status = dto.status;
    currentEntity.lockReason =
      dto.status === CreditStatus.BLOCKED ? dto.reason.trim() : undefined;
    currentEntity.updatedAt = new Date();

    await this.customersService.updateCustomerStatus(
      agencyId,
      dto.status === CreditStatus.BLOCKED
        ? CustomerStatus.LOCKED
        : CustomerStatus.ACTIVE,
      dto.reason.trim(),
    );

    await this.auditLogsService.recordLog({
      userId: currentUser?.userId || 'usr-acc-006',
      action: AuditAction.UPDATE,
      entityName: AuditEntity.DEBT,
      entityId: currentEntity.agencyCode,
      oldValues: { status: oldStatus },
      newValues: { status: dto.status, reason: dto.reason.trim() },
      ipAddress: '127.0.0.1',
      summary: `${dto.status === CreditStatus.BLOCKED ? 'Khóa hạn mức' : 'Mở khóa hạn mức'} công nợ đại lý ${currentEntity.agencyCode} (${currentEntity.agencyName}). Lý do: ${dto.reason.trim()} (Bởi ${actorName})`,
    });

    return currentEntity;
  }

  /**
   * Lấy lịch sử thay đổi hạn mức của đại lý (CreditLimitLog)
   */
  async getCreditLimitLogs(agencyId: string): Promise<CreditLimitLog[]> {
    return this.creditLimitLogs.filter((log) => log.agencyId === agencyId);
  }

  /** Alias phục vụ tương thích ngược */
  async getCreditLimitHistory(agencyId: string): Promise<CreditLimitLog[]> {
    return this.getCreditLimitLogs(agencyId);
  }
}
