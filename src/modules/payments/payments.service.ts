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
import * as path from 'path';
import { DatabaseService } from '../../database/database.service';
import { InvoicesService, InvoiceItem } from '../invoices/invoices.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { CustomersService } from '../customers/customers.service';
import { Payment } from './entities/payment.entity';
import { PaymentAllocation } from './entities/payment-allocation.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { PaymentMethod } from '../receipts/entities/receipt.entity';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

export interface PaginatedPaymentsResult {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly payments = new Map<string, Payment>();
  private readonly allocations = new Map<string, PaymentAllocation[]>();

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService: InvoicesService,
    @Optional()
    @Inject(forwardRef(() => ReceiptsService))
    private readonly receiptsService?: ReceiptsService,
    @Optional()
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService?: CustomersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePaymentTables();
    await this.seedInitialPayments();
  }

  /**
   * Khởi tạo bảng payments và payment_allocations trong PostgreSQL (SN-202)
   */
  async ensurePaymentTables(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;

    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id VARCHAR(64) PRIMARY KEY,
          code VARCHAR(64) UNIQUE NOT NULL,
          customer_id VARCHAR(64) NOT NULL,
          customer_code VARCHAR(64),
          customer_name VARCHAR(255) NOT NULL,
          amount NUMERIC(15, 2) NOT NULL,
          payment_method VARCHAR(32) NOT NULL,
          payment_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          collector_id VARCHAR(64) NOT NULL,
          collector_name VARCHAR(255),
          collector_username VARCHAR(100),
          note TEXT,
          receipt_id VARCHAR(64),
          receipt_code VARCHAR(64),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS payment_allocations (
          id VARCHAR(64) PRIMARY KEY,
          payment_id VARCHAR(64) NOT NULL,
          invoice_id VARCHAR(64) NOT NULL,
          invoice_code VARCHAR(64) NOT NULL,
          amount NUMERIC(15, 2) NOT NULL,
          previous_remaining NUMERIC(15, 2) NOT NULL,
          new_remaining NUMERIC(15, 2) NOT NULL,
          allocated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
        CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments(payment_date DESC);
        CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment_id ON payment_allocations(payment_id);
        CREATE INDEX IF NOT EXISTS idx_payment_allocations_invoice_id ON payment_allocations(invoice_id);
      `);
      this.logger.log('[PostgreSQL] Đã khởi tạo / đồng bộ bảng payments & payment_allocations thành công.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Lỗi tạo bảng payments/payment_allocations: ${msg}`);
    }
  }

  private getStorageFilePath(): string {
    const dataDir = path.join(process.cwd(), 'uploads', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'payments.json');
  }

  private savePaymentsToDisk(): void {
    try {
      const filePath = this.getStorageFilePath();
      const uniqueList = Array.from(new Set(this.payments.values()));
      fs.writeFileSync(filePath, JSON.stringify(uniqueList, null, 2), 'utf-8');
    } catch (err: unknown) {
      this.logger.warn(`[PaymentsService] Không thể lưu payments.json: ${(err as Error).message}`);
    }
  }

  private loadPaymentsFromDisk(): boolean {
    try {
      const filePath = this.getStorageFilePath();
      if (!fs.existsSync(filePath)) return false;
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const item of parsed) {
          const p = new Payment({
            ...item,
            paymentDate: new Date(item.paymentDate),
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
            allocations: (item.allocations || []).map(
              (a: any) =>
                new PaymentAllocation({
                  ...a,
                  allocatedAt: new Date(a.allocatedAt),
                }),
            ),
          });
          this.payments.set(p.id, p);
          this.payments.set(p.code, p);
          this.allocations.set(p.id, p.allocations);
        }
        return true;
      }
    } catch (err: unknown) {
      this.logger.warn(`[PaymentsService] Lỗi khi nạp payments.json: ${(err as Error).message}`);
    }
    return false;
  }

  /**
   * Sinh dữ liệu mẫu ban đầu cho payments
   */
  private async seedInitialPayments(): Promise<void> {
    const loaded = this.loadPaymentsFromDisk();
    if (loaded) return;

    const initialPayments: Payment[] = [
      new Payment({
        id: 'pmt-001',
        code: 'PAY2610-0001',
        customerId: '55555555-0000-0000-0000-000000000001',
        customerCode: 'DL-0001',
        customerName: 'Công Ty TNHH Thương Mại & Phân Phối Minh Khang',
        amount: 15000000,
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentDate: new Date('2026-10-15T09:30:00+07:00'),
        collectorId: 'usr-acc-01',
        collectorName: 'Nguyễn Thị Mai',
        collectorUsername: 'accountant_debt',
        note: 'Chuyển khoản Vietcombank đợt 1 cho hóa đơn HD2609-001',
        receiptId: 'rcpt-001',
        receiptCode: 'PT2610-0001',
        allocations: [
          new PaymentAllocation({
            id: 'alloc-001',
            paymentId: 'pmt-001',
            invoiceId: 'inv-001',
            invoiceCode: 'HD2609-001',
            amount: 15000000,
            previousRemaining: 25000000,
            newRemaining: 10000000,
            allocatedAt: new Date('2026-10-15T09:30:00+07:00'),
          }),
        ],
        createdAt: new Date('2026-10-15T09:30:00+07:00'),
        updatedAt: new Date('2026-10-15T09:30:00+07:00'),
      }),
    ];

    for (const p of initialPayments) {
      this.payments.set(p.id, p);
      this.payments.set(p.code, p);
      this.allocations.set(p.id, p.allocations);
    }
    this.savePaymentsToDisk();
  }

  /**
   * Tạo mã thanh toán tự tăng dạng PAYYYMM-XXXX
   */
  private generatePaymentCode(): string {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `PAY${yy}${mm}-`;

    let maxNum = 0;
    for (const p of this.payments.values()) {
      if (p.code && p.code.startsWith(prefix)) {
        const suffix = p.code.slice(prefix.length);
        const parsed = parseInt(suffix, 10);
        if (!isNaN(parsed) && parsed > maxNum) {
          maxNum = parsed;
        }
      }
    }

    return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
  }

  /**
   * Lấy danh sách các khoản thanh toán (Có tìm kiếm, phân quyền & phân trang)
   */
  async findAll(
    query?: QueryPaymentsDto,
    currentUser?: ICurrentUser,
  ): Promise<PaginatedPaymentsResult> {
    let list = Array.from(new Set(this.payments.values()));

    // 1. Phân quyền xem thanh toán
    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdminOrAccountant =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER') ||
        roles.includes(UserRole.ACCOUNTANT) ||
        roles.includes('ACCOUNTANT_DEBT');

      if (!isManagerOrAdminOrAccountant && roles.includes(UserRole.CUSTOMER)) {
        const email = (currentUser.email || '').toLowerCase().trim();
        const uname = (currentUser.username || '').toLowerCase().trim();
        let targetCustId = currentUser.customerId || currentUser.agencyId || currentUser.userId;
        if (uname === 'dealer' || email === 'dealer@loha.vn') {
          targetCustId = 'cust-001';
        } else if (uname === 'daily' || email === 'daily@loha.vn') {
          targetCustId = 'cust-002';
        }
        list = list.filter(
          (p) =>
            p.customerId === targetCustId ||
            (targetCustId === 'cust-001' &&
              (p.customerId === '55555555-0000-0000-0000-000000000001' || p.customerCode === 'DL-0001')) ||
            (targetCustId === 'cust-002' &&
              (p.customerId === '55555555-0000-0000-0000-000000000002' || p.customerCode === 'DL-0002')),
        );
      }
    }

    // 2. Lọc theo customerId
    if (query?.customerId) {
      list = list.filter((p) => p.customerId === query.customerId || p.customerCode === query.customerId);
    }

    // 3. Lọc theo paymentMethod
    if (query?.paymentMethod && query.paymentMethod !== 'ALL') {
      const method = query.paymentMethod.toUpperCase().trim();
      list = list.filter((p) => p.paymentMethod === method);
    }

    // 4. Tìm kiếm từ khóa
    if (query?.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.code.toLowerCase().includes(q) ||
          p.customerName.toLowerCase().includes(q) ||
          p.customerCode.toLowerCase().includes(q) ||
          (p.collectorName && p.collectorName.toLowerCase().includes(q)) ||
          (p.note && p.note.toLowerCase().includes(q)),
      );
    }

    // 5. Sắp xếp mới nhất trước
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // 6. Phân trang
    const total = list.length;
    const pageNum = Math.max(1, parseInt(query?.page || '1', 10) || 1);
    const limitNum = Math.max(1, parseInt(query?.limit || '10', 10) || 10);
    const totalPages = Math.max(1, Math.ceil(total / limitNum));
    const offset = (pageNum - 1) * limitNum;
    const data = list.slice(offset, offset + limitNum);

    return {
      data,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
    };
  }

  /**
   * Xem chi tiết một khoản thanh toán kèm danh sách hóa đơn đối trừ
   */
  async findById(idOrCode: string): Promise<Payment> {
    const payment = this.payments.get(idOrCode);
    if (!payment) {
      throw new NotFoundException(`Không tìm thấy chứng từ thanh toán: ${idOrCode}`);
    }

    const allocs = this.allocations.get(payment.id) || payment.allocations || [];
    return new Payment({
      ...payment,
      allocations: allocs,
    });
  }

  /**
   * LOGIC CỐT LÕI (SN-202): Ghi nhận thanh toán và đối trừ vào công nợ đại lý
   * 
   * Quy chuẩn AC:
   * 1. Ghi số tiền, hình thức thu, ngày thu, người thu, ghi chú.
   * 2. Chọn đối trừ vào hoá đơn cụ thể, hoặc tự động đối trừ theo nguyên tắc hoá đơn cũ nhất trước (FIFO).
   * 3. Cho phép thu một phần; hoá đơn chuyển sang "Thanh toán một phần" (PARTIALLY_PAID).
   * 4. Không cho thu vượt tổng công nợ còn lại (Ném BadRequestException).
   * 5. Đã ghi nhận thì không xoá, chỉ lập bút toán điều chỉnh (Chặn DELETE).
   */
  async createPayment(dto: CreatePaymentDto, currentUser?: ICurrentUser): Promise<{
    payment: Payment;
    allocations: PaymentAllocation[];
    updatedInvoices: InvoiceItem[];
    message: string;
  }> {
    const payAmount = Number(dto.amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      throw new BadRequestException('Số tiền thanh toán phải lớn hơn 0 đ.');
    }

    // 1. Xác định thông tin đại lý
    let customerName = dto.customerName || 'Đại lý B2B';
    let customerCode = dto.customerCode || dto.customerId;
    let customerPhone = '0988 123 456';
    let customerAddress = 'Việt Nam';

    if (this.customersService) {
      try {
        const cust = await this.customersService.getCustomerById(dto.customerId);
        if (cust) {
          customerName = cust.name || customerName;
          customerCode = cust.code || customerCode;
          customerPhone = cust.phone || customerPhone;
          customerAddress = cust.address || customerAddress;
        }
      } catch {
        // Fallback: Tìm qua danh sách khách hàng nếu không tìm thấy bằng id
        try {
          const listRes = await this.customersService.filterCustomers({ limit: 100 });
          const allCusts = Array.isArray(listRes) ? listRes : listRes.data || [];
          const found = allCusts.find((c: { id?: string; code?: string; name: string; phone?: string; address?: string }) => c.id === dto.customerId || c.code === dto.customerId);
          if (found) {
            customerName = found.name;
            customerCode = found.code;
            customerPhone = found.phone || customerPhone;
            customerAddress = found.address || customerAddress;
          }
        } catch {
          // Bỏ qua lỗi tìm kiếm đại lý
        }
      }
    }

    // Chuẩn hóa mã đại lý nếu đang chứa chuỗi UUID mã hóa thô
    if (!customerCode || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerCode)) {
      if (dto.customerId === '55555555-0000-0000-0000-000000000002' || customerName.includes('An Bình')) {
        customerCode = 'DL-0002';
        customerName = customerName === 'Đại lý B2B' ? 'Đại Lý Bán Buôn An Bình' : customerName;
      } else if (dto.customerId === '55555555-0000-0000-0000-000000000001' || customerName.includes('Minh Khang')) {
        customerCode = 'DL-0001';
        customerName = customerName === 'Đại lý B2B' ? 'Công Ty TNHH Thương Mại & Phân Phối Minh Khang' : customerName;
      }
    }

    // 2. Lấy danh sách các hóa đơn còn nợ của đại lý này
    const allInvoices = await this.invoicesService.findUnpaidInvoicesForCustomer(dto.customerId);
    const totalRemainingDebt = allInvoices.reduce((sum, inv) => sum + Number(inv.remainingAmount || 0), 0);

    // AC 4: KHÔNG CHO THU VƯỢT TỔNG CÔNG NỢ CÒN LẠI
    if (payAmount > totalRemainingDebt) {
      throw new BadRequestException(
        `Số tiền thu (${payAmount.toLocaleString('vi-VN')} đ) vượt quá tổng công nợ còn lại của đại lý (${totalRemainingDebt.toLocaleString('vi-VN')} đ). Vui lòng điều chỉnh số tiền không vượt quá số nợ thực tế.`,
      );
    }

    if (allInvoices.length === 0 || totalRemainingDebt <= 0) {
      throw new BadRequestException('Đại lý hiện không có hóa đơn nào còn nợ để đối trừ.');
    }

    // AC 2: CHỌN ĐỐI TRỪ CỤ THỂ HOẶC TỰ ĐỘNG THEO HÓA ĐƠN CŨ NHẤT TRƯỚC
    let invoicesToOffset: InvoiceItem[] = [];

    const isSpecificSelected =
      Array.isArray(dto.invoiceIds) &&
      dto.invoiceIds.length > 0 &&
      dto.autoOffsetOldest !== true;

    if (isSpecificSelected) {
      // Ưu tiên đối trừ vào các hóa đơn cụ thể được chọn
      const selectedIdSet = new Set(dto.invoiceIds);
      invoicesToOffset = allInvoices.filter(
        (inv) => selectedIdSet.has(inv.id) || selectedIdSet.has(inv.invoiceCode),
      );

      if (invoicesToOffset.length === 0) {
        throw new BadRequestException('Không tìm thấy hóa đơn hợp lệ còn dư nợ trong danh sách đã chọn.');
      }

      const totalSelectedDebt = invoicesToOffset.reduce((sum, inv) => sum + Number(inv.remainingAmount || 0), 0);
      if (payAmount > totalSelectedDebt) {
        throw new BadRequestException(
          `Số tiền thu (${payAmount.toLocaleString('vi-VN')} đ) vượt quá tổng số nợ của các hóa đơn đã chọn (${totalSelectedDebt.toLocaleString('vi-VN')} đ).`,
        );
      }
    } else {
      // Tự động đối trừ theo nguyên tắc hóa đơn cũ nhất trước (ORDER BY created_at ASC / issue_date ASC)
      invoicesToOffset = [...allInvoices].sort((a, b) => {
        const timeA = new Date(a.issueDate || a.createdAt).getTime();
        const timeB = new Date(b.issueDate || b.createdAt).getTime();
        return timeA - timeB;
      });
    }

    // 3. Khởi tạo bản ghi Payment & chuẩn bị dữ liệu phân bổ
    const paymentId = `pmt-${Date.now()}`;
    const paymentCode = this.generatePaymentCode();
    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    const collectorId = dto.collectorId || currentUser?.userId || 'usr-acc-01';
    const collectorName = dto.collectorName || currentUser?.username || 'Kế toán công nợ';
    const collectorUsername = currentUser?.username || 'accountant_debt';

    let unallocatedAmount = payAmount;
    const allocations: PaymentAllocation[] = [];
    const updatedInvoices: InvoiceItem[] = [];

    // AC 2 & 3: VÒNG LẶP ĐỐI TRỪ TRỪ DẦN TIỀN VÀO TỪNG HÓA ĐƠN
    for (const inv of invoicesToOffset) {
      if (unallocatedAmount <= 0) break;
      if (inv.remainingAmount <= 0) continue;

      const deductAmount = Math.min(unallocatedAmount, inv.remainingAmount);
      unallocatedAmount -= deductAmount;

      const prevRemaining = inv.remainingAmount;
      const newRemaining = Math.max(0, inv.remainingAmount - deductAmount);
      const newPaid = inv.paidAmount + deductAmount;

      // Cập nhật trạng thái hóa đơn: Về 0 -> PAID, > 0 -> PARTIALLY_PAID
      const newStatus = newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID';

      inv.paidAmount = newPaid;
      inv.remainingAmount = newRemaining;
      inv.status = newStatus;
      inv.updatedAt = new Date();

      const alloc = new PaymentAllocation({
        id: `alloc-${Date.now()}-${allocations.length + 1}`,
        paymentId,
        invoiceId: inv.id,
        invoiceCode: inv.invoiceCode,
        amount: deductAmount,
        previousRemaining: prevRemaining,
        newRemaining,
        allocatedAt: paymentDate,
      });

      allocations.push(alloc);
      updatedInvoices.push(inv);
    }

    // 4. THỰC THI ACID TRANSACTION TRONG POSTGRESQL (Nếu khả dụng)
    if (this.databaseService?.isConnected()) {
      let client;
      try {
        client = await this.databaseService.getClient();
        await client.query('BEGIN');

        // A. Lưu bản ghi vào bảng payments
        await client.query(
          `INSERT INTO payments (
            id, code, customer_id, customer_code, customer_name,
            amount, payment_method, payment_date, collector_id,
            collector_name, collector_username, note, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
          [
            paymentId,
            paymentCode,
            dto.customerId,
            customerCode,
            customerName,
            payAmount,
            dto.paymentMethod,
            paymentDate,
            collectorId,
            collectorName,
            collectorUsername,
            dto.note || null,
          ],
        );

        // B. Lưu các bản ghi phân bổ vào bảng payment_allocations & cập nhật trạng thái hóa đơn
        for (const alloc of allocations) {
          await client.query(
            `INSERT INTO payment_allocations (
              id, payment_id, invoice_id, invoice_code, amount,
              previous_remaining, new_remaining, allocated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              alloc.id,
              alloc.paymentId,
              alloc.invoiceId,
              alloc.invoiceCode,
              alloc.amount,
              alloc.previousRemaining,
              alloc.newRemaining,
              alloc.allocatedAt,
            ],
          );

          // Cập nhật hóa đơn trong PostgreSQL
          await client.query(
            `UPDATE invoices
             SET paid_amount = $1,
                 remaining_amount = $2,
                 payment_status = $3,
                 updated_at = NOW()
             WHERE id = $4 OR code = $5`,
            [
              alloc.newRemaining === 0 ? alloc.amount + alloc.previousRemaining : alloc.amount,
              alloc.newRemaining,
              alloc.newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID',
              alloc.invoiceId,
              alloc.invoiceCode,
            ],
          );
        }

        // C. Ghi nhận vào Sổ cái công nợ khách hàng (customer_debt_ledger)
        await client.query(
          `INSERT INTO customer_debt_ledger (
            customer_id, transaction_type, reference_type, reference_id,
            debit_amount, credit_amount, balance_after, aging_bucket, notes, created_at
          ) VALUES ($1, 'PAYMENT_RECEIVED', 'PAYMENT', $2, 0, $3, $4, 'CURRENT', $5, NOW())`,
          [
            dto.customerId,
            paymentCode,
            payAmount,
            Math.max(0, totalRemainingDebt - payAmount),
            dto.note || `Ghi nhận thanh toán và đối trừ công nợ theo phiếu ${paymentCode}`,
          ],
        );

        await client.query('COMMIT');
        this.logger.log(`[PostgreSQL] Transaction thanh toán & đối trừ ${paymentCode} thành công.`);
      } catch (dbErr: unknown) {
        if (client) {
          await client.query('ROLLBACK').catch(() => {});
        }
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        this.logger.warn(`[PostgreSQL] Lỗi Transaction thanh toán: ${msg}. Đang fallback lưu bộ nhớ.`);
      } finally {
        if (client) {
          client.release();
        }
      }
    }

    // 5. Đồng bộ vào bộ nhớ Cache & Cập nhật InvoicesService
    for (const inv of updatedInvoices) {
      await this.invoicesService.updateInvoiceStateInMemory(inv);
    }

    // 6. Tự động sinh Phiếu thu tiền tương ứng trong ReceiptsService
    let receiptId: string | undefined;
    let receiptCode: string | undefined;
    if (this.receiptsService) {
      try {
        const primaryRef =
          allocations.length === 1 ? allocations[0].invoiceCode : `${paymentCode} (${allocations.length} HĐ)`;

        const createdReceipt = await this.receiptsService.createReceiptFromInvoicePayment({
          invoiceId: allocations.length === 1 ? allocations[0].invoiceId : paymentId,
          invoiceCode: primaryRef,
          customerId: dto.customerId,
          customerCode,
          customerName,
          customerPhone,
          customerAddress,
          amount: payAmount,
          paymentMethod: dto.paymentMethod,
          note: dto.note || `Thanh toán đối trừ công nợ phiếu ${paymentCode}`,
          collectorId,
          collectorName,
          collectorUsername,
        });

        if (createdReceipt) {
          receiptId = createdReceipt.id;
          receiptCode = createdReceipt.code;
        }
      } catch (rcptErr: unknown) {
        this.logger.warn(`[PaymentsService] Lỗi tạo phiếu thu liên kết: ${(rcptErr as Error).message}`);
      }
    }

    // 7. Lưu Payment vào Map bộ nhớ
    const payment = new Payment({
      id: paymentId,
      code: paymentCode,
      customerId: dto.customerId,
      customerCode,
      customerName,
      amount: payAmount,
      paymentMethod: dto.paymentMethod,
      paymentDate,
      collectorId,
      collectorName,
      collectorUsername,
      note: dto.note,
      receiptId,
      receiptCode,
      allocations,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.payments.set(payment.id, payment);
    this.payments.set(payment.code, payment);
    this.allocations.set(payment.id, allocations);
    this.savePaymentsToDisk();

    const invoiceCodesStr = allocations.map((a) => a.invoiceCode).join(', ');
    const message = `Đã ghi nhận thanh toán ${payAmount.toLocaleString('vi-VN')} đ cho đại lý ${customerName} và đối trừ thành công vào ${allocations.length} hóa đơn (${invoiceCodesStr}).`;

    return {
      payment,
      allocations,
      updatedInvoices,
      message,
    };
  }

  /**
   * AC 5: Chặn xóa bút toán thanh toán đã ghi nhận
   */
  async deletePayment(_id?: string): Promise<never> {
    throw new ForbiddenException(
      'Theo quy chuẩn kế toán công nợ (AC 5), bút toán thanh toán đã ghi nhận KHÔNG ĐƯỢC PHÉP XOÁ. Mọi điều chỉnh bắt buộc phải lập bút toán điều chỉnh.',
    );
  }
}
