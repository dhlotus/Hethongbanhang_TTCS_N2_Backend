import { Test, TestingModule } from '@nestjs/testing';
import { MethodNotAllowedException, BadRequestException } from '@nestjs/common';
import { InvoicesService, InvoiceItem } from '../src/modules/invoices/invoices.service';
import { InvoicesController } from '../src/modules/invoices/invoices.controller';
import { CustomersService } from '../src/modules/customers/customers.service';
import { CreditLimitService } from '../src/modules/credit-limit/credit-limit.service';
import { ShipmentsService, ShipmentItem } from '../src/modules/shipments/shipments.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { DatabaseService } from '../src/database/database.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';
import { IssueInvoiceDto } from '../src/modules/invoices/dto/issue-invoice.dto';

import { DebtReminderSchedulerService } from '../src/modules/invoices/debt-reminder-scheduler.service';

describe('[SN-200] Nghiệp vụ Phát hành Hoá đơn từ Phiếu Thực Giao (Kế toán Công Nợ)', () => {
  let invoicesService: InvoicesService;
  let invoicesController: InvoicesController;

  const mockCurrentUser: ICurrentUser = {
    userId: 'user-accountant-01',
    username: 'ketoan01',
    email: 'ketoan@company.com',
    roles: [UserRole.ACCOUNTANT],
  };

  const mockShipment1: ShipmentItem = {
    id: 'shp-001',
    orderId: 'ord-001',
    orderCode: 'DH-0001',
    customerId: 'cust-001',
    customerName: 'Đại lý Kim Cương',
    status: 'DELIVERED',
    trackingNumber: 'PGH-001',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockShipment2: ShipmentItem = {
    id: 'shp-002',
    orderId: 'ord-002',
    orderCode: 'DH-0002',
    customerId: 'cust-001',
    customerName: 'Đại lý Kim Cương',
    status: 'DELIVERED',
    trackingNumber: 'PGH-002',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockShipmentOtherCustomer: ShipmentItem = {
    id: 'shp-003',
    orderId: 'ord-003',
    orderCode: 'DH-0003',
    customerId: 'cust-999',
    customerName: 'Đại lý Khác',
    status: 'DELIVERED',
    trackingNumber: 'PGH-003',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockOrder1 = {
    id: 'ord-001',
    orderCode: 'DH-0001',
    customerId: 'cust-001',
    lines: [
      {
        productId: 'prod-01',
        productSku: 'MILK-01',
        productName: 'Sữa Tươi Tiệt Trùng',
        unit: 'Thùng',
        quantity: 100, // Đặt 100 thùng
        deliveredQuantity: 80, // Thực giao chỉ 80 thùng
        unitPrice: 200000,
        discountPercent: 10,
        subtotal: 18000000,
      },
    ],
  };

  const mockOrder2 = {
    id: 'ord-002',
    orderCode: 'DH-0002',
    customerId: 'cust-001',
    lines: [
      {
        productId: 'prod-02',
        productSku: 'COCA-01',
        productName: 'Nước Ngọt Lon',
        unit: 'Thùng',
        quantity: 50, // Đặt 50 thùng
        deliveredQuantity: 40, // Thực giao 40 thùng
        unitPrice: 150000,
        discountPercent: 0,
        subtotal: 6000000,
      },
    ],
  };

  const mockShipmentsService = {
    findById: jest.fn().mockImplementation((id: string) => {
      if (id === 'shp-001') return Promise.resolve(mockShipment1);
      if (id === 'shp-002') return Promise.resolve(mockShipment2);
      if (id === 'shp-003') return Promise.resolve(mockShipmentOtherCustomer);
      return Promise.resolve(null);
    }),
    findAll: jest.fn().mockResolvedValue([mockShipment1, mockShipment2]),
    updateShipmentInvoice: jest.fn().mockResolvedValue(true),
  };

  const mockOrdersService = {
    findOrderById: jest.fn().mockImplementation((id: string) => {
      if (id === 'ord-001' || id === 'DH-0001') return Promise.resolve(mockOrder1);
      if (id === 'ord-002' || id === 'DH-0002') return Promise.resolve(mockOrder2);
      return Promise.reject(new Error('Order not found'));
    }),
  };

  const mockCustomersService = {
    findById: jest.fn().mockResolvedValue({
      id: 'cust-001',
      name: 'Đại lý Kim Cương',
      code: 'DL-001',
    }),
    findCustomerById: jest.fn().mockResolvedValue({
      id: 'cust-001',
      name: 'Đại lý Kim Cương',
      code: 'DL-001',
    }),
    updateDebt: jest.fn().mockResolvedValue(true),
  };

  const mockCreditLimitService = {
    recordDebtIncrease: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    delete mockShipment1.invoiceId;
    delete mockShipment1.invoiceCode;
    delete mockShipment2.invoiceId;
    delete mockShipment2.invoiceCode;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvoicesController],
      providers: [
        InvoicesService,
        { provide: ShipmentsService, useValue: mockShipmentsService },
        { provide: OrdersService, useValue: mockOrdersService },
        { provide: CustomersService, useValue: mockCustomersService },
        { provide: CreditLimitService, useValue: mockCreditLimitService },
        { provide: DatabaseService, useValue: { isConnected: () => false } },
        { provide: DebtReminderSchedulerService, useValue: { sendManualReminder: jest.fn() } },
      ],
    }).compile();

    invoicesService = module.get<InvoicesService>(InvoicesService);
    invoicesController = module.get<InvoicesController>(InvoicesController);
  });

  describe('Ràng buộc 1 & 3: Tính theo số lượng thực giao và gộp nhiều phiếu giao cùng đại lý', () => {
    it('Hoá đơn phải tính tiền dựa trên số lượng THỰC GIAO, bỏ qua số lượng đặt ban đầu', async () => {
      const dto: IssueInvoiceDto = {
        deliverySlipIds: ['shp-001'],
      };

      const invoice: InvoiceItem = await invoicesService.issueInvoiceFromDeliveries(dto, mockCurrentUser);

      expect(invoice).toBeDefined();
      expect(invoice.customerId).toBe('cust-001');
      // Đặt 100, thực giao 80. Đơn giá 200,000, giảm 10% = 180,000/thùng
      // Tổng tiền = 80 * 180,000 = 14,400,000 VND (thay vì 100 * 180,000 = 18,000,000 VND)
      expect(invoice.amount).toBe(14400000);
      expect(invoice.items?.[0]?.quantity).toBe(80);
      expect(invoice.items?.[0]?.orderedQuantity).toBe(100);
      expect(invoice.items?.[0]?.lineTotal).toBe(14400000);
    });

    it('Gộp được 2 phiếu giao hàng của cùng một đại lý vào một hoá đơn duy nhất', async () => {
      const dto: IssueInvoiceDto = {
        deliverySlipIds: ['shp-001', 'shp-002'],
      };

      const invoice: InvoiceItem = await invoicesService.issueInvoiceFromDeliveries(dto, mockCurrentUser);

      expect(invoice).toBeDefined();
      expect(invoice.deliverySlipIds).toEqual(['shp-001', 'shp-002']);
      // Phiếu 1: 80 * 180,000 = 14,400,000
      // Phiếu 2: 40 * 150,000 = 6,000,000
      // Tổng cộng: 20,400,000
      expect(invoice.amount).toBe(20400000);
      expect(invoice.items?.length).toBe(2);
    });

    it('Từ chối phát hành hoá đơn nếu các phiếu giao thuộc hai đại lý khác nhau', async () => {
      const dto: IssueInvoiceDto = {
        deliverySlipIds: ['shp-001', 'shp-003'],
      };

      await expect(
        invoicesService.issueInvoiceFromDeliveries(dto, mockCurrentUser),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Ràng buộc 2: Số hoá đơn tự sinh theo dãy liên tục, không trùng và không nhảy cóc', () => {
    it('Tạo nhiều hoá đơn liên tiếp sinh dãy số tăng tuần tự không nhảy cóc', async () => {
      const seq1 = await invoicesService.getNextInvoiceSequence('HD-TEST-');
      const seq2 = await invoicesService.getNextInvoiceSequence('HD-TEST-');
      const seq3 = await invoicesService.getNextInvoiceSequence('HD-TEST-');

      expect(seq1).toBe('HD-TEST-0001');
      expect(seq2).toBe('HD-TEST-0002');
      expect(seq3).toBe('HD-TEST-0003');
    });
  });

  describe('Ràng buộc 4: Hoá đơn đã phát hành KHÔNG SỬA VÀ KHÔNG XOÁ', () => {
    it('Chặn hoàn toàn thao tác sửa PUT /api/invoices/:id', async () => {
      await expect(invoicesController.updatePut()).rejects.toThrow(
        MethodNotAllowedException,
      );
    });

    it('Chặn hoàn toàn thao tác sửa PATCH /api/invoices/:id', async () => {
      await expect(invoicesController.update()).rejects.toThrow(
        MethodNotAllowedException,
      );
    });

    it('Chặn hoàn toàn thao tác xóa DELETE /api/invoices/:id', async () => {
      await expect(invoicesController.remove()).rejects.toThrow(
        MethodNotAllowedException,
      );
    });
  });

  describe('Ràng buộc 5: In và Xuất PDF hoá đơn', () => {
    it('Cung cấp nội dung xem trước để in hoá đơn (HTML Print View)', async () => {
      const dto: IssueInvoiceDto = {
        deliverySlipIds: ['shp-001'],
      };
      const invoice: InvoiceItem = await invoicesService.issueInvoiceFromDeliveries(dto, mockCurrentUser);

      const printResult = await invoicesService.generateInvoicePdfHtml(invoice.id, mockCurrentUser);
      expect(printResult.html).toContain('HÓA ĐƠN BÁN HÀNG');
      expect(printResult.html).toContain(invoice.invoiceCode);
      expect(printResult.html).toContain('SL Thực Giao');
      expect(printResult.html).toContain('window.print()');
    });
  });
});
