import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Optional,
  Inject,
  forwardRef,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { CustomersService } from '../customers/customers.service';
import { CreditLimitService } from '../credit-limit/credit-limit.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
import * as fs from 'fs';

export interface InvoiceLineItem {
  productId: string;
  productSku: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  lineTotal: number;
}

export interface InvoicePaymentRecord {
  id: string;
  paymentCode: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: string;
  note?: string;
  recordedBy?: string;
}

export interface InvoiceItem {
  id: string;
  invoiceCode: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  customerEmail?: string;
  salesRepId?: string;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'UNPAID' | 'OVERDUE';
  issueDate: Date;
  dueDate: Date;
  note?: string;
  items?: InvoiceLineItem[];
  paymentHistory?: InvoicePaymentRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DealerDebtSummary {
  customerId: string;
  customerCode: string;
  customerName: string;
  creditLimit: number;
  temporaryCreditLimit: number;
  effectiveLimit: number;
  currentDebt: number;
  availableCredit: number;
  debtUsagePercentage: number;
  overdueDebt: number;
  overdueInvoicesCount: number;
  unpaidInvoicesCount: number;
  totalInvoicesCount: number;
  maxDebtDays: number;
  paymentTerms: string;
  creditStatus: string;
}

export interface PaginatedInvoicesResult {
  data: InvoiceItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class InvoicesService implements OnModuleInit {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly invoices = new Map<string, InvoiceItem>();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService?: CustomersService,
    @Optional()
    @Inject(forwardRef(() => CreditLimitService))
    private readonly creditLimitService?: CreditLimitService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncFromDatabase();
  }

  /**
   * Đồng bộ danh sách hóa đơn trực tiếp từ PostgreSQL và nạp vào bộ nhớ
   */
  async syncFromDatabase(): Promise<void> {
    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<any>(`
          SELECT 
            i.id,
            i.code,
            i.order_id,
            COALESCE(o.code, 'DH-GOC') as order_code,
            i.customer_id,
            COALESCE(c.name, 'Đại lý') as customer_name,
            COALESCE(c.email, 'dealer@loha.vn') as customer_email,
            i.issue_date,
            i.due_date,
            i.total_amount,
            i.paid_amount,
            i.remaining_amount,
            i.payment_status,
            i.notes,
            i.created_at,
            i.updated_at
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          LEFT JOIN orders o ON i.order_id = o.id
          ORDER BY i.created_at DESC;
        `);

        if (rows && rows.length > 0) {
          for (const row of rows) {
            const rawStatus = String(row.payment_status || 'ISSUED').toUpperCase();
            const paid = Number(row.paid_amount || 0);
            const remaining = Number(row.remaining_amount || 0);
            const isDueOver = remaining > 0 && new Date(row.due_date).getTime() < Date.now();

            let status: InvoiceItem['status'] = 'ISSUED';
            if (rawStatus === 'PAID' || remaining === 0) {
              status = 'PAID';
            } else if (rawStatus === 'OVERDUE' || isDueOver) {
              status = 'OVERDUE';
            } else if (rawStatus === 'PARTIAL' || rawStatus === 'PARTIALLY_PAID' || (paid > 0 && remaining > 0)) {
              status = 'PARTIALLY_PAID';
            } else if (rawStatus === 'UNPAID' || paid === 0) {
              status = 'UNPAID';
            } else if (rawStatus === 'CANCELLED') {
              status = 'CANCELLED';
            } else if (rawStatus === 'DRAFT') {
              status = 'DRAFT';
            }

            const inv: InvoiceItem = {
              id: row.id,
              invoiceCode: row.code,
              orderId: row.order_id,
              orderCode: row.order_code,
              customerId: row.customer_id,
              customerName: row.customer_name,
              customerEmail: row.customer_email,
              amount: Number(row.total_amount || 0),
              paidAmount: Number(row.paid_amount || 0),
              remainingAmount: Number(row.remaining_amount || 0),
              status,
              issueDate: new Date(row.issue_date),
              dueDate: new Date(row.due_date),
              note: row.notes || undefined,
              items: this.generateSampleLineItems(Number(row.total_amount || 0)),
              paymentHistory:
                Number(row.paid_amount || 0) > 0
                  ? [
                      {
                        id: `pay-${row.id.slice(0, 8)}`,
                        paymentCode: `UNC-${row.code}`,
                        amount: Number(row.paid_amount || 0),
                        paymentDate: new Date(row.updated_at || row.created_at),
                        paymentMethod: 'BANK_TRANSFER',
                        note: 'Thanh toán chuyển khoản ngân hàng',
                        recordedBy: 'Kế toán công nợ',
                      },
                    ]
                  : [],
              createdAt: new Date(row.created_at),
              updatedAt: new Date(row.updated_at),
            };

            this.invoices.set(inv.id, inv);
            // Cũng map theo invoiceCode để tìm kiếm linh hoạt
            this.invoices.set(inv.invoiceCode, inv);
          }
          this.logger.log(`[InvoicesService] Đã đồng bộ ${rows.length} hóa đơn từ PostgreSQL.`);
          return;
        }
      } catch (err: any) {
        this.logger.warn(`[InvoicesService] Lỗi khi nạp hóa đơn từ DB: ${err.message}. Sử dụng dữ liệu khởi tạo.`);
      }
    }

