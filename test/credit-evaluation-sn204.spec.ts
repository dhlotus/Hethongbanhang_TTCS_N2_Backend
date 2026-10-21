import { BadRequestException } from '@nestjs/common';
import { CreditEvaluationService } from '../src/modules/credit-limit/credit-evaluation.service';
import {
  AgencyCreditFlag,
  CreditEnforcementMode,
} from '../src/modules/credit-limit/dto/credit-config.dto';
import { CustomerEntity, CustomerStatus } from '../src/modules/customers/entities/customer.entity';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';

describe('[SN-204] Cảnh báo và khóa bán khi đại lý vượt hạn mức hoặc quá hạn công nợ', () => {
  let creditEvaluationService: CreditEvaluationService;

  // Mock CustomersService
  const mockCustomerSafe: CustomerEntity = new CustomerEntity({
    id: 'cust-safe-01',
    code: 'DL-SAFE-001',
    name: 'Đại lý An Toàn',
    creditLimit: 100000000,
    currentDebt: 30000000,
    maxDebtDays: 30,
    overdueAmount: 0,
    overdueDays: 0,
    status: CustomerStatus.ACTIVE,
  });

  const mockCustomerExceeded: CustomerEntity = new CustomerEntity({
    id: 'cust-exceeded-01',
    code: 'DL-EXCEED-001',
    name: 'Đại lý Vượt Hạn Mức',
    creditLimit: 50000000,
    currentDebt: 80000000, // Vượt 30tr
    maxDebtDays: 30,
    overdueAmount: 0,
    overdueDays: 0,
    status: CustomerStatus.ACTIVE,
  });

  const mockCustomerOverdue: CustomerEntity = new CustomerEntity({
    id: 'cust-overdue-01',
    code: 'DL-OVERDUE-001',
    name: 'Đại lý Nợ Quá Hạn',
    creditLimit: 100000000,
    currentDebt: 40000000,
    maxDebtDays: 30,
    overdueAmount: 40000000,
    overdueDays: 15, // Quá hạn 15 ngày
    status: CustomerStatus.ACTIVE,
  });

  const mockCustomerBoth: CustomerEntity = new CustomerEntity({
    id: 'cust-both-01',
    code: 'DL-BOTH-001',
    name: 'Đại lý Vừa Vượt Hạn Mức Vừa Quá Hạn',
    creditLimit: 50000000,
    currentDebt: 90000000,
    maxDebtDays: 30,
    overdueAmount: 45000000,
    overdueDays: 20,
    status: CustomerStatus.ACTIVE,
  });

  const customersMap = new Map<string, CustomerEntity>([
    [mockCustomerSafe.id, mockCustomerSafe],
    [mockCustomerExceeded.id, mockCustomerExceeded],
    [mockCustomerOverdue.id, mockCustomerOverdue],
    [mockCustomerBoth.id, mockCustomerBoth],
  ]);

  const mockCustomersService: any = {
    findById: jest.fn(async (id: string) => customersMap.get(id)),
    findAllCustomers: jest.fn(async () => Array.from(customersMap.values())),
  };

  const mockInvoicesService: any = {
    findAll: jest.fn(async ({ customerId }: { customerId: string }) => {
      if (customerId === 'cust-overdue-01') {
        return [
          {
            id: 'inv-overdue-1',
            invoiceCode: 'HD-OD-01',
            remainingAmount: 40000000,
            issueDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 ngày trước (maxDebtDays = 30)
            dueDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // Quá hạn 15 ngày
          },
        ];
      }
      if (customerId === 'cust-safe-01') {
        return [
          {
            id: 'inv-safe-1',
            invoiceCode: 'HD-SAFE-01',
            remainingAmount: 30000000,
            issueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            dueDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
          },
        ];
      }
      return [];
    }),
  };

  beforeEach(() => {
    creditEvaluationService = new CreditEvaluationService(
      mockCustomersService,
      mockInvoicesService,
      undefined,
      undefined,
    );
  });

  afterEach(() => {
    creditEvaluationService.stopDailyCronJob();
  });

  describe('1. Gắn cờ tự động (Auto Flagging)', () => {
    it('TC-01: Không gắn cờ khi nợ và hạn thanh toán trong ngưỡng an toàn', async () => {
      const result = await creditEvaluationService.evaluateAgencyCredit('cust-safe-01');

      expect(result.isFlagged).toBe(false);
      expect(result.flagType).toBe(AgencyCreditFlag.CLEAR);
      expect(result.reasons.length).toBe(0);
    });

    it('TC-02: Tự động gắn cờ EXCEEDED_LIMIT khi Nợ hiện tại > Hạn mức cho phép', async () => {
      const result = await creditEvaluationService.evaluateAgencyCredit('cust-exceeded-01');

      expect(result.isFlagged).toBe(true);
      expect(result.flagType).toBe(AgencyCreditFlag.EXCEEDED_LIMIT);
      expect(result.overLimitAmount).toBe(30000000);
      expect(result.reasons.some((r) => r.includes('Vượt hạn mức nợ'))).toBe(true);
    });

    it('TC-03: Tự động gắn cờ OVERDUE khi có khoản nợ quá số ngày cho phép', async () => {
      const result = await creditEvaluationService.evaluateAgencyCredit('cust-overdue-01');

      expect(result.isFlagged).toBe(true);
      expect(result.flagType).toBe(AgencyCreditFlag.OVERDUE);
      expect(result.overdueDays).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('quá hạn'))).toBe(true);
    });

    it('TC-04: Tự động gắn cờ EXCEEDED_AND_OVERDUE khi vừa vượt hạn mức vừa quá hạn', async () => {
      const result = await creditEvaluationService.evaluateAgencyCredit('cust-both-01');

      expect(result.isFlagged).toBe(true);
      expect(result.flagType).toBe(AgencyCreditFlag.EXCEEDED_AND_OVERDUE);
      expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('2. Xử lý Đơn hàng mới khi đại lý bị gắn cờ theo cấu hình hệ thống', () => {
    it('TC-05: Chế độ BLOCK_ORDER chặn tuyệt đối không cho tạo đơn mới (allowed = false)', async () => {
      await creditEvaluationService.updateConfig({
        enforcementMode: CreditEnforcementMode.BLOCK_ORDER,
      });

      const check = await creditEvaluationService.checkOrderCreationAllowed('cust-exceeded-01', 5000000);

      expect(check.allowed).toBe(false);
      expect(check.enforcementMode).toBe(CreditEnforcementMode.BLOCK_ORDER);
      expect(check.errorMessage).toBeDefined();
      expect(check.errorMessage).toContain('KHÓA BÁN');
    });

    it('TC-06: Chế độ REQUIRE_APPROVAL cho phép tạo đơn nhưng bắt buộc chuyển trạng thái cần duyệt', async () => {
      await creditEvaluationService.updateConfig({
        enforcementMode: CreditEnforcementMode.REQUIRE_APPROVAL,
      });

      const check = await creditEvaluationService.checkOrderCreationAllowed('cust-exceeded-01', 5000000);

      expect(check.allowed).toBe(true);
      expect(check.requiresApproval).toBe(true);
      expect(check.enforcementMode).toBe(CreditEnforcementMode.REQUIRE_APPROVAL);
      expect(check.reasons.length).toBeGreaterThan(0);
    });

    it('TC-07: Đơn hàng mới làm tổng nợ vượt hạn mức cũng kích hoạt chặn / duyệt tương ứng', async () => {
      await creditEvaluationService.updateConfig({
        enforcementMode: CreditEnforcementMode.BLOCK_ORDER,
      });

      // cust-safe nợ 30tr / hạn mức 100tr. Đặt thêm 80tr -> tổng 110tr (vượt 10tr)
      const check = await creditEvaluationService.checkOrderCreationAllowed('cust-safe-01', 80000000);

      expect(check.allowed).toBe(false);
      expect(check.errorMessage).toContain('BLOCK_ORDER');
    });
  });

  describe('3. Triggers Đánh giá lại: Định kỳ và Sau khi thu tiền', () => {
    it('TC-08: onPaymentReceived đánh giá lại cờ ngay sau giao dịch thu tiền thành công', async () => {
      // Giả lập đại lý ban đầu vượt hạn mức
      const targetCustomer = customersMap.get('cust-exceeded-01')!;
      expect(targetCustomer.currentDebt).toBe(80000000);

      // Thu tiền 40.000.000 đ thành công -> nợ còn 40.000.000 đ (< hạn mức 50.000.000 đ)
      targetCustomer.currentDebt = 40000000;

      const evalAfterPayment = await creditEvaluationService.onPaymentReceived('cust-exceeded-01', {
        amount: 40000000,
        code: 'PT-2610-TEST',
      });

      expect(evalAfterPayment.isFlagged).toBe(false);
      expect(evalAfterPayment.flagType).toBe(AgencyCreditFlag.CLEAR);
    });

    it('TC-09: evaluateAllAgencies quét và đánh giá toàn bộ danh sách đại lý', async () => {
      const allResults = await creditEvaluationService.evaluateAllAgencies();

      expect(allResults.length).toBe(4);
      const flagged = allResults.filter((r) => r.isFlagged);
      expect(flagged.length).toBeGreaterThan(0);
    });
  });
});
