import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { InvoicesService, InvoiceItem } from '../src/modules/invoices/invoices.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { CustomersService } from '../src/modules/customers/customers.service';
import { DatabaseService } from '../src/database/database.service';
import { PaymentMethod } from '../src/modules/receipts/entities/receipt.entity';

describe('PaymentsService (SN-202) - Ghi nhận thanh toán & Đối trừ công nợ', () => {
  let service: PaymentsService;
  let invoicesServiceMock: Partial<InvoicesService>;
  let receiptsServiceMock: Partial<ReceiptsService>;
  let customersServiceMock: Partial<CustomersService>;
  let dbServiceMock: Partial<DatabaseService>;

  const mockCustomer = {
    id: 'cust-001',
    code: 'DL-0001',
    name: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
    phone: '0901234567',
    address: 'Hà Nội',
  };

  const mockInvoices: InvoiceItem[] = [
    {
      id: 'inv-001',
      invoiceCode: 'HD2610-0001',
      orderId: 'ord-001',
      orderCode: 'DH-001',
      customerId: 'cust-001',
      customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
      amount: 10000000,
      paidAmount: 0,
      remainingAmount: 10000000,
      status: 'UNPAID',
      issueDate: new Date('2026-10-01T00:00:00Z'),
      dueDate: new Date('2026-10-31T00:00:00Z'),
      createdAt: new Date('2026-10-01T00:00:00Z'),
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    },
    {
      id: 'inv-002',
      invoiceCode: 'HD2610-0002',
      orderId: 'ord-002',
      orderCode: 'DH-002',
      customerId: 'cust-001',
      customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
      amount: 20000000,
      paidAmount: 5000000,
      remainingAmount: 15000000,
      status: 'PARTIALLY_PAID',
      issueDate: new Date('2026-10-10T00:00:00Z'),
      dueDate: new Date('2026-11-10T00:00:00Z'),
      createdAt: new Date('2026-10-10T00:00:00Z'),
      updatedAt: new Date('2026-10-10T00:00:00Z'),
    },
  ];

  beforeEach(async () => {
    // Clone invoices list to prevent test pollution
    const currentInvoices = JSON.parse(JSON.stringify(mockInvoices)).map((i: any) => ({
      ...i,
      issueDate: new Date(i.issueDate),
      dueDate: new Date(i.dueDate),
      createdAt: new Date(i.createdAt),
      updatedAt: new Date(i.updatedAt),
    }));

    invoicesServiceMock = {
      findUnpaidInvoicesForCustomer: jest.fn().mockImplementation(async () => {
        return currentInvoices.filter((inv: InvoiceItem) => inv.remainingAmount > 0);
      }),
      updateInvoiceStateInMemory: jest.fn().mockImplementation(async (updated: InvoiceItem) => {
        const target = currentInvoices.find((inv: InvoiceItem) => inv.id === updated.id);
        if (target) {
          Object.assign(target, updated);
        }
      }),
    };

    receiptsServiceMock = {
      createReceiptFromInvoicePayment: jest.fn().mockResolvedValue({
        id: 'rcpt-test-01',
        code: 'PT2610-0099',
      } as any),
    };

    customersServiceMock = {
      getCustomerById: jest.fn().mockResolvedValue(mockCustomer as any),
      filterCustomers: jest.fn().mockResolvedValue({ data: [mockCustomer] } as any),
    };

    dbServiceMock = {
      isConnected: jest.fn().mockReturnValue(false),
      query: jest.fn().mockResolvedValue({ rows: [] } as any),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: InvoicesService, useValue: invoicesServiceMock },
        { provide: ReceiptsService, useValue: receiptsServiceMock },
        { provide: CustomersService, useValue: customersServiceMock },
        { provide: DatabaseService, useValue: dbServiceMock },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('AC 1 & AC 4: Validation & Lưu trữ đủ thông tin thanh toán', () => {
    it('AC 4: Phải ném BadRequestException nếu số tiền thu vượt quá tổng công nợ còn lại của đại lý', async () => {
      // Tổng công nợ: 10,000,000 + 15,000,000 = 25,000,000
      await expect(
        service.createPayment(
          {
            customerId: 'cust-001',
            amount: 30000000, // Vượt 25tr
            paymentMethod: PaymentMethod.BANK_TRANSFER,
            paymentDate: '2026-10-18',
            collectorId: 'usr-acc-01',
            collectorName: 'Nguyễn Thị Mai',
            note: 'Thu vượt hạn mức',
          },
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('AC 1: Lưu trữ đủ amount, paymentMethod, paymentDate, collectorId/Name, note', async () => {
      const result = await service.createPayment(
        {
          customerId: 'cust-001',
          amount: 5000000,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          paymentDate: '2026-10-18',
          collectorId: 'usr-acc-01',
          collectorName: 'Nguyễn Thị Mai',
          note: 'Ủy nhiệm chi Vietcombank UNC-12345',
        },
        undefined,
      );

      expect(result).toBeDefined();
      expect(result.payment.amount).toBe(5000000);
      expect(result.payment.paymentMethod).toBe(PaymentMethod.BANK_TRANSFER);
      expect(result.payment.collectorId).toBe('usr-acc-01');
      expect(result.payment.collectorName).toBe('Nguyễn Thị Mai');
      expect(result.payment.note).toBe('Ủy nhiệm chi Vietcombank UNC-12345');
      expect(result.allocations.length).toBeGreaterThan(0);
    });
  });

  describe('AC 2: Tự động đối trừ hoá đơn cũ nhất trước (FIFO)', () => {
    it('Phải đối trừ vào hoá đơn cũ nhất inv-001 (ngày 01/10) trước khi đối trừ inv-002 (ngày 10/10)', async () => {
      // Thu 15,000,000: inv-001 (nợ 10tr) sẽ được trả hết 10tr; 5tr còn lại phân bổ sang inv-002 (nợ 15tr còn 10tr)
      const result = await service.createPayment(
        {
          customerId: 'cust-001',
          amount: 15000000,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          paymentDate: '2026-10-18',
        },
        undefined,
      );

      expect(result.allocations).toHaveLength(2);

      // Phân bổ 1: inv-001 được trừ trọn 10,000,000
      expect(result.allocations[0].invoiceId).toBe('inv-001');
      expect(result.allocations[0].amount).toBe(10000000);
      expect(result.allocations[0].newRemaining).toBe(0);

      // Phân bổ 2: inv-002 được trừ 5,000,000 còn lại
      expect(result.allocations[1].invoiceId).toBe('inv-002');
      expect(result.allocations[1].amount).toBe(5000000);
      expect(result.allocations[1].newRemaining).toBe(10000000);
    });

    it('Cho phép đối trừ vào hoá đơn cụ thể nếu được chỉ định (invoiceIds)', async () => {
      // Chỉ định thanh toán hóa đơn inv-002 (10,000,000 đ)
      const result = await service.createPayment(
        {
          customerId: 'cust-001',
          amount: 10000000,
          paymentMethod: PaymentMethod.CASH,
          invoiceIds: ['inv-002'],
        },
        undefined,
      );

      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].invoiceId).toBe('inv-002');
      expect(result.allocations[0].amount).toBe(10000000);
      expect(result.allocations[0].newRemaining).toBe(5000000);
    });
  });

  describe('AC 3: Trạng thái hoá đơn chuyển sang PARTIALLY_PAID hoặc PAID', () => {
    it('Hoá đơn thu một phần phải chuyển trạng thái sang PARTIALLY_PAID', async () => {
      // Thu 4,000,000 vào inv-001 (nợ 10tr) -> còn nợ 6tr -> status = PARTIALLY_PAID
      await service.createPayment(
        {
          customerId: 'cust-001',
          amount: 4000000,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          invoiceIds: ['inv-001'],
        },
        undefined,
      );

      expect(invoicesServiceMock.updateInvoiceStateInMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'inv-001',
          status: 'PARTIALLY_PAID',
          remainingAmount: 6000000,
          paidAmount: 4000000,
        }),
      );
    });

    it('Hoá đơn thu hết toàn bộ phải chuyển trạng thái sang PAID', async () => {
      // Thu 10,000,000 trọn vẹn vào inv-001 -> remaining = 0 -> status = PAID
      await service.createPayment(
        {
          customerId: 'cust-001',
          amount: 10000000,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          invoiceIds: ['inv-001'],
        },
        undefined,
      );

      expect(invoicesServiceMock.updateInvoiceStateInMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'inv-001',
          status: 'PAID',
          remainingAmount: 0,
          paidAmount: 10000000,
        }),
      );
    });
  });

  describe('AC 5: Chặn xóa phiếu thu đã ghi nhận (Không cho xóa, chỉ lập bút toán điều chỉnh)', () => {
    it('Gọi deletePayment phải ném ForbiddenException', async () => {
      await expect(service.deletePayment('pmt-001')).rejects.toThrow(ForbiddenException);
    });
  });
});