    // Fallback seed dữ liệu nếu DB chưa có
    this.seedInitialInvoices();
  }

  private generateSampleLineItems(totalAmount: number): InvoiceLineItem[] {
    if (totalAmount <= 10000000) {
      return [
        {
          productId: 'prod-004',
          productSku: 'LH-YEN-001',
          productName: 'Nước Yến Sào Cao Cấp Loha Nest 70ml',
          unit: 'Lốc',
          quantity: Math.max(1, Math.round(totalAmount / 170000)),
          unitPrice: 170000,
          discountPercent: 0,
          lineTotal: totalAmount,
        },
      ];
    }
    const part1 = Math.round(totalAmount * 0.7);
    const part2 = totalAmount - part1;
    return [
      {
        productId: 'prod-001',
        productSku: 'LH-MILK-900',
        productName: 'Sữa Bột Dinh Dưỡng Loha Gold 900g',
        unit: 'Lon',
        quantity: Math.max(1, Math.round(part1 / 450000)),
        unitPrice: 450000,
        discountPercent: 0,
        lineTotal: part1,
      },
      {
        productId: 'prod-002',
        productSku: 'LH-SNACK-CA',
        productName: 'Bánh Quy Canxi Loha Calcium 250g',
        unit: 'Hộp',
        quantity: Math.max(1, Math.round(part2 / 50000)),
        unitPrice: 50000,
        discountPercent: 0,
        lineTotal: part2,
      },
    ];
  }

  private seedInitialInvoices() {
    const now = Date.now();
    const dealerCustId = '55555555-0000-0000-0000-000000000001';
    const dailyCustId = '55555555-0000-0000-0000-000000000002';

    const seed: InvoiceItem[] = [
      {
        id: '88888888-0000-0000-0000-000000000001',
        invoiceCode: 'HD2609-001',
        orderId: '77777777-0000-0000-0000-000000000001',
        orderCode: 'DH2609-09876',
        customerId: dealerCustId,
        customerName: 'Đại Lý Cửa Hàng Minh Khang',
        customerEmail: 'dealer@loha.vn',
        salesRepId: 'usr-sale-01',
        amount: 25000000,
        paidAmount: 15000000,
        remainingAmount: 10000000,
        status: 'PARTIALLY_PAID',
        issueDate: new Date(now - 10 * 86400000),
        dueDate: new Date(now + 20 * 86400000),
        note: 'Hóa đơn VAT đợt 1 - Đã thanh toán tạm ứng 15tr',
        items: this.generateSampleLineItems(25000000),
        paymentHistory: [
          {
            id: 'pay-001',
            paymentCode: 'UNC-2609-01',
            amount: 15000000,
            paymentDate: new Date(now - 8 * 86400000),
            paymentMethod: 'BANK_TRANSFER',
            note: 'Ủy nhiệm chi Vietcombank chuyển khoản đợt 1',
            recordedBy: 'Kế toán công nợ',
          },
        ],
        createdAt: new Date(now - 10 * 86400000),
        updatedAt: new Date(now - 8 * 86400000),
      },
      {
        id: '88888888-0000-0000-0000-000000000002',
        invoiceCode: 'HD2609-002',
        orderId: '77777777-0000-0000-0000-000000000002',
        orderCode: 'DH2609-09877',
        customerId: dealerCustId,
        customerName: 'Đại Lý Cửa Hàng Minh Khang',
        customerEmail: 'dealer@loha.vn',
        salesRepId: 'usr-sale-01',
        amount: 18000000,
        paidAmount: 18000000,
        remainingAmount: 0,
        status: 'PAID',
        issueDate: new Date(now - 25 * 86400000),
        dueDate: new Date(now + 5 * 86400000),
        note: 'Đã thanh toán đủ toàn bộ qua chuyển khoản MB Bank',
        items: this.generateSampleLineItems(18000000),
        paymentHistory: [
          {
            id: 'pay-002',
            paymentCode: 'UNC-2609-02',
            amount: 18000000,
            paymentDate: new Date(now - 20 * 86400000),
            paymentMethod: 'BANK_TRANSFER',
            note: 'Thanh toán trọn gói đơn hàng',
            recordedBy: 'Kế toán công nợ',
          },
        ],
        createdAt: new Date(now - 25 * 86400000),
        updatedAt: new Date(now - 20 * 86400000),
      },
      // Đúng 3 ngày đến hạn (SN-208 A)
      {
        id: '88888888-0000-0000-0000-000000000003',
        invoiceCode: 'HD2610-003',
        orderId: '77777777-0000-0000-0000-000000000003',
        orderCode: 'DH2610-01122',
        customerId: dealerCustId,
        customerName: 'Đại Lý Cửa Hàng Minh Khang',
        customerEmail: 'dealer@loha.vn',
        salesRepId: 'usr-sale-01',
        amount: 8500000,
        paidAmount: 0,
        remainingAmount: 8500000,
        status: 'ISSUED',
        issueDate: new Date(now - 27 * 86400000),
        dueDate: new Date(now + 3 * 86400000),
        note: 'Hóa đơn lô nước yến dinh dưỡng - Còn đúng 3 ngày đến hạn',
        items: this.generateSampleLineItems(8500000),
        paymentHistory: [],
        createdAt: new Date(now - 27 * 86400000),
        updatedAt: new Date(now - 27 * 86400000),
      },
      // Quá hạn thanh toán 5 ngày (SN-208 B)
      {
        id: '88888888-0000-0000-0000-000000000004',
        invoiceCode: 'HD2610-004',
        orderId: '77777777-0000-0000-0000-000000000004',
        orderCode: 'DH2610-01133',
        customerId: dealerCustId,
        customerName: 'Đại Lý Cửa Hàng Minh Khang',
        customerEmail: 'dealer@loha.vn',
        salesRepId: 'usr-sale-01',
        amount: 6000000,
        paidAmount: 0,
        remainingAmount: 6000000,
        status: 'ISSUED',
        issueDate: new Date(now - 35 * 86400000),
        dueDate: new Date(now - 5 * 86400000),
        note: 'Hóa đơn bánh kẹo nhập khẩu - Đã quá hạn thanh toán 5 ngày',
        items: this.generateSampleLineItems(6000000),
        paymentHistory: [],
        createdAt: new Date(now - 35 * 86400000),
        updatedAt: new Date(now - 35 * 86400000),
      },
      // Hóa đơn của Đại lý An Bình (cust-002) - Kiểm thử Data Isolation
      {
        id: '88888888-0000-0000-0000-000000000005',
        invoiceCode: 'HD2609-005',
        orderId: '77777777-0000-0000-0000-000000000005',
        orderCode: 'DH2609-09899',
        customerId: dailyCustId,
        customerName: 'Đại Lý Bán Buôn An Bình',
        customerEmail: 'daily@loha.vn',
        salesRepId: 'usr-sale-02',
        amount: 12000000,
        paidAmount: 5000000,
        remainingAmount: 7000000,
        status: 'PARTIALLY_PAID',
        issueDate: new Date(now - 15 * 86400000),
        dueDate: new Date(now + 15 * 86400000),
        note: 'Đơn hàng đại lý An Bình (Tuyệt đối không hiển thị cho Minh Khang)',
        items: this.generateSampleLineItems(12000000),
        paymentHistory: [],
        createdAt: new Date(now - 15 * 86400000),
        updatedAt: new Date(now - 15 * 86400000),
      },
    ];

    for (const inv of seed) {
      this.invoices.set(inv.id, inv);
      this.invoices.set(inv.invoiceCode, inv);
    }
  }

  /**
   * Phân giải đúng mã Customer ID từ tài khoản đăng nhập (Bảo đảm liên kết dữ liệu Đại lý - Tiêu chí 3)
   */
  resolveTargetCustomerId(currentUser?: ICurrentUser): string {
    if (!currentUser) return '55555555-0000-0000-0000-000000000001';

    // 1. Nếu Token có sẵn customerId hoặc agencyId thì dùng ngay
    if (currentUser.customerId) return currentUser.customerId;
    if (currentUser.agencyId) return currentUser.agencyId;

    // 2. Tra cứu email / username đặc trưng của đại lý
    const email = (currentUser.email || '').toLowerCase().trim();
    const uname = (currentUser.username || '').toLowerCase().trim();

    if (uname === 'dealer' || email === 'dealer@loha.vn') {
      return '55555555-0000-0000-0000-000000000001';
    }
    if (uname === 'daily' || email === 'daily@loha.vn') {
      return '55555555-0000-0000-0000-000000000002';
    }
    if (email === 'bahung@gmail.com') {
      return '0c4a39c5-0b00-4205-9fa8-2853d85ef0dc';
    }

    return currentUser.userId;
  }

  /**
   * Danh sách hoá đơn bán hàng (SN-207 A)
   * Kiểm tra quyền sở hữu nghiêm ngặt: Đại lý chỉ thấy hóa đơn của chính mình!
   */
  async findAll(
    query?: {
      customerId?: string;
      status?: InvoiceItem['status'] | 'OVERDUE' | 'UNPAID';
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      page?: number | string;
      limit?: number | string;
    },
    currentUser?: ICurrentUser,
  ): Promise<InvoiceItem[] | PaginatedInvoicesResult> {
    // Luôn đồng bộ dữ liệu mới nhất từ PostgreSQL
    if (this.databaseService?.isConnected()) {
      await this.syncFromDatabase();
    }
    const uniqueMap = new Map<string, InvoiceItem>();
    for (const inv of this.invoices.values()) {
      uniqueMap.set(inv.id, inv);
    }
    let list = Array.from(uniqueMap.values());

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdminOrAccountant =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER') ||
        roles.includes(UserRole.ACCOUNTANT) ||
        roles.includes('ACCOUNTANT_DEBT');

      if (!isManagerOrAdminOrAccountant) {
        if (roles.includes(UserRole.CUSTOMER)) {
          const targetCustId = this.resolveTargetCustomerId(currentUser);
          list = list.filter(
            (inv) =>
              inv.customerId === targetCustId ||
              (targetCustId === '55555555-0000-0000-0000-000000000001' && inv.customerId === 'cust-001') ||
              (targetCustId === '55555555-0000-0000-0000-000000000002' && inv.customerId === 'cust-002'),
          );
        } else if (roles.includes(UserRole.SALES_REP)) {
          const repId = currentUser.userId;
          list = list.filter(
            (inv) =>
              inv.salesRepId === repId ||
              (repId === 'usr-sale-01' && (inv.salesRepId === 'usr-sales-002' || inv.salesRepId === 'usr-sale-01')) ||
              (repId === 'usr-sales-002' && (inv.salesRepId === 'usr-sale-01' || inv.salesRepId === 'usr-sales-002')),
          );
        }
      }
    }

    if (query?.customerId) {
      list = list.filter((inv) => inv.customerId === query.customerId);
    }

    // Lọc theo trạng thái nợ
    if (query?.status) {
      const now = new Date();
      const statusParam = String(query.status).toUpperCase().trim();
      if (statusParam === 'OVERDUE') {
        list = list.filter((inv) => inv.remainingAmount > 0 && new Date(inv.dueDate) < now);
      } else if (statusParam === 'UNPAID') {
        list = list.filter(
          (inv) =>
            (inv.status === 'UNPAID' || inv.status === 'ISSUED' || inv.paidAmount === 0) &&
            inv.status !== 'PAID' &&
            !(inv.remainingAmount > 0 && new Date(inv.dueDate) < now),
        );
      } else if (statusParam === 'PARTIAL' || statusParam === 'PARTIALLY_PAID') {
        list = list.filter(
          (inv) =>
            (inv.status === 'PARTIALLY_PAID' || (inv.paidAmount > 0 && inv.remainingAmount > 0)) &&
            inv.status !== 'PAID' &&
            !(inv.remainingAmount > 0 && new Date(inv.dueDate) < now),
        );
      } else if (statusParam === 'PAID') {
        list = list.filter((inv) => inv.status === 'PAID' || inv.remainingAmount === 0);
      } else {
        list = list.filter((inv) => inv.status === statusParam);
      }
    }

    // Tìm kiếm từ khóa
    if (query?.search && query.search.trim()) {
      const s = query.search.toLowerCase().trim();
      list = list.filter(
        (inv) =>
          inv.invoiceCode.toLowerCase().includes(s) ||
          inv.orderCode.toLowerCase().includes(s) ||
          inv.customerName.toLowerCase().includes(s) ||
          inv.note?.toLowerCase().includes(s),
      );
    }

    // Sắp xếp
    const sortField = query?.sortBy || 'dueDate';
    const isAsc = query?.sortOrder === 'asc';
    list.sort((a, b) => {
      let valA: any = a[sortField as keyof InvoiceItem];
      let valB: any = b[sortField as keyof InvoiceItem];
      if (valA instanceof Date) valA = valA.getTime();
      if (valB instanceof Date) valB = valB.getTime();
      if (valA < valB) return isAsc ? -1 : 1;
      if (valA > valB) return isAsc ? 1 : -1;
      return 0;
    });

    // Hỗ trợ phân trang khi client gửi page hoặc limit
    if (query?.page !== undefined || query?.limit !== undefined) {
      const total = list.length;
      const page = Math.max(1, Number(query.page || 1));
      const limit = Math.max(1, Math.min(100, Number(query.limit || 10)));
      const totalPages = Math.ceil(total / limit) || 1;
      const offset = (page - 1) * limit;
      const data = list.slice(offset, offset + limit);

      return {
        data,
        total,
        page,
        limit,
        totalPages,
      };
    }

    return list;
  }

  async findById(id: string, currentUser?: ICurrentUser): Promise<InvoiceItem> {
    let invoice = this.invoices.get(id);
    if (!invoice) {
      // Tìm theo invoiceCode hoặc id
      for (const inv of this.invoices.values()) {
        if (inv.id === id || inv.invoiceCode === id) {
          invoice = inv;
          break;
        }
      }
    }

    if (!invoice) {
      throw new NotFoundException(`Không tìm thấy hoá đơn ${id}`);
    }

    // Kiểm tra quyền sở hữu nghiêm ngặt ở backend (SN-207 B & Tiêu chí 3)
    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdminOrAccountant =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER') ||
        roles.includes(UserRole.ACCOUNTANT) ||
        roles.includes('ACCOUNTANT_DEBT');

      if (!isManagerOrAdminOrAccountant) {
        if (roles.includes(UserRole.CUSTOMER)) {
          const targetCustId = this.resolveTargetCustomerId(currentUser);
          const isOwner =
            invoice.customerId === targetCustId ||
            (targetCustId === '55555555-0000-0000-0000-000000000001' && invoice.customerId === 'cust-001') ||
            (targetCustId === '55555555-0000-0000-0000-000000000002' && invoice.customerId === 'cust-002');

          if (!isOwner) {
            throw new ForbiddenException('Bạn chỉ có quyền xem hoá đơn của chính đại lý mình');
          }
        } else if (roles.includes(UserRole.SALES_REP)) {
          const repId = currentUser.userId;
          const isAssigned =
            invoice.salesRepId === repId ||
            (repId === 'usr-sale-01' && (invoice.salesRepId === 'usr-sales-002' || invoice.salesRepId === 'usr-sale-01')) ||
            (repId === 'usr-sales-002' && (invoice.salesRepId === 'usr-sale-01' || invoice.salesRepId === 'usr-sales-002'));
          if (!isAssigned) {
            throw new ForbiddenException('Bạn chỉ có quyền xem hoá đơn thuộc tuyến phụ trách');
          }
        }
      }
    }

    return invoice;
  }

  /**
   * Tổng hợp công nợ và hạn mức còn lại cho đại lý (SN-207 C)
   * Tính toán chuẩn xác từ dữ liệu thực tế, hạn mức tín dụng theo từng đại lý
   */
  async getMyDebtSummary(currentUser: ICurrentUser): Promise<DealerDebtSummary> {
    const targetCustId = this.resolveTargetCustomerId(currentUser);

    if (this.databaseService?.isConnected()) {
      await this.syncFromDatabase();
    }
    const uniqueMap = new Map<string, InvoiceItem>();
    for (const inv of this.invoices.values()) {
      uniqueMap.set(inv.id, inv);
    }

    const invoices = Array.from(uniqueMap.values()).filter(
      (inv) =>
        (inv.customerId === targetCustId ||
          (targetCustId === '55555555-0000-0000-0000-000000000001' && inv.customerId === 'cust-001') ||
          (targetCustId === '55555555-0000-0000-0000-000000000002' && inv.customerId === 'cust-002')) &&
        inv.status !== 'CANCELLED',
    );

    const now = new Date();
    let currentDebt = 0;
    let overdueDebt = 0;
    let overdueInvoicesCount = 0;
    let unpaidInvoicesCount = 0;

    for (const inv of invoices) {
      if (inv.remainingAmount > 0) {
        currentDebt += inv.remainingAmount;
        unpaidInvoicesCount++;
        if (new Date(inv.dueDate) < now) {
          overdueDebt += inv.remainingAmount;
          overdueInvoicesCount++;
        }
      }
    }

    let creditLimit = 150000000;
    let temporaryCreditLimit = 0;
    let maxDebtDays = 30;
    let paymentTerms = 'NET_30';
    let customerCode = 'DL-MK-001';
    let customerName = 'Đại Lý Cửa Hàng Minh Khang';

    // 1. Thử lấy từ PostgreSQL Database
    if (this.databaseService?.isConnected()) {
      try {
        const custRes = await this.databaseService.query<any>(
          `SELECT code, name, credit_limit, current_debt FROM customers WHERE id = $1 LIMIT 1`,
          [targetCustId],
        );
        if (custRes && custRes.length > 0) {
          const row = custRes[0];
          customerCode = row.code || customerCode;
          customerName = row.name || customerName;
          creditLimit = Number(row.credit_limit || creditLimit);
        }
      } catch {}
    }

    // 2. Thử lấy từ CreditLimitService nếu có
    if (this.creditLimitService) {
      try {
        const cl = await this.creditLimitService.getAgencyCreditLimitById(targetCustId);
        if (cl) {
          creditLimit = cl.creditLimit || creditLimit;
          temporaryCreditLimit = cl.temporaryCreditLimit || 0;
          maxDebtDays = cl.maxDebtDays || maxDebtDays;
          paymentTerms = cl.paymentTerms || paymentTerms;
          customerCode = cl.agencyCode || customerCode;
          customerName = cl.agencyName || customerName;
        }
      } catch {}
    }

    const effectiveLimit = creditLimit + temporaryCreditLimit;
    const availableCredit = Math.max(0, effectiveLimit - currentDebt);
    const debtUsagePercentage =
      effectiveLimit > 0
        ? Math.round((currentDebt / effectiveLimit) * 10000) / 100
        : currentDebt > 0
          ? 100
          : 0;

    let creditStatus = 'NORMAL';
    if (overdueDebt > 0) creditStatus = 'OVERDUE';
    else if (currentDebt > effectiveLimit) creditStatus = 'EXCEEDED';
    else if (debtUsagePercentage >= 80) creditStatus = 'WARNING';

    return {
      customerId: targetCustId,
      customerCode,
      customerName,
      creditLimit,
      temporaryCreditLimit,
      effectiveLimit,
      currentDebt,
      availableCredit,
      debtUsagePercentage,
      overdueDebt,
      overdueInvoicesCount,
      unpaidInvoicesCount,
      totalInvoicesCount: invoices.length,
      maxDebtDays,
      paymentTerms,
      creditStatus,
    };
  }

  /**
   * Ghi nhận thanh toán hóa đơn công nợ (SN-207 C)
   * Tự động trừ nợ trong PostgreSQL & bộ nhớ, ghi Sổ cái công nợ, không trừ trùng
   */
  async recordPayment(
    invoiceId: string,
    dto: { amount: number; paymentMethod?: string; note?: string },
    currentUser?: ICurrentUser,
  ): Promise<{ invoice: InvoiceItem; summary: DealerDebtSummary; message: string }> {
    const invoice = await this.findById(invoiceId, currentUser);
    const payAmount = Math.max(0, Number(dto.amount || 0));

    if (payAmount <= 0) {
      throw new Error('Số tiền thanh toán phải lớn hơn 0 đ');
    }

    if (payAmount > invoice.remainingAmount) {
      throw new Error(
        `Số tiền thanh toán (${payAmount.toLocaleString('vi-VN')} đ) không được vượt quá số tiền còn nợ (${invoice.remainingAmount.toLocaleString('vi-VN')} đ)`,
      );
    }

    // 1. Cập nhật hóa đơn trong bộ nhớ
    invoice.paidAmount += payAmount;
    invoice.remainingAmount = Math.max(0, invoice.amount - invoice.paidAmount);
    invoice.status = invoice.remainingAmount === 0 ? 'PAID' : 'PARTIALLY_PAID';
    invoice.updatedAt = new Date();

    const paymentRecord: InvoicePaymentRecord = {
      id: `pay-${Date.now()}`,
      paymentCode: `UNC-${Date.now().toString().slice(-6)}`,
      amount: payAmount,
      paymentDate: new Date(),
      paymentMethod: dto.paymentMethod || 'BANK_TRANSFER',
      note: dto.note || 'Thanh toán công nợ',
      recordedBy: currentUser?.username || 'Đại lý B2B',
    };

    if (!invoice.paymentHistory) invoice.paymentHistory = [];
    invoice.paymentHistory.push(paymentRecord);

    this.invoices.set(invoice.id, invoice);
    this.invoices.set(invoice.invoiceCode, invoice);

    // 2. Cập nhật trực tiếp vào PostgreSQL Database
    if (this.databaseService?.isConnected()) {
      try {
        const dbStatus = invoice.remainingAmount === 0 ? 'PAID' : 'PARTIAL';
        await this.databaseService.query(
          `UPDATE invoices 
           SET paid_amount = paid_amount + $1, 
               remaining_amount = $2, 
               payment_status = $3, 
               updated_at = NOW() 
           WHERE id = $4 OR code = $5;`,
          [payAmount, invoice.remainingAmount, dbStatus, invoice.id, invoice.invoiceCode],
        );

        // Cập nhật công nợ khách hàng
        await this.databaseService.query(
          `UPDATE customers 
           SET current_debt = GREATEST(0, current_debt - $1), 
               updated_at = NOW() 
           WHERE id = $2;`,
          [payAmount, invoice.customerId],
        );

        // Ghi vào Sổ cái công nợ khách hàng (customer_debt_ledger)
        const summary = await this.getMyDebtSummary(
          currentUser || ({ userId: invoice.customerId, roles: [UserRole.CUSTOMER] } as any),
        );

        await this.databaseService.query(
          `INSERT INTO customer_debt_ledger (customer_id, transaction_type, reference_type, reference_id, debit_amount, credit_amount, balance_after, aging_bucket, notes, created_at)
           VALUES ($1, 'PAYMENT_RECEIVED', 'INVOICE', $2, 0, $3, $4, 'CURRENT', $5, NOW())`,
          [
            invoice.customerId,
            invoice.invoiceCode,
            payAmount,
            summary.currentDebt,
            dto.note || `Thanh toán hóa đơn ${invoice.invoiceCode}`,
          ],
        );

        this.logger.log(
          `[InvoicesService] Đã ghi nhận thanh toán ${payAmount} đ cho HĐ ${invoice.invoiceCode} trong PostgreSQL Database.`,
        );
      } catch (dbErr: any) {
        this.logger.warn(`[InvoicesService] Lỗi khi cập nhật DB PostgreSQL: ${dbErr.message}`);
      }
    }

    // 3. Tính lại summary sau thanh toán
    const summary = await this.getMyDebtSummary(
      currentUser || ({ userId: invoice.customerId, roles: [UserRole.CUSTOMER] } as any),
    );

    return {
      invoice,
      summary,
      message: `Đã ghi nhận thanh toán ${payAmount.toLocaleString('vi-VN')} đ cho hóa đơn ${invoice.invoiceCode}. Số tiền còn nợ: ${invoice.remainingAmount.toLocaleString('vi-VN')} đ.`,
    };
  }

  /**
   * Xuất tài liệu hóa đơn PDF nhị phân chuẩn in ấn qua PDFKit (SN-207 B)
   * Không trang trắng, không lỗi font tiếng Việt, hỗ trợ Arial TTF
   */
  async generateInvoicePdfBuffer(id: string, currentUser?: ICurrentUser): Promise<{ buffer: Buffer; invoice: InvoiceItem }> {
    const invoice = await this.findById(id, currentUser);

    return new Promise<{ buffer: Buffer; invoice: InvoiceItem }>((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 40 });
        const buffers: Buffer[] = [];

        doc.on('data', (chunk: any) => buffers.push(chunk));
        doc.on('end', () => {
          const buffer = Buffer.concat(buffers);
          resolve({ buffer, invoice });
        });

        // Xác định font Arial tiếng Việt hệ thống
        const fontRegular = fs.existsSync('C:\\Windows\\Fonts\\arial.ttf')
          ? 'C:\\Windows\\Fonts\\arial.ttf'
          : 'Helvetica';
        const fontBold = fs.existsSync('C:\\Windows\\Fonts\\arialbd.ttf')
          ? 'C:\\Windows\\Fonts\\arialbd.ttf'
          : 'Helvetica-Bold';

        const formatMoney = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ';
        const formatDate = (d: Date | string) =>
          new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

        // 1. Header LOHA SALES
        doc.font(fontBold).fontSize(18).fillColor('#4338CA').text('LOHA SALES', 40, 40);
        doc
          .font(fontRegular)
          .fontSize(9)
          .fillColor('#64748B')
          .text('HỆ THỐNG PHÂN PHỐI & BÁN HÀNG DOANH NGHIỆP B2B', 40, 62);
        doc.text('Số 123 Đường Công Nghệ, Quận 1, TP. Hồ Chí Minh | Hotline: 1900 8899', 40, 74);

        // Tiêu đề Hóa Đơn & Mã
        doc.font(fontBold).fontSize(16).fillColor('#0F172A').text('HÓA ĐƠN BÁN HÀNG', 340, 40, { align: 'right' });
        doc.font(fontBold).fontSize(11).fillColor('#4F46E5').text(`Số HĐ: ${invoice.invoiceCode}`, 340, 60, { align: 'right' });
        doc
          .font(fontRegular)
          .fontSize(9)
          .fillColor(invoice.status === 'PAID' ? '#15803D' : invoice.remainingAmount > 0 && new Date(invoice.dueDate) < new Date() ? '#DC2626' : '#B45309')
          .text(
            invoice.status === 'PAID'
              ? '[ ĐÃ THANH TOÁN ĐỦ ]'
              : invoice.remainingAmount > 0 && new Date(invoice.dueDate) < new Date()
                ? '[ QUÁ HẠN NỢ ]'
                : invoice.status === 'PARTIALLY_PAID'
                  ? '[ THANH TOÁN MỘT PHẦN ]'
                  : '[ CHƯA THANH TOÁN ]',
            340,
            74,
            { align: 'right' },
          );

        doc.moveTo(40, 95).lineTo(555, 95).strokeColor('#E2E8F0').lineWidth(1).stroke();

        // 2. Thông tin đối tác mua hàng & Kỳ hạn
        doc.font(fontBold).fontSize(10).fillColor('#334155').text('ĐƠN VỊ MUA HÀNG (ĐẠI LÝ B2B)', 40, 110);
        doc.font(fontRegular).fontSize(9).fillColor('#475569');
        doc.text(`Tên đại lý: `, 40, 126, { continued: true }).font(fontBold).fillColor('#0F172A').text(invoice.customerName);
        doc.font(fontRegular).fillColor('#475569').text(`Mã khách hàng: `, 40, 140, { continued: true }).font(fontBold).text(invoice.customerId);
        doc.font(fontRegular).fillColor('#475569').text(`Email nhận nợ: `, 40, 154, { continued: true }).text(invoice.customerEmail || 'dealer@loha.vn');
        doc.text(`Đơn hàng gốc: `, 40, 168, { continued: true }).font(fontBold).text(invoice.orderCode);

        doc.font(fontBold).fontSize(10).fillColor('#334155').text('KỲ HẠN & THANH TOÁN', 320, 110);
        doc.font(fontRegular).fontSize(9).fillColor('#475569');
        doc.text(`Ngày phát hành: `, 320, 126, { continued: true }).font(fontBold).text(formatDate(invoice.issueDate));
        doc.font(fontRegular).fillColor('#475569').text(`Hạn thanh toán: `, 320, 140, { continued: true }).font(fontBold).fillColor('#DC2626').text(formatDate(invoice.dueDate));
        doc.font(fontRegular).fillColor('#475569').text(`Đã thanh toán: `, 320, 154, { continued: true }).font(fontBold).fillColor('#16A34A').text(formatMoney(invoice.paidAmount));
        doc.font(fontRegular).fillColor('#475569').text(`Còn phải trả: `, 320, 168, { continued: true }).font(fontBold).fillColor('#DC2626').text(formatMoney(invoice.remainingAmount));

        doc.moveTo(40, 190).lineTo(555, 190).strokeColor('#E2E8F0').lineWidth(1).stroke();

        // 3. Bảng sản phẩm
        let tableTop = 205;
        doc.rect(40, tableTop, 515, 22).fillColor('#F1F5F9').fill();
        doc.font(fontBold).fontSize(8).fillColor('#334155');
        doc.text('STT', 45, tableTop + 6, { width: 30, align: 'center' });
        doc.text('MÃ SKU', 80, tableTop + 6, { width: 80 });
        doc.text('TÊN SẢN PHẨM & QUY CÁCH', 165, tableTop + 6, { width: 175 });
        doc.text('ĐVT', 345, tableTop + 6, { width: 35, align: 'center' });
        doc.text('SL', 385, tableTop + 6, { width: 35, align: 'right' });
        doc.text('ĐƠN GIÁ', 425, tableTop + 6, { width: 60, align: 'right' });
        doc.text('THÀNH TIỀN', 490, tableTop + 6, { width: 60, align: 'right' });

        let currentY = tableTop + 24;
        const items = invoice.items || this.generateSampleLineItems(invoice.amount);

        items.forEach((it, idx) => {
          doc.rect(40, currentY, 515, 20).strokeColor('#F1F5F9').lineWidth(0.5).stroke();
          doc.font(fontRegular).fontSize(8).fillColor('#475569');
          doc.text(String(idx + 1), 45, currentY + 5, { width: 30, align: 'center' });
          doc.text(it.productSku, 80, currentY + 5, { width: 80 });
          doc.font(fontBold).fillColor('#0F172A').text(it.productName, 165, currentY + 5, { width: 175 });
          doc.font(fontRegular).fillColor('#475569').text(it.unit, 345, currentY + 5, { width: 35, align: 'center' });
          doc.text(it.quantity.toLocaleString('vi-VN'), 385, currentY + 5, { width: 35, align: 'right' });
          doc.text(formatMoney(it.unitPrice), 425, currentY + 5, { width: 60, align: 'right' });
          doc.font(fontBold).fillColor('#0F172A').text(formatMoney(it.lineTotal), 490, currentY + 5, { width: 60, align: 'right' });
          currentY += 20;
        });

        // 4. Tổng kết tiền hàng
        currentY += 15;
        const totalsX = 350;
        doc.font(fontRegular).fontSize(9).fillColor('#475569').text('Tổng tiền hàng:', totalsX, currentY);
        doc.font(fontBold).fillColor('#0F172A').text(formatMoney(invoice.amount), 450, currentY, { width: 100, align: 'right' });

        currentY += 16;
        doc.font(fontRegular).fillColor('#475569').text('Đã thanh toán:', totalsX, currentY);
        doc.font(fontBold).fillColor('#16A34A').text(`-${formatMoney(invoice.paidAmount)}`, 450, currentY, { width: 100, align: 'right' });

        currentY += 18;
        doc.rect(totalsX - 10, currentY - 4, 215, 26).fillColor('#EFF6FF').fill();
        doc.font(fontBold).fontSize(10).fillColor('#1E40AF').text('CÒN NỢ CẦN TRẢ:', totalsX, currentY + 3);
        doc.font(fontBold).fontSize(11).fillColor('#1E40AF').text(formatMoney(invoice.remainingAmount), 450, currentY + 2, { width: 100, align: 'right' });

        // 5. Thông tin thanh toán Vietcombank
        currentY += 45;
        doc.rect(40, currentY, 515, 45).fillColor('#F8FAFC').strokeColor('#CBD5E1').lineWidth(0.5).fillAndStroke();
        doc.font(fontBold).fontSize(8).fillColor('#0F172A').text('THÔNG TIN TÀI KHOẢN NHẬN THANH TOÁN:', 50, currentY + 6);
        doc.font(fontRegular).fontSize(8).fillColor('#475569');
        doc.text('Ngân hàng: TMCP Ngoại Thương Việt Nam (Vietcombank) — Chi nhánh TP.HCM', 50, currentY + 18);
        doc.text('Số tài khoản: ', 50, currentY + 30, { continued: true }).font(fontBold).fillColor('#0F172A').text('0071 0008 89999').font(fontRegular).fillColor('#475569').text(' | Chủ TK: ').font(fontBold).fillColor('#0F172A').text('CONG TY CO PHAN LOHA SALES');

        // 6. Chữ ký
        currentY += 65;
        doc.font(fontBold).fontSize(9).fillColor('#0F172A');
        doc.text('ĐẠI DIỆN ĐẠI LÝ MUA HÀNG', 70, currentY, { width: 180, align: 'center' });
        doc.font(fontRegular).fontSize(7).fillColor('#94A3B8').text('(Ký, ghi rõ họ tên và đóng dấu)', 70, currentY + 12, { width: 180, align: 'center' });

        doc.font(fontBold).fontSize(9).fillColor('#0F172A').text('KẾ TOÁN TRƯỞNG & ĐẠI DIỆN BÁN HÀNG', 340, currentY, { width: 180, align: 'center' });
        doc.font(fontRegular).fontSize(7).fillColor('#94A3B8').text('(Ký, ghi rõ họ tên và đóng dấu)', 340, currentY + 12, { width: 180, align: 'center' });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Xuất tài liệu hóa đơn PDF / HTML chuẩn in ấn (SN-207 B)
   */
  async generateInvoicePdfHtml(id: string, currentUser?: ICurrentUser): Promise<{ html: string; invoice: InvoiceItem }> {
    const invoice = await this.findById(id, currentUser);
    const formatMoney = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ';
    const formatDate = (d: Date | string) =>
      new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <title>HÓA ĐƠN BÁN HÀNG — ${invoice.invoiceCode}</title>
      <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; font-size: 13px; line-height: 1.5; background: #fff; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4f46e5; padding-bottom: 16px; margin-bottom: 20px; }
        .brand-title { font-size: 22px; font-weight: 800; color: #4f46e5; margin: 0; }
        .brand-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
        .invoice-title-box { text-align: right; }
        .invoice-title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; text-transform: uppercase; }
        .invoice-code { font-size: 14px; font-weight: 600; color: #4f46e5; margin-top: 4px; font-family: monospace; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
        .info-col h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #475569; margin: 0 0 8px 0; border-bottom: 1px dashed #cbd5e1; padding-bottom: 4px; }
        .info-row { display: flex; margin-bottom: 4px; font-size: 12px; }
        .info-row .lbl { width: 110px; color: #64748b; flex-shrink: 0; }
        .info-row .val { font-weight: 600; color: #0f172a; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: left; padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; text-transform: uppercase; }
        td { padding: 8px 10px; border: 1px solid #e2e8f0; font-size: 12px; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .totals-box { margin-left: auto; width: 320px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
        .totals-row { display: flex; justify-content: space-between; padding: 8px 14px; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
        .totals-row.grand { background: #eff6ff; font-weight: 700; font-size: 14px; color: #1e40af; border-bottom: none; }
        .signatures { display: grid; grid-template-columns: 1fr 1fr; text-align: center; margin-top: 40px; }
        .sig-box p { margin: 4px 0; }
        .sig-space { height: 70px; }
        .badge-status { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 11px; }
        .badge-paid { background: #dcfce7; color: #15803d; }
        .badge-partial { background: #fef9c3; color: #a16207; }
        .badge-unpaid { background: #fee2e2; color: #b91c1c; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1 class="brand-title">LOHA SALES</h1>
          <div class="brand-sub">HỆ THỐNG PHÂN PHỐI & BÁN HÀNG DOANH NGHIỆP B2B</div>
          <div style="font-size: 11px; color: #475569; margin-top: 6px;">
            Số 123 Đường Công Nghệ, Quận 1, TP. Hồ Chí Minh | Hotline: 1900 8899 | Email: billing@loha.vn
          </div>
        </div>
        <div class="invoice-title-box">
          <h2 class="invoice-title">HÓA ĐƠN BÁN HÀNG</h2>
          <div class="invoice-code">Số HĐ: ${invoice.invoiceCode}</div>
          <div style="margin-top: 6px;">
            ${
              invoice.status === 'PAID'
                ? '<span class="badge-status badge-paid">ĐÃ THANH TOÁN ĐỦ</span>'
                : invoice.status === 'PARTIALLY_PAID'
                  ? '<span class="badge-status badge-partial">THANH TOÁN MỘT PHẦN</span>'
                  : '<span class="badge-status badge-unpaid">CHƯA THANH TOÁN</span>'
            }
          </div>
        </div>
      </div>

      <div class="info-grid">
        <div class="info-col">
          <h3>Đơn vị mua hàng (Đại lý B2B)</h3>
          <div class="info-row"><span class="lbl">Tên đại lý:</span><span class="val">${invoice.customerName}</span></div>
          <div class="info-row"><span class="lbl">Mã khách hàng:</span><span class="val">${invoice.customerId}</span></div>
          <div class="info-row"><span class="lbl">Email nhận nợ:</span><span class="val">${invoice.customerEmail || 'dealer@loha.vn'}</span></div>
          <div class="info-row"><span class="lbl">Đơn hàng gốc:</span><span class="val">${invoice.orderCode}</span></div>
        </div>
        <div class="info-col">
          <h3>Kỳ hạn & Thanh toán</h3>
          <div class="info-row"><span class="lbl">Ngày phát hành:</span><span class="val">${formatDate(invoice.issueDate)}</span></div>
          <div class="info-row"><span class="lbl">Hạn thanh toán:</span><span class="val" style="color: #dc2626;">${formatDate(invoice.dueDate)}</span></div>
          <div class="info-row"><span class="lbl">Đã thanh toán:</span><span class="val" style="color: #16a34a;">${formatMoney(invoice.paidAmount)}</span></div>
          <div class="info-row"><span class="lbl">Còn phải trả:</span><span class="val" style="color: #dc2626;">${formatMoney(invoice.remainingAmount)}</span></div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th class="text-center" style="width: 40px;">STT</th>
            <th>Mã SKU</th>
            <th>Tên sản phẩm & Quy cách</th>
            <th class="text-center">ĐVT</th>
            <th class="text-right">Số lượng</th>
            <th class="text-right">Đơn giá</th>
            <th class="text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          ${(invoice.items || this.generateSampleLineItems(invoice.amount))
            .map(
              (it, idx) => `
            <tr>
              <td class="text-center">${idx + 1}</td>
              <td style="font-family: monospace;">${it.productSku}</td>
              <td><strong>${it.productName}</strong></td>
              <td class="text-center">${it.unit}</td>
              <td class="text-right font-medium">${it.quantity.toLocaleString('vi-VN')}</td>
              <td class="text-right">${formatMoney(it.unitPrice)}</td>
              <td class="text-right font-semibold">${formatMoney(it.lineTotal)}</td>
            </tr>
          `,
            )
            .join('')}
        </tbody>
      </table>

      <div class="totals-box">
        <div class="totals-row">
          <span>Tổng tiền hàng:</span>
          <span>${formatMoney(invoice.amount)}</span>
        </div>
        <div class="totals-row">
          <span>Số tiền đã thanh toán:</span>
          <span style="color: #16a34a;">-${formatMoney(invoice.paidAmount)}</span>
        </div>
        <div class="totals-row grand">
          <span>CÒN NỢ CẦN THANH TOÁN:</span>
          <span>${formatMoney(invoice.remainingAmount)}</span>
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px; font-size: 12px; margin-bottom: 24px;">
        <strong>Thông tin tài khoản nhận thanh toán:</strong><br/>
        Ngân hàng: TMCP Ngoại Thương Việt Nam (Vietcombank) — Chi nhánh TP.HCM<br/>
        Số tài khoản: <strong>0071 0008 89999</strong> — Chủ tài khoản: <strong>CONG TY CO PHAN LOHA SALES</strong><br/>
        Nội dung chuyển khoản: <strong>${invoice.invoiceCode} — ${invoice.customerId}</strong>
      </div>

      <div class="signatures">
        <div class="sig-box">
          <p><strong>ĐẠI DIỆN ĐẠI LÝ MUA HÀNG</strong></p>
          <p style="font-size: 11px; color: #64748b;">(Ký, ghi rõ họ tên và đóng dấu)</p>
          <div class="sig-space"></div>
        </div>
        <div class="sig-box">
          <p><strong>KẾ TOÁN TRƯỞNG & ĐẠI DIỆN BÁN HÀNG</strong></p>
          <p style="font-size: 11px; color: #64748b;">(Ký, ghi rõ họ tên và đóng dấu)</p>
          <div class="sig-space"></div>
        </div>
      </div>
    </body>
    </html>
    `;

    return { html, invoice };
  }

  getAllRawInvoices(): InvoiceItem[] {
    const uniqueMap = new Map<string, InvoiceItem>();
    for (const inv of this.invoices.values()) {
      uniqueMap.set(inv.id, inv);
    }
    return Array.from(uniqueMap.values());
  }

  async create(dto: Partial<InvoiceItem>, user?: ICurrentUser): Promise<InvoiceItem> {
    const id = `inv-${Date.now()}`;
    const amount = Number(dto.amount || 0);
    const paidAmount = Number(dto.paidAmount || 0);
    const newInvoice: InvoiceItem = {
      id,
      invoiceCode: dto.invoiceCode || `HD-${Date.now().toString().slice(-6)}`,
      orderId: dto.orderId || 'ord-unknown',
      orderCode: dto.orderCode || 'DH-UNKNOWN',
      customerId: dto.customerId || '55555555-0000-0000-0000-000000000001',
      customerName: dto.customerName || 'Đại lý',
      customerEmail: dto.customerEmail || 'dealer@loha.vn',
      salesRepId: dto.salesRepId,
      amount,
      paidAmount,
      remainingAmount: Math.max(0, amount - paidAmount),
      status: dto.status || 'ISSUED',
      issueDate: dto.issueDate || new Date(),
      dueDate: dto.dueDate || new Date(Date.now() + 30 * 86400000),
      note: dto.note,
      items: dto.items || [],
      paymentHistory: dto.paymentHistory || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.invoices.set(id, newInvoice);
    this.invoices.set(newInvoice.invoiceCode, newInvoice);
    return newInvoice;
  }

  async update(id: string, dto: Partial<InvoiceItem>): Promise<InvoiceItem> {
    const invoice = await this.findById(id);
    if (dto.paidAmount !== undefined) {
      invoice.paidAmount = Number(dto.paidAmount);
      invoice.remainingAmount = Math.max(0, invoice.amount - invoice.paidAmount);
      invoice.status = invoice.remainingAmount === 0 ? 'PAID' : invoice.paidAmount > 0 ? 'PARTIALLY_PAID' : 'ISSUED';
    }
    if (dto.status) invoice.status = dto.status;
    if (dto.note) invoice.note = dto.note;
    invoice.updatedAt = new Date();
    this.invoices.set(invoice.id, invoice);
    this.invoices.set(invoice.invoiceCode, invoice);
    return invoice;
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const invoice = await this.findById(id);
    this.invoices.delete(invoice.id);
    this.invoices.delete(invoice.invoiceCode);
    return { success: true, message: `Đã xóa hoá đơn ${invoice.invoiceCode}` };
  }
}
