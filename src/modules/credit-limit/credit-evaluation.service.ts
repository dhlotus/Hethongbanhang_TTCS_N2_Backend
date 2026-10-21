import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CustomersService } from '../customers/customers.service';
import { CustomerStatus } from '../customers/entities/customer.entity';
import { InvoicesService } from '../invoices/invoices.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditEntity } from '../../common/enums';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import {
  AgencyCreditEvaluationResult,
  AgencyCreditFlag,
  CreditConfigDto,
  CreditEnforcementMode,
  UpdateCreditConfigDto,
} from './dto/credit-config.dto';
import { AgencyCreditEntity } from './entities/agency-credit.entity';
import { CreditStatus } from './enums/credit-status.enum';

/**
 * Service Đánh giá Công nợ, Gắn cờ Cảnh báo & Khóa bán Đại lý (SN-204)
 * - Tự động gắn cờ đại lý khi nợ vượt hạn mức hoặc quá hạn số ngày nợ cho phép
 * - Chế độ xử lý: Chặn tạo đơn (BLOCK_ORDER) hoặc Yêu cầu phê duyệt (REQUIRE_APPROVAL)
 * - CronJob: Chạy định kỳ lúc 00:00 mỗi ngày để quét và đánh giá lại toàn bộ đại lý
 * - Event Trigger: Đánh giá lại cờ ngay khi ghi nhận giao dịch thu tiền thành công
 */
