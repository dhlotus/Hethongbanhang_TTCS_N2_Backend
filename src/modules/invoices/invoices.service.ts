import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { CustomersService } from '../customers/customers.service';
import { CreditLimitService } from '../credit-limit/credit-limit.service';

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
  status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
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

@Injectable()
export class InvoicesService {
  private readonly invoices = new Map<string, InvoiceItem>();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService?: CustomersService,
    @Optional()
    @Inject(forwardRef(() => CreditLimitService))
    private readonly creditLimitService?: CreditLimitService,
  ) {
    this.seedInitialInvoices();
  }

  private seedInitialInvoices() {
    const now = Date.now();
    const seed: InvoiceItem[] = [
      // 1. Hóa đơn thanh toán một phần (còn nợ 10.000.000 đ, hạn còn 20 ngày)
      {
        id: 'inv-001',
        invoiceCode: 'HD2609-001',
        orderId: 'ord-001',
        orderCode: 'DH2609-09876',
        customerId: 'cust-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        customerEmail: 'dealer@loha.vn',
        salesRepId: 'usr-sale-01',
        amount: 25000000,
        paidAmount: 15000000,
        remainingAmount: 10000000,
        status: 'PARTIALLY_PAID',
        issueDate: new Date(now - 10 * 86400000),
        dueDate: new Date(now + 20 * 86400000),
        note: 'Hóa đơn VAT đợt 1 - Đã thanh toán tạm ứng 15tr',
        items: [
          {
            productId: 'prod-001',
            productSku: 'LH-MILK-900',
            productName: 'Sữa Bột Dinh Dưỡng Loha Gold 900g',
            unit: 'Lon',
            quantity: 50,
            unitPrice: 450000,
            discountPercent: 0,
            lineTotal: 22500000,
          },
          {
            productId: 'prod-002',
            productSku: 'LH-SNACK-CA',
            productName: 'Bánh Quy Canxi Loha Calcium 250g',
            unit: 'Hộp',
            quantity: 50,
            unitPrice: 50000,
            discountPercent: 0,
            lineTotal: 2500000,
          },
        ],
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

      // 2. Hóa đơn đã thanh toán đầy đủ (còn nợ 0 đ)
      {
        id: 'inv-002',
        invoiceCode: 'HD2609-002',
        orderId: 'ord-002',
        orderCode: 'DH2609-09877',
        customerId: 'cust-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        customerEmail: 'dealer@loha.vn',
        salesRepId: 'usr-sale-01',
        amount: 18000000,
        paidAmount: 18000000,
        remainingAmount: 0,
        status: 'PAID',
        issueDate: new Date(now - 25 * 86400000),
        dueDate: new Date(now + 5 * 86400000),
        note: 'Đã thanh toán đủ toàn bộ qua chuyển khoản MB Bank',
        items: [
          {
            productId: 'prod-003',
            productSku: 'LH-TEA-001',
            productName: 'Trà Xanh Hòa Tan Thượng Hạng Loha Tea',
            unit: 'Hộp',
            quantity: 200,
            unitPrice: 90000,
            discountPercent: 0,
            lineTotal: 18000000,
          },
        ],
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

      // 3. HÓA ĐƠN CÒN ĐÚNG 3 NGÀY ĐẾN HẠN (SN-208 A)
      {
        id: 'inv-003',
        invoiceCode: 'HD2610-003',
        orderId: 'ord-003',
        orderCode: 'DH2610-01122',
        customerId: 'cust-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        customerEmail: 'dealer@loha.vn',
        salesRepId: 'usr-sale-01',
        amount: 8500000,
        paidAmount: 0,
        remainingAmount: 8500000,
        status: 'ISSUED',
        issueDate: new Date(now - 27 * 86400000),
        dueDate: new Date(now + 3 * 86400000), // Đúng 3 ngày tới hạn!
        note: 'Hóa đơn lô nước yến dinh dưỡng - Còn đúng 3 ngày đến hạn',
        items: [
          {
            productId: 'prod-004',
            productSku: 'LH-YEN-001',
            productName: 'Nước Yến Sào Cao Cấp Loha Nest 70ml',
            unit: 'Lốc',
            quantity: 50,
            unitPrice: 170000,
            discountPercent: 0,
            lineTotal: 8500000,
          },
        ],
        paymentHistory: [],
        createdAt: new Date(now - 27 * 86400000),
        updatedAt: new Date(now - 27 * 86400000),
      },

      // 4. HÓA ĐƠN ĐÃ QUÁ HẠN THANH TOÁN 5 NGÀY (SN-208 B)
      {
        id: 'inv-004',
        invoiceCode: 'HD2610-004',
        orderId: 'ord-004',
        orderCode: 'DH2610-01133',
        customerId: 'cust-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        customerEmail: 'dealer@loha.vn',
        salesRepId: 'usr-sale-01',
        amount: 6000000,
        paidAmount: 0,
        remainingAmount: 6000000,
        status: 'ISSUED',
        issueDate: new Date(now - 35 * 86400000),
        dueDate: new Date(now - 5 * 86400000), // Đã quá hạn 5 ngày!
        note: 'Hóa đơn bánh kẹo nhập khẩu - Đã quá hạn thanh toán 5 ngày',
        items: [
          {
            productId: 'prod-005',
            productSku: 'LH-CANDY-001',
            productName: 'Kẹo Dẻo Trái Cây Loha Gummy 150g',
            unit: 'Gói',
            quantity: 120,
            unitPrice: 50000,
            discountPercent: 0,
            lineTotal: 6000000,
          },
        ],
        paymentHistory: [],
        createdAt: new Date(now - 35 * 86400000),
        updatedAt: new Date(now - 35 * 86400000),
      },

      // 5. Hóa đơn của Đại lý khác (cust-002) để kiểm thử phân quyền Data Isolation R*
      {
        id: 'inv-005',
        invoiceCode: 'HD2609-005',
        orderId: 'ord-005',
        orderCode: 'DH2609-09899',
        customerId: 'cust-002',
        customerName: 'Đại lý Tạp hóa Hưng Yên',
        customerEmail: 'taphoa.hungyen@gmail.com',
        salesRepId: 'usr-sale-02',
        amount: 12000000,
        paidAmount: 5000000,
        remainingAmount: 7000000,
        status: 'PARTIALLY_PAID',
        issueDate: new Date(now - 15 * 86400000),
        dueDate: new Date(now + 15 * 86400000),
        note: 'Đơn hàng đại lý Hưng Yên (Tuyệt đối không hiển thị cho cust-001)',
        items: [
          {
            productId: 'prod-001',
            productSku: 'LH-MILK-900',
            productName: 'Sữa Bột Dinh Dưỡng Loha Gold 900g',
            unit: 'Lon',
            quantity: 25,
            unitPrice: 480000,
            discountPercent: 0,
            lineTotal: 12000000,
          },
        ],
        paymentHistory: [],
        createdAt: new Date(now - 15 * 86400000),
        updatedAt: new Date(now - 15 * 86400000),
      },
    ];

    for (const inv of seed) {
      this.invoices.set(inv.id, inv);
    }
  }

  /**
   * Helper phân giải mã đại lý mục tiêu cho người dùng hiện tại
   */
  resolveTargetCustomerId(currentUser?: ICurrentUser): string {
    if (!currentUser) return 'cust-001';
    if (
      currentUser.username === 'dealer' ||
      currentUser.email?.includes('dealer') ||
      currentUser.email?.includes('daily')
    ) {
      return 'cust-001';
    }
    return currentUser.userId;
  }

  /**
   * Phân quyền Data Scope (*) cho Module 7 (Hoá đơn & công nợ):
   * - Customer: R* (Chỉ thấy hoá đơn của chính mình)
   * - Sales Rep: R* (Chỉ thấy hoá đơn của tuyến mình)
   * - Accountant: F (Toàn quyền)
   * - Sales Manager: R
   * - Admin: F
   */
  async findAll(
    query?: {
      customerId?: string;
      status?: InvoiceItem['status'] | 'OVERDUE' | 'UNPAID';
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
    currentUser?: ICurrentUser,
  ): Promise<InvoiceItem[]> {
    let list = Array.from(this.invoices.values());

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
          list = list.filter((inv) => inv.customerId === targetCustId || inv.customerId === currentUser.userId);
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
      if (query.status === 'OVERDUE') {
        list = list.filter((inv) => inv.remainingAmount > 0 && new Date(inv.dueDate) < now);
      } else if (query.status === 'UNPAID') {
        list = list.filter((inv) => inv.paidAmount === 0 && inv.status !== 'PAID');
      } else {
        list = list.filter((inv) => inv.status === query.status);
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

    return list;
  }

  async findById(id: string, currentUser?: ICurrentUser): Promise<InvoiceItem> {
    const invoice = this.invoices.get(id);
    if (!invoice) {
      throw new NotFoundException(`Không tìm thấy hoá đơn ${id}`);
    }

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
          if (invoice.customerId !== targetCustId && invoice.customerId !== currentUser.userId) {
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
   */
  async getMyDebtSummary(currentUser: ICurrentUser): Promise<DealerDebtSummary> {
    const targetCustId = this.resolveTargetCustomerId(currentUser);
    const invoices = Array.from(this.invoices.values()).filter(
      (inv) => inv.customerId === targetCustId && inv.status !== 'CANCELLED',
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

    // Lấy thông tin hạn mức tín dụng từ CreditLimitService hoặc CustomersService
    let creditLimit = 100000000; // 100.000.000 đ mặc định
    let temporaryCreditLimit = 0;
    let maxDebtDays = 30;
    let paymentTerms = 'NET_30';
    let customerCode = 'DL-HCM-001';
    let customerName = 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang';

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
    } else if (this.customersService) {
      try {
        const cust = await this.customersService.getCustomerById(targetCustId);
        if (cust) {
          creditLimit = cust.creditLimit || creditLimit;
          maxDebtDays = cust.maxDebtDays || maxDebtDays;
          customerCode = cust.code || customerCode;
          customerName = cust.name || customerName;
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
   * Tự động trừ nợ, cập nhật hạn mức còn lại tức thì, không trừ trùng
   */
  async recordPayment(
    invoiceId: string,
    dto: { amount: number; paymentMethod?: string; note?: string },
    currentUser?: ICurrentUser,
  ): Promise<{ invoice: InvoiceItem; summary: DealerDebtSummary; message: string }> {
    const invoice = await this.findById(invoiceId, currentUser);
    const payAmount = Math.max(0, Number(dto.amount || 0));

    if (payAmount <= 0) {
      throw new Error('Số tiền thanh toán phải lớn hơn 0');
    }

    if (payAmount > invoice.remainingAmount) {
      throw new Error(
        `Số tiền thanh toán (${payAmount.toLocaleString('vi-VN')} đ) không được vượt quá số tiền còn nợ (${invoice.remainingAmount.toLocaleString('vi-VN')} đ)`,
      );
    }

    // Cập nhật hóa đơn
    invoice.paidAmount += payAmount;
    invoice.remainingAmount = Math.max(0, invoice.amount - invoice.paidAmount);
    invoice.status = invoice.remainingAmount === 0 ? 'PAID' : 'PARTIALLY_PAID';
    invoice.updatedAt = new Date();

    if (!invoice.paymentHistory) invoice.paymentHistory = [];
    invoice.paymentHistory.push({
      id: `pay-${Date.now()}`,
      paymentCode: `UNC-${Date.now().toString().slice(-6)}`,
      amount: payAmount,
      paymentDate: new Date(),
      paymentMethod: dto.paymentMethod || 'BANK_TRANSFER',
      note: dto.note || 'Thanh toán công nợ',
      recordedBy: currentUser?.username || 'Đại lý B2B',
    });

    this.invoices.set(invoice.id, invoice);

    // Đồng bộ sang CustomersService & CreditLimitService nếu có
    if (this.customersService) {
      try {
        const cust = await this.customersService.getCustomerById(invoice.customerId);
        if (cust) {
          cust.currentDebt = Math.max(0, cust.currentDebt - payAmount);
        }
      } catch {}
    }

    // Tính lại summary
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
   * Xuất tài liệu hóa đơn PDF / HTML chuẩn in ấn (SN-207 B)
   * Không tạo hóa đơn mới khi xem hoặc tải
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
          ${(invoice.items || [])
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
    return Array.from(this.invoices.values());
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
      customerId: dto.customerId || 'cust-001',
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
    this.invoices.set(id, invoice);
    return invoice;
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const invoice = await this.findById(id);
    this.invoices.delete(id);
    return { success: true, message: `Đã xóa hoá đơn ${invoice.invoiceCode}` };
  }
}
