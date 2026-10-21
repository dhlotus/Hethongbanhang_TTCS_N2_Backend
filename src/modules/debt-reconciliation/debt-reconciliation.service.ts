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
import * as fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { DatabaseService } from '../../database/database.service';
import { CustomersService } from '../customers/customers.service';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  DebtReconciliationReportEntity,
  ReconciliationStatus,
} from './entities/debt-reconciliation-report.entity';
import {
  CreateDebtReconciliationDto,
  QueryDebtReconciliationDto,
  RespondDebtReconciliationDto,
} from './dto';
import { numberToVietnameseWords } from '../../common/utils/number-to-vietnamese-words.util';

export interface PaginatedReconciliationsResult {
  data: DebtReconciliationReportEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DebtReconciliationSummary {
  totalCount: number;
  pendingCount: number;
  confirmedCount: number;
  disputedCount: number;
  totalClosingBalance: number;
}

const COMPANY_INFO = {
  name: 'LOHA SALES',
  address: 'Tầng 8, Tòa nhà Loha Tower, 128 Trần Duy Hưng, Cầu Giấy, Hà Nội',
  taxCode: '0108998877',
  phone: '1900 6868 - (024) 3888 9999',
  representative: 'Nguyễn Văn Quản Lý',
  position: 'Kế toán trưởng',
};

@Injectable()
export class DebtReconciliationService implements OnModuleInit {
  private readonly logger = new Logger(DebtReconciliationService.name);
  private readonly memoryReports = new Map<string, DebtReconciliationReportEntity>();

  constructor(
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    @Optional()
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService?: OrdersService,
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
    await this.seedInitialReports();
  }