@Injectable()
export class CreditEvaluationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CreditEvaluationService.name);

  /** Cấu hình kiểm soát công nợ toàn hệ thống */
  private systemConfig: CreditConfigDto = {
    enforcementMode: CreditEnforcementMode.BLOCK_ORDER,
    autoFlaggingEnabled: true,
    warningThresholdPercentage: 80,
    gracePeriodDays: 0,
    updatedAt: new Date(),
    updatedBy: 'Hệ thống tự động',
  };

  /** Bộ nhớ lưu trữ kết quả đánh giá cờ của từng đại lý */
  private readonly agencyCredits = new Map<string, AgencyCreditEntity>();

  /** Quản lý Timer của CronJob */
  private cronTimer: NodeJS.Timeout | null = null;
  private intervalCheckTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    @Optional()
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService?: InvoicesService,
    @Optional()
    private readonly auditLogsService?: AuditLogsService,
    @Optional()
    private readonly dbService?: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initDatabaseSchema();
    await this.loadConfigFromDatabase();
    await this.evaluateAllAgencies();
    this.startDailyCronJob();
  }

  onModuleDestroy(): void {
    this.stopDailyCronJob();
  }

  // =========================================================================
  // 1. CẤU HÌNH HỆ THỐNG (CREDIT CONFIG)
  // =========================================================================

  /**
   * Lấy cấu hình kiểm soát công nợ hiện tại
   */
  getConfig(): CreditConfigDto {
    return { ...this.systemConfig };
  }

  /**
   * Cập nhật cấu hình kiểm soát công nợ
   */
  async updateConfig(
    dto: UpdateCreditConfigDto,
    currentUser?: ICurrentUser,
  ): Promise<CreditConfigDto> {
    const oldMode = this.systemConfig.enforcementMode;
    const actorName =
      currentUser?.username || currentUser?.email || 'Quản trị viên / Kế toán';

    this.systemConfig = {
      enforcementMode: dto.enforcementMode,
      autoFlaggingEnabled:
        dto.autoFlaggingEnabled ?? this.systemConfig.autoFlaggingEnabled,
      warningThresholdPercentage:
        dto.warningThresholdPercentage ??
        this.systemConfig.warningThresholdPercentage,
      gracePeriodDays:
        dto.gracePeriodDays ?? this.systemConfig.gracePeriodDays,
      updatedAt: new Date(),
      updatedBy: actorName,
    };

    // Lưu vào database nếu có kết nối
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `INSERT INTO app_credit_configs (id, enforcement_mode, auto_flagging_enabled, warning_threshold_percentage, grace_period_days, updated_at, updated_by)
           VALUES ('global', $1, $2, $3, $4, NOW(), $5)
           ON CONFLICT (id) DO UPDATE SET
             enforcement_mode = EXCLUDED.enforcement_mode,
             auto_flagging_enabled = EXCLUDED.auto_flagging_enabled,
             warning_threshold_percentage = EXCLUDED.warning_threshold_percentage,
             grace_period_days = EXCLUDED.grace_period_days,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by;`,
          [
            this.systemConfig.enforcementMode,
            this.systemConfig.autoFlaggingEnabled,
            this.systemConfig.warningThresholdPercentage,
            this.systemConfig.gracePeriodDays,
            actorName,
          ],
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[CreditEvaluationService] Lỗi lưu cấu hình DB: ${msg}`);
      }
    }

    if (this.auditLogsService) {
      await this.auditLogsService.recordLog({
        userId: currentUser?.userId || 'usr-admin',
        action: AuditAction.UPDATE,
        entityName: AuditEntity.DEBT,
        entityId: 'CREDIT_CONFIG',
        oldValues: { enforcementMode: oldMode },
        newValues: { ...this.systemConfig },
        ipAddress: '127.0.0.1',
        summary: `Cập nhật cấu hình công nợ hệ thống sang chế độ ${this.systemConfig.enforcementMode} (Bởi ${actorName})`,
      });
    }


    this.logger.log(
      `[CreditEvaluationService] Đã cập nhật chế độ xử lý công nợ: ${this.systemConfig.enforcementMode}`,
    );

    return this.getConfig();
  }

  // =========================================================================
  // 2. NGHIỆP VỤ ĐÁNH GIÁ & GẮN CỜ CÔNG NỢ ĐẠI LÝ (AUTO FLAGGING)
  // =========================================================================

  /**
   * Đánh giá chi tiết trạng thái công nợ của 1 đại lý (SN-204)
   * Tiêu chí gắn cờ:
   * 1. Nợ hiện tại > Hạn mức tiền cho phép (Over limit)
   *    HOẶC
   * 2. Có khoản nợ có Số ngày nợ > Số ngày quá hạn cho phép (Overdue)
   */
  async evaluateAgencyCredit(agencyId: string): Promise<AgencyCreditEvaluationResult> {
    const customer = await this.customersService.findById(agencyId);
    if (!customer) {
      throw new NotFoundException(`Không tìm thấy đại lý với mã/id: ${agencyId}`);
    }

    const creditLimit = Math.max(0, Number(customer.creditLimit || 0));
    const maxDebtDays = Math.max(1, Number(customer.maxDebtDays || 30));
    const now = new Date();

    // 1. Thu thập thông tin hóa đơn nợ của đại lý
    let unpaidInvoices: Array<{
      id: string;
      code: string;
      remainingAmount: number;
      issueDate: Date;
      dueDate: Date;
    }> = [];

    if (this.invoicesService) {
      try {
        const res = await this.invoicesService.findAll({ customerId: customer.id });
        const invoiceList: any[] = Array.isArray(res) ? res : (res as any)?.items || (res as any)?.data || [];
        unpaidInvoices = invoiceList
          .filter((inv) => inv && inv.remainingAmount > 0)
          .map((inv) => ({
            id: inv.id,
            code: inv.invoiceCode,
            remainingAmount: inv.remainingAmount,
            issueDate: new Date(inv.issueDate),
            dueDate: new Date(inv.dueDate),
          }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[CreditEvaluationService] Lỗi lấy hóa đơn từ invoicesService: ${msg}`);
      }
    }

    // Tính tổng nợ: ưu tiên tổng nợ còn lại từ các hóa đơn thực tế nếu có, hoặc từ customer.currentDebt
    const invoiceTotalDebt = unpaidInvoices.reduce((sum, inv) => sum + inv.remainingAmount, 0);
    const currentDebt = Math.max(customer.currentDebt || 0, invoiceTotalDebt);

    // 2. Tính số ngày nợ và số ngày quá hạn
    let oldestDebtDays = 0;
    let maxOverdueDays = 0;
    let totalOverdueAmount = 0;
    const overdueInvoicesList: string[] = [];

    for (const inv of unpaidInvoices) {
      const debtDays = Math.max(
        0,
        Math.floor((now.getTime() - inv.issueDate.getTime()) / (1000 * 60 * 60 * 24)),
      );
      if (debtDays > oldestDebtDays) {
        oldestDebtDays = debtDays;
      }

      // Quá hạn khi ngày hiện tại vượt quá ngày hẹn trả dueDate hoặc số ngày nợ > maxDebtDays
      const daysPastDue = Math.max(
        0,
        Math.floor((now.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24)),
      );

      const isInvoiceOverdue = daysPastDue > 0 || debtDays > maxDebtDays;
      if (isInvoiceOverdue) {
        const effectiveOverdueDays = Math.max(daysPastDue, debtDays - maxDebtDays);
        if (effectiveOverdueDays > maxOverdueDays) {
          maxOverdueDays = effectiveOverdueDays;
        }
        totalOverdueAmount += inv.remainingAmount;
        overdueInvoicesList.push(
          `${inv.code} (Nợ ${inv.remainingAmount.toLocaleString('vi-VN')} đ, nợ ${debtDays} ngày - quá hạn ${effectiveOverdueDays} ngày)`,
        );
      }
    }

    // Nếu customer có lưu sẵn overdueDays / overdueAmount từ trước mà invoices chưa cập nhật
    if (customer.overdueDays && customer.overdueDays > maxOverdueDays) {
      maxOverdueDays = customer.overdueDays;
    }
    if (customer.overdueAmount && customer.overdueAmount > totalOverdueAmount) {
      totalOverdueAmount = customer.overdueAmount;
    }

    // 3. Kiểm tra điều kiện gắn cờ
    const reasons: string[] = [];

    // Điều kiện 1: Nợ hiện tại > Hạn mức tiền cho phép
    const isExceededLimit = creditLimit > 0 && currentDebt > creditLimit;
    const overLimitAmount = isExceededLimit ? currentDebt - creditLimit : 0;
    if (isExceededLimit) {
      reasons.push(
        `Vượt hạn mức nợ ${overLimitAmount.toLocaleString('vi-VN')} đ (Dư nợ ${currentDebt.toLocaleString('vi-VN')} đ / Hạn mức ${creditLimit.toLocaleString('vi-VN')} đ)`,
      );
    }

    // Điều kiện 2: Có khoản nợ có Số ngày nợ > Số ngày quá hạn cho phép
    const isOverdueDebt =
      maxOverdueDays > this.systemConfig.gracePeriodDays ||
      oldestDebtDays > maxDebtDays + this.systemConfig.gracePeriodDays;

    if (isOverdueDebt) {
      reasons.push(
        `Có khoản nợ quá hạn ${maxOverdueDays} ngày (Số ngày nợ tối đa cho phép là ${maxDebtDays} ngày, tổng nợ quá hạn: ${totalOverdueAmount.toLocaleString('vi-VN')} đ)`,
      );
      if (overdueInvoicesList.length > 0) {
        reasons.push(`Hóa đơn quá hạn: ${overdueInvoicesList.slice(0, 3).join('; ')}`);
      }
    }

    // Xác định cờ
    let isFlagged = false;
    let flagType = AgencyCreditFlag.CLEAR;

    if (this.systemConfig.autoFlaggingEnabled) {
      if (isExceededLimit && isOverdueDebt) {
        isFlagged = true;
        flagType = AgencyCreditFlag.EXCEEDED_AND_OVERDUE;
      } else if (isExceededLimit) {
        isFlagged = true;
        flagType = AgencyCreditFlag.EXCEEDED_LIMIT;
      } else if (isOverdueDebt) {
        isFlagged = true;
        flagType = AgencyCreditFlag.OVERDUE;
      }
    }

    // 4. Lưu thực thể AgencyCreditEntity
    const existing = this.agencyCredits.get(customer.id);
    const agencyCredit = new AgencyCreditEntity({
      id: existing?.id || `ac-${customer.id}`,
      agencyId: customer.id,
      agencyCode: customer.code,
      agencyName: customer.name,
      creditLimit,
      currentDebt,
      overLimitAmount,
      maxDebtDays,
      oldestDebtDays,
      overdueDays: maxOverdueDays,
      overdueAmount: totalOverdueAmount,
      isFlagged,
      flagType,
      flagReasons: reasons,
      flaggedAt: isFlagged ? existing?.flaggedAt || new Date() : undefined,
      status: isFlagged ? CreditStatus.BLOCKED : CreditStatus.NORMAL,
      enforcementMode: this.systemConfig.enforcementMode,
      lastEvaluatedAt: now,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    this.agencyCredits.set(customer.id, agencyCredit);
    this.agencyCredits.set(customer.code, agencyCredit);

    // Đồng bộ trạng thái vào PostgreSQL DB
    await this.persistAgencyCredit(agencyCredit);

    // Phân quyền tạo đơn theo chế độ xử lý (Enforcement Mode)
    const canCreateOrder = !isFlagged || this.systemConfig.enforcementMode === CreditEnforcementMode.REQUIRE_APPROVAL;
    const requiresApproval = isFlagged && this.systemConfig.enforcementMode === CreditEnforcementMode.REQUIRE_APPROVAL;

    return {
      agencyId: customer.id,
      agencyCode: customer.code,
      agencyName: customer.name,
      isFlagged,
      flagType,
      currentDebt,
      creditLimit,
      overLimitAmount,
      maxDebtDays,
      oldestDebtDays,
      overdueDays: maxOverdueDays,
      overdueAmount: totalOverdueAmount,
      reasons,
      enforcementMode: this.systemConfig.enforcementMode,
      canCreateOrder,
      requiresApproval,
      evaluatedAt: now,
    };
  }

  /**
   * Đánh giá lại toàn bộ đại lý trong hệ thống
   */
  async evaluateAllAgencies(): Promise<AgencyCreditEvaluationResult[]> {
    this.logger.log('[CreditEvaluationService] Bắt đầu đánh giá công nợ toàn bộ đại lý...');
    const results: AgencyCreditEvaluationResult[] = [];

    try {
      const customers = await this.customersService.findAllCustomers();
      for (const customer of customers) {
        try {
          const res = await this.evaluateAgencyCredit(customer.id);
          results.push(res);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[CreditEvaluationService] Lỗi đánh giá đại lý ${customer.code}: ${msg}`,
          );
        }
      }

      const flaggedCount = results.filter((r) => r.isFlagged).length;
      this.logger.log(
        `[CreditEvaluationService] Hoàn tất đánh giá ${results.length} đại lý. Số đại lý bị gắn cờ: ${flaggedCount}.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[CreditEvaluationService] Lỗi trong quá trình quét toàn bộ đại lý: ${msg}`);
    }

    return results;
  }

  // =========================================================================
  // 3. EVENT TRIGGER: ĐÁNH GIÁ LẠI SAU KHI THU TIỀN THÀNH CÔNG
  // =========================================================================

  /**
   * Kích hoạt đánh giá lại trạng thái cờ của đại lý ngay sau khi ghi nhận một giao dịch thu tiền thành công (SN-204)
   * Nếu nợ đã về mức an toàn và không còn nợ quá hạn, hệ thống tự động gỡ cờ!
   */
  async onPaymentReceived(
    agencyId: string,
    receiptInfo?: { amount?: number; code?: string },
  ): Promise<AgencyCreditEvaluationResult> {
    this.logger.log(
      `[CreditEvaluationService] [Event Trigger] Ghi nhận thu tiền thành công cho đại lý ${agencyId}${
        receiptInfo?.code ? ` (Phiếu: ${receiptInfo.code})` : ''
      }. Tiến hành đánh giá lại cờ công nợ...`,
    );

    const result = await this.evaluateAgencyCredit(agencyId);

    if (!result.isFlagged) {
      this.logger.log(
        `[CreditEvaluationService] ✅ Đại lý ${result.agencyCode} (${result.agencyName}) đã thanh toán công nợ và được TỰ ĐỘNG GỠ CỜ CẢNH BÁO.`,
      );
    } else {
      this.logger.log(
        `[CreditEvaluationService] ⚠️ Đại lý ${result.agencyCode} vẫn đang bị gắn cờ: ${result.reasons.join(', ')}`,
      );
    }

    return result;
  }

  // =========================================================================
  // 4. KIỂM TRA ĐIỀU KIỆN TẠO ĐƠN HÀNG (DÙNG TRONG ORDERS.SERVICE)
  // =========================================================================

  /**
   * Kiểm tra xem đại lý có được phép tạo đơn hàng hay không dựa trên cờ và chế độ xử lý (SN-204)
   */
  async checkOrderCreationAllowed(
    agencyId: string,
    additionalOrderAmount = 0,
  ): Promise<{
    allowed: boolean;
    requiresApproval: boolean;
    isFlagged: boolean;
    flagType: AgencyCreditFlag;
    reasons: string[];
    enforcementMode: CreditEnforcementMode;
    errorMessage?: string;
  }> {
    const evaluation = await this.evaluateAgencyCredit(agencyId);

    // Kiểm tra thêm trường hợp đơn hàng mới làm tổng nợ vượt hạn mức
    const projectedDebt = evaluation.currentDebt + additionalOrderAmount;
    const willExceedWithNewOrder =
      evaluation.creditLimit > 0 && projectedDebt > evaluation.creditLimit;

    const reasons = [...evaluation.reasons];
    if (willExceedWithNewOrder && !evaluation.isFlagged) {
      reasons.push(
        `Đơn hàng mới (${additionalOrderAmount.toLocaleString('vi-VN')} đ) làm tổng công nợ đạt ${projectedDebt.toLocaleString('vi-VN')} đ, vượt hạn mức ${evaluation.creditLimit.toLocaleString('vi-VN')} đ`,
      );
    }

    const hasViolation = evaluation.isFlagged || willExceedWithNewOrder;

    if (!hasViolation) {
      return {
        allowed: true,
        requiresApproval: false,
        isFlagged: false,
        flagType: AgencyCreditFlag.CLEAR,
        reasons: [],
        enforcementMode: this.systemConfig.enforcementMode,
      };
    }

    // Xử lý theo cấu hình
    if (this.systemConfig.enforcementMode === CreditEnforcementMode.BLOCK_ORDER) {
      const reasonDetail = reasons.join('; ');
      return {
        allowed: false,
        requiresApproval: false,
        isFlagged: true,
        flagType: evaluation.flagType,
        reasons,
        enforcementMode: CreditEnforcementMode.BLOCK_ORDER,
        errorMessage: `[SN-204] Đại lý "${evaluation.agencyName}" (${evaluation.agencyCode}) đang bị KHÓA BÁN do vi phạm chính sách công nợ (${reasonDetail}). Chế độ hệ thống: BLOCK_ORDER (Chặn tạo đơn mới).`,
      };
    }

    // Chế độ REQUIRE_APPROVAL
    return {
      allowed: true,
      requiresApproval: true,
      isFlagged: true,
      flagType: evaluation.flagType,
      reasons,
      enforcementMode: CreditEnforcementMode.REQUIRE_APPROVAL,
    };
  }

  // =========================================================================
  // 5. CRONJOB ĐỊNH KỲ: CHẠY LÚC 00:00 HÀNG NGÀY (MÚI GIỜ VIỆT NAM)
  // =========================================================================

  /**
   * Khởi chạy CronJob định kỳ lúc 00:00 sáng mỗi ngày
   */
  startDailyCronJob(): void {
    if (this.cronTimer) return;
    this.logger.log(
      '[CreditEvaluationService] Khởi động CronJob kiểm tra và đánh giá công nợ đại lý định kỳ (00:00 hàng ngày, Asia/Ho_Chi_Minh).',
    );

    this.scheduleNextMidnightRun();

    // Đồng thời chạy kiểm tra mỗi 30 phút để tránh trường hợp timer bị lệch do sleep/wake
    this.intervalCheckTimer = setInterval(async () => {
      const vnDate = this.getVietnamDate();
      const hour = vnDate.getHours();
      const minute = vnDate.getMinutes();

      // Nếu trong khung giờ 00:00 - 00:05
      if (hour === 0 && minute <= 5) {
        this.logger.log(
          '[CreditEvaluationService] [Interval Heartbeat] Kích hoạt quét công nợ ngày mới lúc 00:00.',
        );
        await this.evaluateAllAgencies();
      }
    }, 30 * 60 * 1000);
  }

  /**
   * Tính toán thời gian còn lại đến 00:00 ngày tiếp theo theo múi giờ Việt Nam
   */
  private scheduleNextMidnightRun(): void {
    const nowVN = this.getVietnamDate();
    const nextMidnightVN = new Date(nowVN);
    nextMidnightVN.setDate(nextMidnightVN.getDate() + 1);
    nextMidnightVN.setHours(0, 0, 0, 0);

    const msUntilMidnight = Math.max(1000, nextMidnightVN.getTime() - nowVN.getTime());

    this.logger.log(
      `[CreditEvaluationService] Lần chạy CronJob tiếp theo dự kiến sau ${Math.round(
        msUntilMidnight / 60000,
      )} phút (00:00 ngày ${nextMidnightVN.toISOString().slice(0, 10)}).`,
    );

    this.cronTimer = setTimeout(async () => {
      try {
        this.logger.log(
          '[CreditEvaluationService] ⏰ [CronJob 00:00] Bắt đầu quét đánh giá công nợ định kỳ toàn bộ đại lý...',
        );
        await this.evaluateAllAgencies();
      } finally {
        this.scheduleNextMidnightRun();
      }
    }, msUntilMidnight);
  }

  stopDailyCronJob(): void {
    if (this.cronTimer) {
      clearTimeout(this.cronTimer);
      this.cronTimer = null;
    }
    if (this.intervalCheckTimer) {
      clearInterval(this.intervalCheckTimer);
      this.intervalCheckTimer = null;
    }
    this.logger.log('[CreditEvaluationService] Đã dừng CronJob đánh giá công nợ.');
  }

  // =========================================================================
  // 6. TRUY VẤN DATABASE & PERSISTENCE
  // =========================================================================

  private getVietnamDate(date = new Date()): Date {
    return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  }

  private async initDatabaseSchema(): Promise<void> {
    if (!this.dbService?.isConnected()) return;

    try {
      await this.dbService.query(`
        CREATE TABLE IF NOT EXISTS app_credit_configs (
          id VARCHAR(64) PRIMARY KEY,
          enforcement_mode VARCHAR(50) NOT NULL DEFAULT 'BLOCK_ORDER',
          auto_flagging_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          warning_threshold_percentage INT NOT NULL DEFAULT 80,
          grace_period_days INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_by VARCHAR(150)
        );

        CREATE TABLE IF NOT EXISTS app_agency_credits (
          id VARCHAR(64) PRIMARY KEY,
          agency_id VARCHAR(64) NOT NULL UNIQUE,
          agency_code VARCHAR(100) NOT NULL,
          agency_name VARCHAR(255) NOT NULL,
          credit_limit NUMERIC(15, 2) NOT NULL DEFAULT 0,
          current_debt NUMERIC(15, 2) NOT NULL DEFAULT 0,
          over_limit_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
          max_debt_days INT NOT NULL DEFAULT 30,
          oldest_debt_days INT NOT NULL DEFAULT 0,
          overdue_days INT NOT NULL DEFAULT 0,
          overdue_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
          is_flagged BOOLEAN NOT NULL DEFAULT FALSE,
          flag_type VARCHAR(50) NOT NULL DEFAULT 'CLEAR',
          flag_reasons TEXT[],
          flagged_at TIMESTAMPTZ,
          status VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
          enforcement_mode VARCHAR(50) NOT NULL DEFAULT 'BLOCK_ORDER',
          last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_agency_credits_is_flagged ON app_agency_credits(is_flagged);
        CREATE INDEX IF NOT EXISTS idx_agency_credits_agency_code ON app_agency_credits(agency_code);
      `);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[CreditEvaluationService] Lỗi tạo bảng DB: ${msg}`);
    }
  }

  private async loadConfigFromDatabase(): Promise<void> {
    if (!this.dbService?.isConnected()) return;

    try {
      const rows = await this.dbService.query<{
        enforcement_mode: CreditEnforcementMode;
        auto_flagging_enabled: boolean;
        warning_threshold_percentage: number;
        grace_period_days: number;
        updated_at: Date;
        updated_by: string;
      }>(`SELECT * FROM app_credit_configs WHERE id = 'global' LIMIT 1;`);

      if (rows && rows[0]) {
        const r = rows[0];
        this.systemConfig = {
          enforcementMode: r.enforcement_mode || CreditEnforcementMode.BLOCK_ORDER,
          autoFlaggingEnabled: r.auto_flagging_enabled ?? true,
          warningThresholdPercentage: Number(r.warning_threshold_percentage || 80),
          gracePeriodDays: Number(r.grace_period_days || 0),
          updatedAt: new Date(r.updated_at),
          updatedBy: r.updated_by || 'Hệ thống',
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[CreditEvaluationService] Lỗi tải cấu hình từ DB: ${msg}`);
    }
  }

  private async persistAgencyCredit(entity: AgencyCreditEntity): Promise<void> {
    if (!this.dbService?.isConnected()) return;

    try {
      await this.dbService.query(
        `INSERT INTO app_agency_credits (
          id, agency_id, agency_code, agency_name, credit_limit, current_debt,
          over_limit_amount, max_debt_days, oldest_debt_days, overdue_days,
          overdue_amount, is_flagged, flag_type, flag_reasons, flagged_at,
          status, enforcement_mode, last_evaluated_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        ) ON CONFLICT (agency_id) DO UPDATE SET
          credit_limit = EXCLUDED.credit_limit,
          current_debt = EXCLUDED.current_debt,
          over_limit_amount = EXCLUDED.over_limit_amount,
          max_debt_days = EXCLUDED.max_debt_days,
          oldest_debt_days = EXCLUDED.oldest_debt_days,
          overdue_days = EXCLUDED.overdue_days,
          overdue_amount = EXCLUDED.overdue_amount,
          is_flagged = EXCLUDED.is_flagged,
          flag_type = EXCLUDED.flag_type,
          flag_reasons = EXCLUDED.flag_reasons,
          flagged_at = EXCLUDED.flagged_at,
          status = EXCLUDED.status,
          enforcement_mode = EXCLUDED.enforcement_mode,
          last_evaluated_at = EXCLUDED.last_evaluated_at,
          updated_at = NOW();`,
        [
          entity.id,
          entity.agencyId,
          entity.agencyCode,
          entity.agencyName,
          entity.creditLimit,
          entity.currentDebt,
          entity.overLimitAmount,
          entity.maxDebtDays,
          entity.oldestDebtDays,
          entity.overdueDays,
          entity.overdueAmount,
          entity.isFlagged,
          entity.flagType,
          entity.flagReasons,
          entity.flaggedAt,
          entity.status,
          entity.enforcementMode,
          entity.lastEvaluatedAt,
          entity.createdAt,
          entity.updatedAt,
        ],
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[CreditEvaluationService] Lỗi lưu trạng thái cờ vào DB: ${msg}`);
    }
  }

  /**
   * Lấy thực thể AgencyCreditEntity đã lưu trong bộ nhớ hoặc DB
   */
  async getAgencyCredit(agencyId: string): Promise<AgencyCreditEntity | null> {
    const inMem = this.agencyCredits.get(agencyId);
    if (inMem) return inMem;

    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<any>(
          `SELECT * FROM app_agency_credits WHERE agency_id = $1 OR agency_code = $1 LIMIT 1`,
          [agencyId],
        );
        if (rows && rows[0]) {
          const r = rows[0];
          return new AgencyCreditEntity({
            id: r.id,
            agencyId: r.agency_id,
            agencyCode: r.agency_code,
            agencyName: r.agency_name,
            creditLimit: Number(r.credit_limit || 0),
            currentDebt: Number(r.current_debt || 0),
            overLimitAmount: Number(r.over_limit_amount || 0),
            maxDebtDays: Number(r.max_debt_days || 30),
            oldestDebtDays: Number(r.oldest_debt_days || 0),
            overdueDays: Number(r.overdue_days || 0),
            overdueAmount: Number(r.overdue_amount || 0),
            isFlagged: Boolean(r.is_flagged),
            flagType: r.flag_type as AgencyCreditFlag,
            flagReasons: r.flag_reasons || [],
            flaggedAt: r.flagged_at ? new Date(r.flagged_at) : undefined,
            status: r.status as CreditStatus,
            enforcementMode: r.enforcement_mode as CreditEnforcementMode,
            lastEvaluatedAt: new Date(r.last_evaluated_at),
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
          });
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[CreditEvaluationService] Lỗi query agency credit DB: ${msg}`);
      }
    }

    return null;
  }
}
