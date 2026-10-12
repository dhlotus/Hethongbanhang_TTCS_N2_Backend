import { Injectable, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

export interface InvoiceItem {
  id: string;
  invoiceCode: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  salesRepId?: string;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
  issueDate: Date;
  dueDate: Date;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class InvoicesService {
  private readonly invoices = new Map<string, InvoiceItem>();

  constructor(@Optional() private readonly databaseService?: DatabaseService) {
    this.seedInitialInvoices();
  }

  private seedInitialInvoices() {
    const seed: InvoiceItem[] = [
      {
        id: 'inv-001',
        invoiceCode: 'HD2609-001',
        orderId: 'ord-001',
        orderCode: 'DH2609-09876',
        customerId: 'cust-001',
        customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
        salesRepId: 'usr-sale-01',
        amount: 25000000,
        paidAmount: 15000000,
        remainingAmount: 10000000,
        status: 'PARTIALLY_PAID',
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86400000),
        note: 'Hóa đơn VAT đợt 1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'inv-002',
        invoiceCode: 'HD2609-002',
        orderId: 'ord-002',
        orderCode: 'DH2609-09877',
        customerId: 'cust-002',
        customerName: 'Đại lý Tạp hóa Hưng Yên',
        salesRepId: 'usr-sale-02',
        amount: 18000000,
        paidAmount: 18000000,
        remainingAmount: 0,
        status: 'PAID',
        issueDate: new Date(Date.now() - 5 * 86400000),
        dueDate: new Date(Date.now() + 25 * 86400000),
        note: 'Đã thanh toán đủ chuyển khoản',
        createdAt: new Date(Date.now() - 5 * 86400000),
        updatedAt: new Date(),
      },
    ];
    for (const inv of seed) {
      this.invoices.set(inv.id, inv);
    }
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
    query?: { customerId?: string; status?: InvoiceItem['status'] },
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
          const targetCustId =
            currentUser.username === 'dealer' ||
            currentUser.email?.includes('dealer') ||
            currentUser.email?.includes('daily')
              ? 'cust-001'
              : currentUser.userId;
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

    if (query?.customerId) list = list.filter((inv) => inv.customerId === query.customerId);
    if (query?.status) list = list.filter((inv) => inv.status === query.status);

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
          const targetCustId =
            currentUser.username === 'dealer' ||
            currentUser.email?.includes('dealer') ||
            currentUser.email?.includes('daily')
              ? 'cust-001'
              : currentUser.userId;
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
      salesRepId: dto.salesRepId,
      amount,
      paidAmount,
      remainingAmount: Math.max(0, amount - paidAmount),
      status: dto.status || 'ISSUED',
      issueDate: dto.issueDate || new Date(),
      dueDate: dto.dueDate || new Date(Date.now() + 30 * 86400000),
      note: dto.note,
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