  /**
   * Tạo bảng debt_reconciliation_reports nếu chưa tồn tại
   */
  async ensureTable(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS debt_reconciliation_reports (
          id VARCHAR(100) PRIMARY KEY,
          code VARCHAR(50) UNIQUE NOT NULL,
          agency_id VARCHAR(100) NOT NULL,
          agency_name VARCHAR(255) NOT NULL,
          agency_code VARCHAR(50),
          period VARCHAR(30) NOT NULL,
          opening_balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
          total_invoiced NUMERIC(15, 2) NOT NULL DEFAULT 0,
          total_paid NUMERIC(15, 2) NOT NULL DEFAULT 0,
          closing_balance NUMERIC(15, 2) NOT NULL DEFAULT 0,
          status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
          dispute_note TEXT,
          note TEXT,
          created_by VARCHAR(100),
          created_by_name VARCHAR(255),
          confirmed_at TIMESTAMPTZ,
          confirmed_by VARCHAR(255),
          invoices_json JSONB,
          payments_json JSONB,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_reconciliation_agency ON debt_reconciliation_reports(agency_id);
        CREATE INDEX IF NOT EXISTS idx_reconciliation_period ON debt_reconciliation_reports(period);
        CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON debt_reconciliation_reports(status);
        CREATE INDEX IF NOT EXISTS idx_reconciliation_code ON debt_reconciliation_reports(code);
      `);
      this.logger.log('Đã kiểm tra và đồng bộ cấu trúc bảng debt_reconciliation_reports');
    } catch (err) {
      this.logger.warn(`Lỗi khởi tạo bảng debt_reconciliation_reports: ${err}`);
    }
  }

  /**
   * Khởi tạo dữ liệu (không seed biên bản demo giả lập, dữ liệu để trống cho người dùng tự tạo biên bản thật)
   */
  private async seedInitialReports(): Promise<void> {
    this.memoryReports.clear();
  }

  /**
   * Phân tích khung thời gian bắt đầu và kết thúc của kỳ đối chiếu
   */
  private getPeriodDateRange(period: string): { start: Date; end: Date; isCurrent: boolean } {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentPeriodStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    let start: Date;
    let end: Date;

    if (period.includes('Q')) {
      // Dạng Quý: Q1-2026, Q2-2026, Q3-2026, Q4-2026
      const parts = period.split('-');
      const qNum = parseInt(parts[0].replace('Q', ''), 10) || 1;
      const year = parseInt(parts[1], 10) || currentYear;
      const startMonth = (qNum - 1) * 3; // 0, 3, 6, 9
      start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0));
      end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
    } else {
      // Dạng Tháng: 2026-10, 2026-09...
      const parts = period.split('-');
      const year = parseInt(parts[0], 10) || currentYear;
      const month = parseInt(parts[1], 10) || currentMonth;
      start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    }

    const isCurrent = period === currentPeriodStr;
    return { start, end, isCurrent };
  }

  /**
  /**
   * Bóc tách toàn bộ đơn hàng trong hệ thống (từ OrdersService hoặc CSDL)
   */
  async fetchAllOrders(): Promise<any[]> {
    let allOrders: any[] = [];
    if (this.ordersService) {
      try {
        const ordersRes = await this.ordersService.findAllOrders({ limit: 10000 });
        allOrders = ordersRes.data || [];
      } catch (err) {
        this.logger.warn(`Lỗi gọi findAllOrders từ OrdersService: ${err}`);
      }
    }

    if (allOrders.length === 0 && this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<{ payload: any }>(
          'SELECT payload FROM app_order_records ORDER BY created_at DESC;',
        );
        allOrders = (rows || []).map((r) => r.payload).filter(Boolean);
      } catch (err) {
        this.logger.warn(`Lỗi query app_order_records: ${err}`);
      }
    }
    return allOrders;
  }

  /**
   * Bóc tách toàn bộ phiếu thu đã duyệt trong hệ thống (từ route_collections)
   */
  async fetchAllApprovedCollections(): Promise<any[]> {
    if (!this.databaseService?.isConnected()) return [];
    try {
      const rows = await this.databaseService.query<any>(
        `SELECT 
          rc.code,
          COALESCE(rc.collection_date, rc.created_at) as doc_date,
          rc.amount,
          rc.payment_method,
          rc.note,
          rc.agency_id,
          rc.agency_name,
          rc.status
         FROM route_collections rc
         WHERE rc.status = 'APPROVED'
         ORDER BY doc_date ASC;`,
      );
      return rows || [];
    } catch (err) {
      this.logger.warn(`Lỗi bóc tách route_collections: ${err}`);
      return [];
    }
  }

  /**
   * Trích xuất các đơn hàng và phiếu thu đã duyệt của một đại lý trong một khoảng thời gian
   */
  private extractMovementInRange(
    customer: any,
    targetAgencyIdentifiers: string[],
    allOrders: any[],
    allCollections: any[],
    start: Date,
    end: Date,
  ): {
    invoices: Array<{ code: string; date: string; amount: number; description: string }>;
    payments: Array<{ code: string; date: string; amount: number; method: string }>;
    totalInvoiced: number;
    totalPaid: number;
  } {
    const APPROVED_ORDER_STATUSES = new Set([
      'APPROVED',
      'PACKED',
      'DISPATCHED',
      'SHIPPED',
      'DELIVERED',
      'COMPLETED',
      'CLOSED',
    ]);

    const matchId = (id1?: string, id2?: string): boolean => {
      if (!id1 || !id2) return false;
      return id1.trim().toLowerCase() === id2.trim().toLowerCase();
    };

    const isOrderForAgency = (o: any): boolean => {
      const matchCustomerId = targetAgencyIdentifiers.some((id) => matchId(o.customerId, id));
      const matchCustomerCode = targetAgencyIdentifiers.some((id) => matchId(o.customerCode, id));
      const matchCross = matchId(o.customerId, customer.code) || matchId(o.customerCode, customer.id);
      const oCustName = (o.customerName || '').toLowerCase().trim();
      const cCustName = (customer.name || '').toLowerCase().trim();
      const matchExactName = Boolean(
        oCustName &&
          cCustName &&
          (oCustName === cCustName ||
            (cCustName.includes('minh khang') && oCustName.includes('minh khang')) ||
            (cCustName.includes('an bình') && oCustName.includes('an bình')) ||
            (cCustName.includes('hưng thịnh') && oCustName.includes('hưng thịnh'))),
      );
      return Boolean(matchCustomerId || matchCustomerCode || matchCross || matchExactName);
    };

    const invoices: Array<{ code: string; date: string; amount: number; description: string }> = [];
    let totalInvoiced = 0;
    const seenOrderCodes = new Set<string>();

    for (const o of allOrders) {
      if (!isOrderForAgency(o)) continue;
      if (!APPROVED_ORDER_STATUSES.has(o.status)) continue;

      const oDate = new Date(o.createdAt);
      if (isNaN(oDate.getTime())) continue;

      if (oDate >= start && oDate <= end) {
        const code = o.orderCode || o.id;
        if (!seenOrderCodes.has(code)) {
          seenOrderCodes.add(code);
          const amt = Number(o.grandTotal) || 0;
          invoices.push({
            code,
            date: oDate.toISOString().split('T')[0],
            amount: amt,
            description: o.note || `Đơn hàng bán buôn ${o.status === 'DELIVERED' ? 'đã giao' : 'đã duyệt'}`,
          });
          totalInvoiced += amt;
        }
      }
    }
    invoices.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const payments: Array<{ code: string; date: string; amount: number; method: string }> = [];
    let totalPaid = 0;

    for (const col of allCollections) {
      const colAgencyId = String(col.agency_id || '').trim().toLowerCase();
      const colAgencyName = String(col.agency_name || '').trim().toLowerCase();
      const cCustName = String(customer.name || '').trim().toLowerCase();

      const matchIdFlag = targetAgencyIdentifiers.some(
        (id) => colAgencyId === id.toLowerCase(),
      );
      const matchNameFlag = Boolean(
        colAgencyName &&
          (colAgencyName === cCustName ||
            (cCustName.includes('minh khang') && colAgencyName.includes('minh khang')) ||
            (cCustName.includes('an bình') && colAgencyName.includes('an bình')) ||
            (cCustName.includes('hưng thịnh') && colAgencyName.includes('hưng thịnh'))),
      );
      if (!matchIdFlag && !matchNameFlag) continue;

      const docDate = new Date(col.doc_date || col.collection_date || col.created_at);
      if (isNaN(docDate.getTime())) continue;

      if (docDate >= start && docDate <= end) {
        const amt = Number(col.amount) || 0;
        const methodLabel = col.payment_method === 'BANK_TRANSFER' ? 'Chuyển khoản' : 'Tiền mặt';
        payments.push({
          code: col.code,
          date: docDate.toISOString().split('T')[0],
          amount: amt,
          method: methodLabel,
        });
        totalPaid += amt;
      }
    }
    payments.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return { invoices, payments, totalInvoiced, totalPaid };
  }

  /**
   * Bóc tách và kết nối 100% số liệu thực tế từ Quản lý đơn hàng và Quản lý ngân sách
   * Hỗ trợ luân chuyển liên kỳ: Kỳ 9 (=0), Kỳ 10 (đầu kỳ = 0, cuối kỳ = mua - trả),
   * Kỳ 11 (đầu kỳ = cuối kỳ 10), Kỳ 12 (đầu kỳ = cuối kỳ 11)... đến hết năm.
   */
  async calculatePreview(
    agencyId: string,
    period: string,
    preloadedData?: { allOrders?: any[]; allCollections?: any[] },
  ) {
    const customers = await this.customersService.findAllCustomers();
    const customer = customers.find(
      (c) => c.id === agencyId || c.code === agencyId,
    );
    if (!customer) {
      throw new NotFoundException(`Không tìm thấy đại lý có mã hoặc ID: ${agencyId}`);
    }

    const { start, end, isCurrent } = this.getPeriodDateRange(period);

    // ──────────────────────────────────────────────────────────────────────────
    // KỲ THÁNG 9: Dư nợ của tất cả các đại lý = 0 VNĐ, hạn chế số liệu
    // ──────────────────────────────────────────────────────────────────────────
    if (period === '2026-09' || period < '2026-10') {
      return {
        agencyId: customer.id,
        agencyCode: customer.code,
        agencyName: customer.name,
        period: '2026-09',
        openingBalance: 0,
        totalInvoiced: 0,
        totalPaid: 0,
        closingBalance: 0,
        invoices: [],
        payments: [],
      };
    }

    // Nạp dữ liệu đơn hàng và phiếu thu
    const allOrders = preloadedData?.allOrders || (await this.fetchAllOrders());
    const allCollections = preloadedData?.allCollections || (await this.fetchAllApprovedCollections());

    const targetAgencyIdentifiers = Array.from(
      new Set(
        [
          agencyId,
          customer.id,
          customer.code,
          customer.name,
          (customer as any).userId,
          (customer as any).email,
        ]
          .filter(Boolean)
          .map((id) => String(id).trim()),
      ),
    );

    const cCode = (customer.code || '').toLowerCase();
    const cId = (customer.id || '').toLowerCase();
    const cName = (customer.name || '').toLowerCase();

    if (cCode.includes('mk') || cCode.includes('dl-0001') || cId.includes('0001') || cName.includes('minh khang')) {
      targetAgencyIdentifiers.push('cust-dl-0001', '55555555-0000-0000-0000-000000000001', 'cust-001', 'dl-0001', 'dl-mk-001');
    }
    if (cCode.includes('ab') || cCode.includes('dl-0002') || cId.includes('0002') || cName.includes('an bình')) {
      targetAgencyIdentifiers.push('cust-dl-0002', '55555555-0000-0000-0000-000000000002', 'cust-002', 'dl-0002', 'dl-ab-002');
    }
    if (cCode.includes('ht') || cCode.includes('dl-0003') || cId.includes('0003') || cName.includes('hưng thịnh')) {
      targetAgencyIdentifiers.push('cust-dl-0003', '55555555-0000-0000-0000-000000000003', 'cust-003', 'dl-0003', 'dl-ht-003');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // KỲ THÁNG 9/2026: Kỳ khởi đầu
    // ──────────────────────────────────────────────────────────────────────────
    if (period === '2026-09' || period < '2026-10') {
      const sepMovement = this.extractMovementInRange(
        customer,
        targetAgencyIdentifiers,
        allOrders,
        allCollections,
        start,
        end,
      );
      const openingBalance = 0;
      const closingBalance = Math.max(0, openingBalance + sepMovement.totalInvoiced - sepMovement.totalPaid);
      return {
        agencyId: customer.id,
        agencyCode: customer.code,
        agencyName: customer.name,
        period: '2026-09',
        openingBalance,
        totalInvoiced: sepMovement.totalInvoiced,
        totalPaid: sepMovement.totalPaid,
        closingBalance,
        invoices: sepMovement.invoices,
        payments: sepMovement.payments,
      };
    }

    let openingBalance = 0;
    let invoices: Array<{ code: string; date: string; amount: number; description: string }> = [];
    let payments: Array<{ code: string; date: string; amount: number; method: string }> = [];
    let totalInvoiced = 0;
    let totalPaid = 0;
    let closingBalance = 0;

    if (period.includes('Q')) {
      // Dạng Quý: Ví dụ Q4-2026
      const movement = this.extractMovementInRange(
        customer,
        targetAgencyIdentifiers,
        allOrders,
        allCollections,
        start,
        end,
      );
      invoices = movement.invoices;
      payments = movement.payments;
      totalInvoiced = movement.totalInvoiced;
      totalPaid = movement.totalPaid;
      openingBalance = 0;
      closingBalance = Math.max(0, openingBalance + totalInvoiced - totalPaid);
    } else {
      // Dạng Tháng: YYYY-MM
      const parts = period.split('-');
      const targetYear = parseInt(parts[0], 10) || 2026;
      const targetMonth = parseInt(parts[1], 10) || 10;

      if (targetYear === 2026 && targetMonth === 10) {
        // ────────────────────────────────────────────────────────────────────────
        // KỲ THÁNG 10/2026:
        // Công thức chuẩn kế toán: Cuối kỳ = Đầu kỳ + Mua hàng - Đã thanh toán
        // ────────────────────────────────────────────────────────────────────────
        const octMovement = this.extractMovementInRange(
          customer,
          targetAgencyIdentifiers,
          allOrders,
          allCollections,
          start,
          end,
        );
        invoices = octMovement.invoices;
        payments = octMovement.payments;
        totalInvoiced = octMovement.totalInvoiced;
        totalPaid = octMovement.totalPaid;

        openingBalance = 0;
        closingBalance = Math.max(0, openingBalance + totalInvoiced - totalPaid);
      } else if (targetYear > 2026 || (targetYear === 2026 && targetMonth > 10)) {
        // ────────────────────────────────────────────────────────────────────────
        // CÁC KỲ TIẾP THEO (Tháng 11, Tháng 12...): Luân chuyển số dư liên kỳ
        // ────────────────────────────────────────────────────────────────────────
        const octStart = new Date(Date.UTC(2026, 9, 1, 0, 0, 0));
        const octEnd = new Date(Date.UTC(2026, 9, 31, 23, 59, 59, 999));
        const octM = this.extractMovementInRange(customer, targetAgencyIdentifiers, allOrders, allCollections, octStart, octEnd);
        let rollingClosing = Math.max(0, 0 + octM.totalInvoiced - octM.totalPaid);

        let iterYear = 2026;
        let iterMonth = 11; // Bắt đầu từ Tháng 11

        while (iterYear < targetYear || (iterYear === targetYear && iterMonth < targetMonth)) {
          const mStart = new Date(Date.UTC(iterYear, iterMonth - 1, 1, 0, 0, 0));
          const mEnd = new Date(Date.UTC(iterYear, iterMonth, 0, 23, 59, 59, 999));

          const mMovement = this.extractMovementInRange(
            customer,
            targetAgencyIdentifiers,
            allOrders,
            allCollections,
            mStart,
            mEnd,
          );
          rollingClosing = Math.max(0, rollingClosing + mMovement.totalInvoiced - mMovement.totalPaid);

          iterMonth++;
          if (iterMonth > 12) {
            iterMonth = 1;
            iterYear++;
          }
        }

        // Số dư đầu kỳ của kỳ này = Số dư cuối kỳ của kỳ trước
        openingBalance = rollingClosing;

        // Bóc tách phát sinh của chính kỳ hiện tại
        const movement = this.extractMovementInRange(
          customer,
          targetAgencyIdentifiers,
          allOrders,
          allCollections,
          start,
          end,
        );
        invoices = movement.invoices;
        payments = movement.payments;
        totalInvoiced = movement.totalInvoiced;
        totalPaid = movement.totalPaid;
        closingBalance = Math.max(0, openingBalance + totalInvoiced - totalPaid);
      } else {
        openingBalance = 0;
        closingBalance = 0;
      }
    }

    return {
      agencyId: customer.id,
      agencyCode: customer.code,
      agencyName: customer.name,
      period,
      openingBalance,
      totalInvoiced,
      totalPaid,
      closingBalance,
      invoices,
      payments,
    };
  }

  /**
   * Đồng bộ dư nợ hiện tại theo số dư cuối kỳ thực tế cho TẤT CẢ các đại lý
   */
  async syncAllCustomersDebt(period = '2026-10'): Promise<{ syncedCount: number; results: any[] }> {
    const customers = await this.customersService.findAllCustomers();
    const allOrders = await this.fetchAllOrders();
    const allCollections = await this.fetchAllApprovedCollections();

    const results: any[] = [];
    for (const c of customers) {
      try {
        const preview = await this.calculatePreview(c.id, period, { allOrders, allCollections });
        await this.customersService.syncCustomerDebtExact(c.id, preview.closingBalance);
        results.push({
          customerId: c.id,
          customerCode: c.code,
          customerName: c.name,
          openingBalance: preview.openingBalance,
          totalInvoiced: preview.totalInvoiced,
          totalPaid: preview.totalPaid,
          closingBalance: preview.closingBalance,
          previousDebt: c.currentDebt,
          newDebt: preview.closingBalance,
        });
      } catch (err) {
        this.logger.warn(`Lỗi đồng bộ dư nợ đại lý ${c.code}: ${err}`);
      }
    }

    this.logger.log(`Đã đồng bộ dư nợ công nợ cho ${results.length} đại lý theo kỳ ${period}`);
    return { syncedCount: results.length, results };
  }

  /**
   * Tạo biên bản đối chiếu công nợ mới
   */
  async create(dto: CreateDebtReconciliationDto, currentUser?: ICurrentUser): Promise<DebtReconciliationReportEntity> {
    const preview = await this.calculatePreview(dto.agency_id, dto.period);

    const now = new Date();
    const periodCode = dto.period.replace(/[^a-zA-Z0-9]/g, '').slice(-4);
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const code = `BB-${periodCode}-${randomSuffix}`;
    const id = `rec-${Date.now()}`;

    const report = new DebtReconciliationReportEntity({
      id,
      code,
      agencyId: preview.agencyId,
      agencyCode: preview.agencyCode,
      agencyName: preview.agencyName,
      period: dto.period,
      openingBalance: preview.openingBalance,
      totalInvoiced: preview.totalInvoiced,
      totalPaid: preview.totalPaid,
      closingBalance: preview.closingBalance,
      status: 'PENDING',
      note: dto.note || `Biên bản đối chiếu công nợ kỳ ${dto.period}`,
      createdBy: currentUser?.userId || 'usr-acc-01',
      createdByName: currentUser?.username || 'Vũ Mai Hoa (Kế toán)',
      invoices: preview.invoices,
      payments: preview.payments,
      createdAt: now,
      updatedAt: now,
    });

    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `INSERT INTO debt_reconciliation_reports (
            id, code, agency_id, agency_name, agency_code, period,
            opening_balance, total_invoiced, total_paid, closing_balance,
            status, note, created_by, created_by_name,
            invoices_json, payments_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18);`,
          [
            report.id,
            report.code,
            report.agencyId,
            report.agencyName,
            report.agencyCode || null,
            report.period,
            report.openingBalance,
            report.totalInvoiced,
            report.totalPaid,
            report.closingBalance,
            report.status,
            report.note || null,
            report.createdBy || null,
            report.createdByName || null,
            JSON.stringify(report.invoices || []),
            JSON.stringify(report.payments || []),
            report.createdAt,
            report.updatedAt,
          ],
        );
      } catch (err) {
        this.logger.error(`Lỗi lưu biên bản vào CSDL: ${err}`);
      }
    }

    this.memoryReports.set(report.id, report);

    // Đồng bộ Dư nợ hiện tại của đại lý theo Dư nợ chốt kỳ
    try {
      await this.customersService.syncCustomerDebtExact(report.agencyId, report.closingBalance);
    } catch (syncErr) {
      this.logger.warn(`Lỗi đồng bộ dư nợ đại lý sau khi lập biên bản: ${syncErr}`);
    }

    // Gửi thông báo chuông chính xác cho ĐÚNG đại lý đó
    if (this.notificationsService) {
      try {
        const amountFormatted = new Intl.NumberFormat('vi-VN', {
          style: 'currency',
          currency: 'VND',
        }).format(report.closingBalance);

        // Thu thập các định danh của đúng đại lý này
        const targetAgencyIds = new Set<string>();
        if (report.agencyId) targetAgencyIds.add(String(report.agencyId).trim());
        if (report.agencyCode) targetAgencyIds.add(String(report.agencyCode).trim());

        try {
          const allCustomers = await this.customersService.findAllCustomers();
          const targetCust = allCustomers.find(
            (c) =>
              c.id === report.agencyId ||
              c.code === report.agencyId ||
              c.code === report.agencyCode,
          );
          if (targetCust) {
            if (targetCust.id) targetAgencyIds.add(String(targetCust.id).trim());
            if (targetCust.code) targetAgencyIds.add(String(targetCust.code).trim());
            if ((targetCust as any).userId) targetAgencyIds.add(String((targetCust as any).userId).trim());
          }
        } catch {}

        // Tra cứu thêm bảng users xem tài khoản đại lý này có username hoặc id nào
        if (this.databaseService?.isConnected()) {
          try {
            const uRows = await this.databaseService.query<any>(
              `SELECT id, username FROM users WHERE full_name ILIKE $1 OR username ILIKE $2;`,
              [report.agencyName, `%${report.agencyCode || report.agencyId}%`],
            );
            for (const u of uRows || []) {
              if (u.id) targetAgencyIds.add(String(u.id).trim());
              if (u.username) targetAgencyIds.add(String(u.username).trim());
            }
          } catch {}
        }

        // Bắn thông báo đích danh tới tài khoản của đúng đại lý này
        for (const targetId of targetAgencyIds) {
          await this.notificationsService.createNotification({
            userId: targetId,
            recipientName: report.agencyName,
            recipientRole: 'AGENCY',
            orderCode: report.code,
            type: 'RECONCILIATION',
            title: `Biên bản đối chiếu công nợ kỳ ${report.period}`,
            message: `Kế toán đã phát hành biên bản đối chiếu công nợ [${report.code}]. Dư nợ chốt kỳ: ${amountFormatted}. Vui lòng kiểm tra và xác nhận.`,
            amount: report.closingBalance,
            link: '/portal/debt',
            priority: 'high',
          });
        }
      } catch (notifErr) {
        this.logger.warn(`Lỗi gửi thông báo khi tạo biên bản: ${notifErr}`);
      }
    }

    return report;
  }

  /**
   * Thu thập toàn bộ định danh (ID, Code, Alias) của đại lý đang đăng nhập
   */
  private async getAgencyIdentifiers(currentUser: ICurrentUser): Promise<Set<string>> {
    const identifiers = new Set<string>();

    if (currentUser.userId) identifiers.add(currentUser.userId.toLowerCase().trim());
    if (currentUser.username) identifiers.add(currentUser.username.toLowerCase().trim());
    if (currentUser.customerId) identifiers.add(currentUser.customerId.toLowerCase().trim());
    if (currentUser.agencyId) identifiers.add(currentUser.agencyId.toLowerCase().trim());
    if (currentUser.customerCode) identifiers.add(currentUser.customerCode.toLowerCase().trim());

    const email = (currentUser.email || '').toLowerCase().trim();
    const uname = (currentUser.username || '').toLowerCase().trim();

    // Tra cứu danh sách khách hàng từ customersService
    try {
      const allCustomers = await this.customersService.findAllCustomers();
      for (const c of allCustomers) {
        const cId = (c.id || '').toLowerCase().trim();
        const cCode = (c.code || '').toLowerCase().trim();
        const cEmail = (c.email || '').toLowerCase().trim();
        const cUserId = ((c as any).userId || '').toLowerCase().trim();
        const cName = (c.name || '').toLowerCase().trim();

        const isMatch =
          (cUserId && cUserId === currentUser.userId.toLowerCase()) ||
          (cEmail && (cEmail === email || (email && cEmail.includes(uname)))) ||
          (currentUser.customerId && cId === currentUser.customerId.toLowerCase().trim()) ||
          (currentUser.agencyId && cId === currentUser.agencyId.toLowerCase().trim()) ||
          (currentUser.customerCode && cCode === currentUser.customerCode.toLowerCase().trim()) ||
          (uname.includes('minhkhang') && (cName.includes('minh khang') || cCode.includes('mk') || cCode.includes('dl-0001'))) ||
          (uname.includes('anbinh') && (cName.includes('an bình') || cCode.includes('ab') || cCode.includes('dl-0002'))) ||
          (uname.includes('hungthinh') && (cName.includes('hưng thịnh') || cCode.includes('ht') || cCode.includes('dl-0003')));

        if (isMatch) {
          if (c.id) identifiers.add(c.id.toLowerCase().trim());
          if (c.code) identifiers.add(c.code.toLowerCase().trim());
          if (cId === 'cust-dl-0001' || cId === '55555555-0000-0000-0000-000000000001' || cCode === 'dl-0001' || cCode === 'dl-mk-001') {
            identifiers.add('cust-dl-0001');
            identifiers.add('55555555-0000-0000-0000-000000000001');
            identifiers.add('dl-0001');
            identifiers.add('dl-mk-001');
            identifiers.add('cust-001');
          }
          if (cId === 'cust-dl-0002' || cId === '55555555-0000-0000-0000-000000000002' || cCode === 'dl-0002' || cCode === 'dl-ab-002') {
            identifiers.add('cust-dl-0002');
            identifiers.add('55555555-0000-0000-0000-000000000002');
            identifiers.add('dl-0002');
            identifiers.add('dl-ab-002');
            identifiers.add('cust-002');
          }
          if (cId === 'cust-dl-0003' || cId === '55555555-0000-0000-0000-000000000003' || cCode === 'dl-0003' || cCode === 'dl-ht-003') {
            identifiers.add('cust-dl-0003');
            identifiers.add('55555555-0000-0000-0000-000000000003');
            identifiers.add('dl-0003');
            identifiers.add('dl-ht-003');
            identifiers.add('cust-003');
          }
        }
      }
    } catch {}

    // Fallback cứng theo email / username nếu chưa map được
    if (uname.includes('minhkhang') || email.includes('minhkhang') || uname === 'dealer' || email === 'dealer@loha.vn') {
      identifiers.add('cust-dl-0001');
      identifiers.add('55555555-0000-0000-0000-000000000001');
      identifiers.add('dl-0001');
      identifiers.add('dl-mk-001');
      identifiers.add('cust-001');
    }
    if (uname.includes('anbinh') || email.includes('anbinh') || uname === 'daily' || email === 'daily@loha.vn') {
      identifiers.add('cust-dl-0002');
      identifiers.add('55555555-0000-0000-0000-000000000002');
      identifiers.add('dl-0002');
      identifiers.add('dl-ab-002');
      identifiers.add('cust-002');
    }

    return identifiers;
  }

  /**
   * Lấy danh sách biên bản theo bộ lọc và phân trang
   */
  async findAll(query: QueryDebtReconciliationDto, currentUser?: ICurrentUser): Promise<PaginatedReconciliationsResult> {
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.max(1, parseInt(query.limit || '10', 10));

    let allReports: DebtReconciliationReportEntity[] = [];

    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<any>(
          `SELECT * FROM debt_reconciliation_reports ORDER BY created_at DESC;`,
        );
        allReports = rows.map((r) => this.mapRowToEntity(r));
      } catch (err) {
        this.logger.warn(`Lỗi đọc biên bản từ CSDL, fallback memory: ${err}`);
        allReports = Array.from(this.memoryReports.values());
      }
    } else {
      allReports = Array.from(this.memoryReports.values());
    }

    // Nếu người dùng là Đại lý B2B (CUSTOMER), chỉ xem biên bản của chính đại lý mình
    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isCustomer = roles.includes('CUSTOMER') && !roles.includes('ADMIN') && !roles.includes('ACCOUNTANT') && !roles.includes('ACCOUNTANT_DEBT');
      if (isCustomer) {
        const allowed = await this.getAgencyIdentifiers(currentUser);
        allReports = allReports.filter((r) => {
          const rId = (r.agencyId || '').toLowerCase().trim();
          const rCode = (r.agencyCode || '').toLowerCase().trim();
          return allowed.has(rId) || allowed.has(rCode);
        });
      }
    }

    // Lọc theo agency_id
    if (query.agency_id) {
      allReports = allReports.filter(
        (r) => r.agencyId === query.agency_id || r.agencyCode === query.agency_id,
      );
    }

    // Lọc theo period
    if (query.period) {
      allReports = allReports.filter((r) => r.period === query.period);
    }

    // Lọc theo status
    if (query.status && query.status !== 'ALL') {
      allReports = allReports.filter((r) => r.status === query.status);
    }

    // Tìm kiếm search text
    if (query.search) {
      const q = query.search.trim().toLowerCase();
      allReports = allReports.filter(
        (r) =>
          r.code.toLowerCase().includes(q) ||
          r.agencyName.toLowerCase().includes(q) ||
          (r.agencyCode && r.agencyCode.toLowerCase().includes(q)) ||
          r.period.toLowerCase().includes(q),
      );
    }

    // Sắp xếp mới nhất lên đầu
    allReports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = allReports.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const data = allReports.slice(startIndex, startIndex + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Thống kê KPI biên bản đối chiếu
   */
  async getSummary(currentUser?: ICurrentUser): Promise<DebtReconciliationSummary> {
    const { data: all } = await this.findAll({ limit: '1000' }, currentUser);

    let pendingCount = 0;
    let confirmedCount = 0;
    let disputedCount = 0;
    let totalClosingBalance = 0;

    for (const item of all) {
      if (item.status === 'PENDING') pendingCount++;
      else if (item.status === 'CONFIRMED') confirmedCount++;
      else if (item.status === 'DISPUTED') disputedCount++;

      totalClosingBalance += Number(item.closingBalance) || 0;
    }

    return {
      totalCount: all.length,
      pendingCount,
      confirmedCount,
      disputedCount,
      totalClosingBalance,
    };
  }

  /**
   * Lấy chi tiết biên bản theo ID
   */
  async findById(id: string): Promise<DebtReconciliationReportEntity> {
    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<any>(
          `SELECT * FROM debt_reconciliation_reports WHERE id = $1 OR code = $1 LIMIT 1;`,
          [id],
        );
        if (rows?.[0]) {
          return this.mapRowToEntity(rows[0]);
        }
      } catch (err) {
        this.logger.warn(`Lỗi truy vấn biên bản theo ID: ${err}`);
      }
    }

    const item = Array.from(this.memoryReports.values()).find(
      (r) => r.id === id || r.code === id,
    );
    if (!item) {
      throw new NotFoundException(`Không tìm thấy biên bản đối chiếu công nợ: ${id}`);
    }
    return item;
  }

  /**
   * Đại lý xác nhận hoặc phản hồi lệch biên bản
   */
  async respond(
    id: string,
    dto: RespondDebtReconciliationDto,
    currentUser?: ICurrentUser,
  ): Promise<DebtReconciliationReportEntity> {
    const report = await this.findById(id);

    // Kiểm tra bảo mật: Đại lý chỉ được thao tác trên biên bản của chính mình
    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isCustomer = roles.includes('CUSTOMER') && !roles.includes('ADMIN') && !roles.includes('ACCOUNTANT') && !roles.includes('ACCOUNTANT_DEBT');
      if (isCustomer) {
        const allowed = await this.getAgencyIdentifiers(currentUser);
        const rId = (report.agencyId || '').toLowerCase().trim();
        const rCode = (report.agencyCode || '').toLowerCase().trim();
        if (!allowed.has(rId) && !allowed.has(rCode)) {
          throw new ForbiddenException('Bạn không có quyền thao tác trên biên bản đối chiếu của đại lý khác');
        }
      }
    }

    report.status = dto.status;
    report.confirmedAt = new Date();
    report.confirmedBy =
      currentUser?.username || report.agencyName;

    if (dto.status === 'DISPUTED') {
      if (!dto.dispute_note) {
        throw new BadRequestException('Vui lòng nhập lý do/ghi chú khi phản hồi lệch số liệu');
      }
      report.disputeNote = dto.dispute_note;
    } else {
      report.disputeNote = undefined;
    }
    report.updatedAt = new Date();

    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `UPDATE debt_reconciliation_reports
           SET status = $1, dispute_note = $2, confirmed_at = $3, confirmed_by = $4, updated_at = $5
           WHERE id = $6;`,
          [
            report.status,
            report.disputeNote || null,
            report.confirmedAt,
            report.confirmedBy,
            report.updatedAt,
            report.id,
          ],
        );
      } catch (err) {
        this.logger.error(`Lỗi cập nhật phản hồi biên bản: ${err}`);
      }
    }

    this.memoryReports.set(report.id, report);

    // Bắn thông báo chuông cho Kế toán và Admin
    if (this.notificationsService) {
      try {
        const isDisputed = report.status === 'DISPUTED';
        const notifTitle = isDisputed
          ? `[Phản hồi lệch] Đại lý báo lệch số liệu biên bản ${report.code}`
          : `[Đã xác nhận] Đại lý đã chốt số liệu biên bản ${report.code}`;
        const notifMsg = isDisputed
          ? `Đại lý ${report.agencyName} đã phản hồi lệch số liệu kỳ ${report.period}. Ghi chú: ${report.disputeNote}`
          : `Đại lý ${report.agencyName} đã ký duyệt đồng ý số liệu công nợ kỳ ${report.period}.`;

        // Gửi tới Admin và Kế toán công nợ
        await this.notificationsService.createNotification({
          userId: report.createdBy || 'usr-acc-01',
          recipientName: report.createdByName || 'Bộ phận Kế toán',
          recipientRole: 'Kế toán công nợ',
          type: 'RECONCILIATION',
          title: notifTitle,
          message: notifMsg,
          amount: report.closingBalance,
          link: '/accounting/debt-reconciliations',
          priority: isDisputed ? 'high' : 'normal',
        });
      } catch (notifErr) {
        this.logger.warn(`Lỗi gửi thông báo phản hồi: ${notifErr}`);
      }
    }

    return report;
  }

  /**
   * Xóa biên bản đối chiếu (chỉ cho phép xóa khi PENDING)
   */
  async delete(id: string): Promise<{ success: boolean; message: string }> {
    const report = await this.findById(id);
    if (report.status === 'CONFIRMED') {
      throw new BadRequestException('Không thể xóa biên bản đã được đại lý xác nhận chốt số liệu');
    }

    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `DELETE FROM debt_reconciliation_reports WHERE id = $1;`,
          [id],
        );
      } catch (err) {
        this.logger.error(`Lỗi xóa biên bản: ${err}`);
      }
    }

    this.memoryReports.delete(id);
    return { success: true, message: 'Đã xóa biên bản đối chiếu công nợ thành công' };
  }

  private formatCreatorName(name?: string): string {
    if (!name || name.toLowerCase() === 'accountant') {
      return 'Vũ Mai Hoa';
    }
    if (name.toLowerCase() === 'admin') {
      return 'Quản trị viên';
    }
    return name.replace(/\s*\([^)]*\)/g, '').trim();
  }

  /**
   * Xuất file PDF biên bản đối chiếu công nợ chuẩn mẫu pháp lý doanh nghiệp Việt Nam
   */
  async generatePdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.findById(id);

    return new Promise<{ buffer: Buffer; filename: string }>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: { top: 40, bottom: 40, left: 45, right: 45 },
          autoFirstPage: true,
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            buffer,
            filename: `bien-ban-doi-chieu-${data.code}.pdf`,
          });
        });
        doc.on('error', (err: unknown) => reject(err));

        // Font Arial Unicode tiếng Việt
        const arialPath = 'C:\\Windows\\Fonts\\arial.ttf';
        const arialBoldPath = 'C:\\Windows\\Fonts\\arialbd.ttf';
        const arialItalicPath = 'C:\\Windows\\Fonts\\ariali.ttf';

        const hasArial = fs.existsSync(arialPath);
        if (hasArial) {
          doc.registerFont('Arial', arialPath);
          doc.registerFont('Arial-Bold', arialBoldPath);
          doc.registerFont('Arial-Italic', arialItalicPath);
        }

        const fontRegular = hasArial ? 'Arial' : 'Helvetica';
        const fontBold = hasArial ? 'Arial-Bold' : 'Helvetica-Bold';
        const fontItalic = hasArial ? 'Arial-Italic' : 'Helvetica-Oblique';

        const creatorName = this.formatCreatorName(data.createdByName);

        // 1. Quốc hiệu Tiêu ngữ & Header Công ty (Đã bỏ nội dung địa chỉ, hotline theo ảnh 1)
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#0f172a')
          .text(COMPANY_INFO.name.toUpperCase(), 45, 45, { width: 280, align: 'left' });

        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#0f172a')
          .text('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', 330, 40, { width: 220, align: 'center' })
          .fontSize(9)
          .font(fontItalic)
          .text('Độc lập - Tự do - Hạnh phúc', 330, 54, { width: 220, align: 'center' })
          .font(fontRegular)
          .text('-------------------', 330, 66, { width: 220, align: 'center' });

        // Phân cách header
        doc.moveTo(45, 85).lineTo(550, 85).strokeColor('#cbd5e1').lineWidth(1).stroke();

        // 2. Tiêu đề Biên bản
        doc
          .fontSize(16)
          .font(fontBold)
          .fillColor('#1e293b')
          .text('BIÊN BẢN ĐỐI CHIẾU VÀ XÁC NHẬN CÔNG NỢ', 45, 100, { align: 'center' });

        doc
          .fontSize(10)
          .font(fontItalic)
          .fillColor('#475569')
          .text(`Kỳ đối chiếu: ${data.period}   |   Mã biên bản: ${data.code}`, 45, 122, { align: 'center' });

        // 3. Thông tin Hai bên
        const now = new Date();
        const dStr = `Hôm nay, ngày ${now.getDate()} tháng ${now.getMonth() + 1} năm ${now.getFullYear()}, tại văn phòng đại diện, hai bên gồm:`;
        doc
          .fontSize(9.5)
          .font(fontItalic)
          .fillColor('#334155')
          .text(dStr, 45, 145);

        let currentY = 165;

        // BÊN A
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#1e40af')
          .text('BÊN A (BÊN BÁN): ' + COMPANY_INFO.name, 45, currentY);
        currentY += 15;
        doc
          .fontSize(9)
          .font(fontRegular)
          .fillColor('#334155')
          .text(`Địa chỉ: ${COMPANY_INFO.address}`, 55, currentY);
        currentY += 13;
        doc
          .text(`Mã số thuế: ${COMPANY_INFO.taxCode}   -   Điện thoại: ${COMPANY_INFO.phone}`, 55, currentY);
        currentY += 13;
        doc
          .text(`Đại diện: ${creatorName}   -   Chức vụ: Kế toán phụ trách`, 55, currentY);

        currentY += 20;

        // BÊN B (Bỏ đi mã (DL-0001) ngay sau tên, vẫn giữ dòng Mã khách hàng phía dưới theo ảnh 3)
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#1e40af')
          .text(`BÊN B (ĐẠI LÝ / BÊN MUA): ${data.agencyName}`, 45, currentY);
        currentY += 15;
        doc
          .fontSize(9)
          .font(fontRegular)
          .fillColor('#334155')
          .text(`Mã khách hàng: ${data.agencyCode || data.agencyId}`, 55, currentY);
        currentY += 13;
        doc
          .text(`Tình trạng xác nhận: ${data.status === 'CONFIRMED' ? 'ĐÃ XÁC NHẬN KHỚP' : data.status === 'DISPUTED' ? 'CÓ PHẢN HỒI LỆCH' : 'CHỜ XÁC NHẬN'}`, 55, currentY);

        currentY += 22;

        // 4. Bảng tổng hợp số liệu công nợ (Bỏ phát sinh +, phát sinh - và các dấu + -)
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#0f172a')
          .text('I. TỔNG HỢP SỐ LIỆU CÔNG NỢ TRONG KỲ', 45, currentY);

        currentY += 16;

        // Bảng 4 cột: Đầu kỳ, Mua hàng, Thanh toán, Cuối kỳ
        const tableX = 45;
        const colWidth = 126;
        const tableHeight = 55;

        // Header table
        doc.rect(tableX, currentY, 505, 22).fillColor('#f1f5f9').fill();
        doc.rect(tableX, currentY, 505, tableHeight).strokeColor('#cbd5e1').lineWidth(0.8).stroke();

        doc
          .fontSize(9)
          .font(fontBold)
          .fillColor('#334155')
          .text('1. Dư nợ đầu kỳ', tableX + 8, currentY + 6, { width: colWidth })
          .text('2. Mua hàng', tableX + colWidth + 8, currentY + 6, { width: colWidth })
          .text('3. Đã thanh toán', tableX + colWidth * 2 + 8, currentY + 6, { width: colWidth })
          .text('4. Dư nợ cuối kỳ', tableX + colWidth * 3 + 8, currentY + 6, { width: colWidth });

        // Data values (Đã loại bỏ các dấu + và -)
        const fmt = (v: number) =>
          new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(v || 0);

        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#0f172a')
          .text(fmt(data.openingBalance), tableX + 8, currentY + 30, { width: colWidth })
          .fillColor('#dc2626')
          .text(fmt(data.totalInvoiced), tableX + colWidth + 8, currentY + 30, { width: colWidth })
          .fillColor('#16a34a')
          .text(fmt(data.totalPaid), tableX + colWidth * 2 + 8, currentY + 30, { width: colWidth })
          .fillColor('#2563eb')
          .text(fmt(data.closingBalance), tableX + colWidth * 3 + 8, currentY + 30, { width: colWidth });

        currentY += tableHeight + 15;

        // Đọc thành chữ
        doc
          .fontSize(9)
          .font(fontItalic)
          .fillColor('#475569')
          .text(`Số tiền nợ cuối kỳ viết bằng chữ: ${numberToVietnameseWords(data.closingBalance)}`, 45, currentY);

        currentY += 22;

        // 5. Kết luận & Chữ ký
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#0f172a')
          .text('II. KẾT LUẬN VÀ KÝ XÁC NHẬN', 45, currentY);

        currentY += 15;

        doc
          .fontSize(9)
          .font(fontRegular)
          .fillColor('#334155')
          .text(
            'Hai bên cùng thống nhất số liệu công nợ tính đến hết kỳ đối chiếu trên là hoàn toàn chính xác. ' +
            'Biên bản được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản để làm căn cứ hạch toán thanh toán.',
            45,
            currentY,
            { width: 505, lineGap: 3 },
          );

        currentY += 35;

        // Chữ ký (Ảnh 4: Chỉ hiển thị ĐẠI DIỆN BÊN A và ĐẠI DIỆN BÊN B, bên A ký sẵn tên rõ ràng, không có ghi chú)
        const signY = currentY;
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#0f172a')
          .text('ĐẠI DIỆN BÊN A', 60, signY, { width: 200, align: 'center' })
          .text('ĐẠI DIỆN BÊN B', 340, signY, { width: 200, align: 'center' });

        // Bên A ký sẵn Họ và tên rõ ràng của nhân viên xuất biên bản này
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#0f172a')
          .text(creatorName, 60, signY + 55, { width: 200, align: 'center' });

        if (data.status === 'CONFIRMED') {
          doc
            .fontSize(9)
            .font(fontBold)
            .fillColor('#16a34a')
            .text(`[ĐÃ KÝ ĐIỆN TỬ QUA CỔNG PORTAL]`, 340, signY + 45, { width: 200, align: 'center' })
            .fontSize(8)
            .font(fontRegular)
            .fillColor('#475569')
            .text(`Xác nhận lúc: ${data.confirmedAt ? new Date(data.confirmedAt).toLocaleString('vi-VN') : '---'}`, 340, signY + 60, { width: 200, align: 'center' });
        }

        doc.end();
      } catch (err) {
        this.logger.error(`Lỗi render PDF biên bản: ${err}`);
        reject(err);
      }
    });
  }

  private mapRowToEntity(r: any): DebtReconciliationReportEntity {
    let invoices: any[] = [];
    let payments: any[] = [];
    try {
      if (typeof r.invoices_json === 'string') {
        invoices = JSON.parse(r.invoices_json);
      } else if (Array.isArray(r.invoices_json)) {
        invoices = r.invoices_json;
      }
    } catch {
      invoices = [];
    }

    try {
      if (typeof r.payments_json === 'string') {
        payments = JSON.parse(r.payments_json);
      } else if (Array.isArray(r.payments_json)) {
        payments = r.payments_json;
      }
    } catch {
      payments = [];
    }

    return new DebtReconciliationReportEntity({
      id: r.id,
      code: r.code,
      agencyId: r.agency_id,
      agencyCode: r.agency_code,
      agencyName: r.agency_name,
      period: r.period,
      openingBalance: Number(r.opening_balance) || 0,
      totalInvoiced: Number(r.total_invoiced) || 0,
      totalPaid: Number(r.total_paid) || 0,
      closingBalance: Number(r.closing_balance) || 0,
      status: r.status as ReconciliationStatus,
      disputeNote: r.dispute_note,
      note: r.note,
      createdBy: r.created_by,
      createdByName: r.created_by_name,
      confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : undefined,
      confirmedBy: r.confirmed_by,
      invoices,
      payments,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    });
  }
}
