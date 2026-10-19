import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoicesController } from '../src/modules/invoices/invoices.controller';
import { InvoicesService, InvoiceItem } from '../src/modules/invoices/invoices.service';
import { DebtReminderSchedulerService } from '../src/modules/invoices/debt-reminder-scheduler.service';
import { CustomersService } from '../src/modules/customers/customers.service';
import { CreditLimitService } from '../src/modules/credit-limit/credit-limit.service';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { DatabaseService } from '../src/database/database.service';
import { MailService } from '../src/modules/mail/mail.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';

describe('[SN-207 & SN-208] Quản lý Công nợ Đại lý & Nhắc hạn thanh toán tự động', () => {
  let invoicesController: InvoicesController;
  let invoicesService: InvoicesService;
  let debtSchedulerService: DebtReminderSchedulerService;
  let mockMailService: {
    sendDebtReminderEmail: jest.Mock;
    sendDebtOverdueEmail: jest.Mock;
  };

  const dealerCustomerId = '55555555-0000-0000-0000-000000000001';
  const otherCustomerId = '55555555-0000-0000-0000-000000000002';

  // Đại lý Minh Khang
  const mockDealerUser: ICurrentUser = {
    userId: '00000000-0000-0000-0000-000000000007',
    username: 'dealer',
    email: 'dealer@loha.vn',
    roles: [UserRole.CUSTOMER],
    customerId: 'cust-dl-0001',
    agencyId: 'cust-dl-0001',
  };

  // Đại lý An Bình (Khác)
  const mockOtherDealerUser: ICurrentUser = {
    userId: '00000000-0000-0000-0000-000000000017',
    username: 'daily',
    email: 'daily@loha.vn',
    roles: [UserRole.CUSTOMER],
    customerId: 'cust-dl-0002',
    agencyId: 'cust-dl-0002',
  };

  const mockCustomersService = {
    findById: jest.fn().mockImplementation((id: string) => {
      if (id === dealerCustomerId) {
        return Promise.resolve({
          id: dealerCustomerId,
          name: 'Đại Lý Cửa Hàng Minh Khang',
          code: 'DL-0001',
          creditLimit: 150000000,
          currentDebt: 23500000,
          maxDebtDays: 30,
        });
      }
      return Promise.resolve({
        id: otherCustomerId,
        name: 'Đại Lý Bán Buôn An Bình',
        code: 'DL-0002',
        creditLimit: 300000000,
        currentDebt: 7000000,
        maxDebtDays: 30,
      });
    }),
    findCustomerById: jest.fn().mockImplementation((id: string) => {
      if (id === dealerCustomerId) {
        return Promise.resolve({
          id: dealerCustomerId,
          name: 'Đại Lý Cửa Hàng Minh Khang',
          code: 'DL-0001',
          email: 'dealer@loha.vn',
        });
      }
      return Promise.resolve({
        id: otherCustomerId,
        name: 'Đại Lý Bán Buôn An Bình',
        code: 'DL-0002',
        email: 'daily@loha.vn',
      });
    }),
    updateDebt: jest.fn().mockResolvedValue(true),
  };

  const mockCreditLimitService = {
    getCustomerLimit: jest.fn().mockResolvedValue({
      creditLimit: 150000000,
      currentDebt: 23500000,
      availableCredit: 126500000,
      maxDebtDays: 30,
    }),
    recordDebtIncrease: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    mockMailService = {
      sendDebtReminderEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-reminder-01' }),
      sendDebtOverdueEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-overdue-01' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        InvoicesService,
        DebtReminderSchedulerService,
        { provide: MailService, useValue: mockMailService },
        { provide: CustomersService, useValue: mockCustomersService },
        { provide: CreditLimitService, useValue: mockCreditLimitService },
        { provide: ShipmentsService, useValue: { findById: jest.fn(), findAll: jest.fn() } },
        { provide: OrdersService, useValue: { findOrderById: jest.fn() } },
        { provide: ReceiptsService, useValue: { hasReceiptForReference: jest.fn().mockReturnValue(false), createReceiptFromInvoicePayment: jest.fn() } },
        { provide: DatabaseService, useValue: { isConnected: () => false, query: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    invoicesController = module.get<InvoicesController>(InvoicesController);
    invoicesService = module.get<InvoicesService>(InvoicesService);
    debtSchedulerService = module.get<DebtReminderSchedulerService>(DebtReminderSchedulerService);

    await invoicesService.onModuleInit();
    await debtSchedulerService.onModuleInit();
  });

  afterEach(() => {
    debtSchedulerService.onModuleDestroy();
  });

  // =========================================================================
  // PHẦN 1: SN-207 - XEM CÔNG NỢ & HẠN MỨC ĐẠI LÝ
  // =========================================================================
  describe('SN-207: Cổng thông tin công nợ & Hạn mức cho Đại lý (CUSTOMER)', () => {
    it('SN-207.A: Danh sách hoá đơn kèm số tiền, hạn thanh toán và phân loại 4 trạng thái', async () => {
      const invoices = (await invoicesController.findAll({}, mockDealerUser)) as InvoiceItem[];

      expect(Array.isArray(invoices)).toBe(true);
      expect(invoices.length).toBeGreaterThanOrEqual(4);

      // Kiểm tra đầy đủ 4 trạng thái
      const statuses = invoices.map((inv) => inv.status);
      expect(statuses).toContain('PAID');
      expect(statuses).toContain('PARTIALLY_PAID');
      expect(statuses).toContain('UNPAID');
      expect(statuses).toContain('OVERDUE');

      // Kiểm tra các trường dữ liệu bắt buộc
      const sample = invoices[0];
      expect(sample).toHaveProperty('id');
      expect(sample).toHaveProperty('invoiceCode');
      expect(sample).toHaveProperty('orderCode');
      expect(sample).toHaveProperty('amount');
      expect(sample).toHaveProperty('paidAmount');
      expect(sample).toHaveProperty('remainingAmount');
      expect(sample).toHaveProperty('issueDate');
      expect(sample).toHaveProperty('dueDate');
    });

    it('SN-207.A: Hỗ trợ lọc danh sách hóa đơn theo trạng thái (status filter)', async () => {
      const overdueInvoices = (await invoicesController.findAll(
        { status: 'OVERDUE' },
        mockDealerUser,
      )) as InvoiceItem[];

      expect(overdueInvoices.length).toBeGreaterThanOrEqual(1);
      overdueInvoices.forEach((inv) => {
        expect(inv.status).toBe('OVERDUE');
        expect(inv.remainingAmount).toBeGreaterThan(0);
      });

      const paidInvoices = (await invoicesController.findAll(
        { status: 'PAID' },
        mockDealerUser,
      )) as InvoiceItem[];

      expect(paidInvoices.length).toBeGreaterThanOrEqual(1);
      paidInvoices.forEach((inv) => {
        expect(inv.status).toBe('PAID');
        expect(inv.remainingAmount).toBe(0);
      });
    });

    it('SN-207.A: Đảm bảo cách ly dữ liệu giữa các Đại lý (Data Isolation)', async () => {
      const dealerList = (await invoicesController.findAll({}, mockDealerUser)) as InvoiceItem[];
      const otherList = (await invoicesController.findAll({}, mockOtherDealerUser)) as InvoiceItem[];

      // Đại lý Minh Khang không thấy hóa đơn của An Bình (HD2609-005)
      expect(dealerList.some((i) => i.invoiceCode === 'HD2609-005')).toBe(false);

      // Đại lý An Bình chỉ thấy hóa đơn của mình
      expect(otherList.some((i) => i.invoiceCode === 'HD2609-005')).toBe(true);
      expect(otherList.some((i) => i.invoiceCode === 'HD2610-003')).toBe(false);
    });

    it('SN-207.B: Chặn 403 Forbidden khi Đại lý cố xem/tải hóa đơn của Đại lý khác', async () => {
      // Hóa đơn HD2609-005 thuộc đại lý An Bình
      await expect(
        invoicesService.findById('88888888-0000-0000-0000-000000000005', mockDealerUser),
      ).rejects.toThrow(ForbiddenException);

      // Hóa đơn thuộc đại lý Minh Khang -> Xem bình thường
      const ownInvoice = await invoicesService.findById(
        '88888888-0000-0000-0000-000000000003',
        mockDealerUser,
      );
      expect(ownInvoice).toBeDefined();
      expect(ownInvoice.invoiceCode).toBe('HD2610-003');
    });

    it('SN-207.B: Xuất file PDF hoá đơn nhị phân chuẩn in ấn, font tiếng Việt Unicode', async () => {
      const pdfData = await invoicesService.generateInvoicePdfBuffer(
        '88888888-0000-0000-0000-000000000003',
        mockDealerUser,
      );

      expect(pdfData).toBeDefined();
      expect(Buffer.isBuffer(pdfData.buffer)).toBe(true);
      expect(pdfData.buffer.length).toBeGreaterThan(0);

      // Kiểm tra header định dạng file PDF '%PDF-'
      const magicBytes = pdfData.buffer.subarray(0, 5).toString('ascii');
      expect(magicBytes).toBe('%PDF-');
    });

    it('SN-207.C: Tổng hợp công nợ và hạn mức còn lại tính toán chính xác', async () => {
      const summary = await invoicesController.getMyDebtSummary(mockDealerUser);

      expect(summary).toBeDefined();
      expect(summary.currentDebt).toBeGreaterThan(0);
      expect(summary.availableCredit).toBe(summary.effectiveLimit - summary.currentDebt);
      expect(summary.unpaidInvoicesCount).toBeGreaterThanOrEqual(1);
      expect(summary.overdueInvoicesCount).toBeGreaterThanOrEqual(1);
    });

    it('SN-207.C: Ghi nhận thanh toán hóa đơn: Cập nhật dư nợ, trừ nợ đại lý tức thì', async () => {
      const invoiceId = '88888888-0000-0000-0000-000000000003'; // HD2610-003: 8.5M, còn nợ 8.5M
      const payAmount = 2500000;

      const result = await invoicesService.recordPayment(invoiceId, {
        amount: payAmount,
        paymentMethod: 'BANK_TRANSFER',
        note: 'Kiểm thử thanh toán công nợ SN-207',
      });

      expect(result.invoice.paidAmount).toBe(payAmount);
      expect(result.invoice.remainingAmount).toBe(8500000 - payAmount);
      expect(result.invoice.status).toBe('PARTIALLY_PAID');

      // Thanh toán nốt số tiền còn lại -> Hóa đơn chuyển thành PAID
      const finishResult = await invoicesService.recordPayment(invoiceId, {
        amount: 8500000 - payAmount,
        paymentMethod: 'BANK_TRANSFER',
      });

      expect(finishResult.invoice.remainingAmount).toBe(0);
      expect(finishResult.invoice.status).toBe('PAID');
    });
  });

  // =========================================================================
  // PHẦN 2: SN-208 - NHẮC HẠN THANH TOÁN TỰ ĐỘNG
  // =========================================================================
  describe('SN-208: Nhắc hạn thanh toán tự động & Cảnh báo nợ quá hạn', () => {
    it('SN-208.A: Quét hóa đơn còn đúng 3 ngày đến hạn -> Gửi email & tạo thông báo in-app', async () => {
      const res = await debtSchedulerService.processDebtReminders({ forceRetry: true });

      expect(res.upcomingRemindersSent).toBeGreaterThanOrEqual(1);
      expect(mockMailService.sendDebtReminderEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'dealer@loha.vn',
          invoiceCode: 'HD2610-003',
        }),
      );

      // Kiểm tra có thông báo in-app tương ứng
      const notifs = debtSchedulerService.getInAppNotificationsForCustomer(dealerCustomerId);
      const reminder3Days = notifs.find((n) => n.type === 'DEBT_REMINDER_3_DAYS');
      expect(reminder3Days).toBeDefined();
      expect(reminder3Days?.invoiceCode).toBe('HD2610-003');
    });

    it('SN-208.B: Quét hóa đơn quá hạn -> Gửi email cảnh báo & tạo thông báo in-app ưu tiên cao', async () => {
      const res = await debtSchedulerService.processDebtReminders({ forceRetry: true });

      expect(res.overdueRemindersSent).toBeGreaterThanOrEqual(1);
      expect(mockMailService.sendDebtOverdueEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'dealer@loha.vn',
          invoiceCode: 'HD2610-004',
          overdueDays: 5,
        }),
      );

      const notifs = debtSchedulerService.getInAppNotificationsForCustomer(dealerCustomerId);
      const overdueNotif = notifs.find((n) => n.type === 'DEBT_OVERDUE');
      expect(overdueNotif).toBeDefined();
      expect(overdueNotif?.priority).toBe('high');
      expect(overdueNotif?.invoiceCode).toBe('HD2610-004');
    });

    it('SN-208.A: Tự động loại trừ hóa đơn đã thanh toán đầy đủ (PAID), tuyệt đối không gửi nhắc nhầm', async () => {
      await debtSchedulerService.processDebtReminders({ forceRetry: true });

      // HD2609-002 là hóa đơn PAID -> Không có trong bất kỳ lần gửi nào
      expect(mockMailService.sendDebtReminderEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ invoiceCode: 'HD2609-002' }),
      );
      expect(mockMailService.sendDebtOverdueEmail).not.toHaveBeenCalledWith(
        expect.objectContaining({ invoiceCode: 'HD2609-002' }),
      );
    });

    it('SN-208.C: Cơ chế chống gửi trùng lặp thông báo/email trong cùng một ngày (Idempotency)', async () => {
      // Chạy lần 1 với forceRetry để sinh log ngày hôm nay
      await debtSchedulerService.processDebtReminders({ forceRetry: true });
      const firstEmailCount = mockMailService.sendDebtReminderEmail.mock.calls.length;

      // Chạy lần 2 (không force) -> Hệ thống phải nhận diện đã gửi hôm nay và BỎ QUA toàn bộ
      const secondRun = await debtSchedulerService.processDebtReminders();

      expect(secondRun.skippedAlreadySent).toBeGreaterThanOrEqual(2);
      expect(secondRun.upcomingRemindersSent).toBe(0);
      expect(secondRun.overdueRemindersSent).toBe(0);

      // Số lượng lệnh gửi email không tăng thêm
      expect(mockMailService.sendDebtReminderEmail.mock.calls.length).toBe(firstEmailCount);
    });

    it('SN-208.A: Đại lý bấm đọc thông báo -> Đánh dấu đã đọc thành công (isRead = true)', async () => {
      await debtSchedulerService.processDebtReminders({ forceRetry: true });
      const notifs = debtSchedulerService.getInAppNotificationsForCustomer(dealerCustomerId);
      expect(notifs.length).toBeGreaterThan(0);

      const targetNotif = notifs[0];
      const readResult = await invoicesController.markNotificationRead(targetNotif.id);

      expect(readResult.success).toBe(true);
      expect(targetNotif.isRead).toBe(true);
    });
  });
});
