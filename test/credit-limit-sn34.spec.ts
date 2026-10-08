import { CustomersService } from '../src/modules/customers/customers.service';
import { AuditLogsService } from '../src/modules/audit-logs/audit-logs.service';
import { CreditLimitService } from '../src/modules/credit-limit/credit-limit.service';
import { CreditStatus } from '../src/modules/credit-limit/enums/credit-status.enum';
import { UpdateCreditLimitDto } from '../src/modules/credit-limit/dto/update-credit-limit.dto';
import { UpdateCreditStatusDto } from '../src/modules/credit-limit/dto/update-credit-status.dto';

describe('Credit Limit Management (SN-34)', () => {
  let customersService: CustomersService;
  let auditLogsService: AuditLogsService;
  let creditLimitService: CreditLimitService;

  beforeEach(async () => {
    customersService = new CustomersService();
    const mockUsersService = {
      findById: jest.fn().mockResolvedValue({
        id: 'usr-acc-006',
        fullName: 'Nguyễn Thu Hà',
        username: 'accountant',
        email: 'accountant@loha.vn',
      }),
    };
    auditLogsService = new AuditLogsService(mockUsersService as any);
    await auditLogsService.onModuleInit();

    creditLimitService = new CreditLimitService(
      customersService,
      auditLogsService,
    );
    await creditLimitService.onModuleInit();
  });

  it('phải tải danh sách hạn mức công nợ và tự động tính toán availableCredit, debtUsagePercentage (SN-34)', async () => {
    const result = await creditLimitService.getCreditLimits();
    expect(result.data.length).toBeGreaterThanOrEqual(5);

    const first = result.data[0];
    expect(first.creditLimit).toBeGreaterThan(0);
    expect(first.availableCredit).toBe(
      Math.max(0, first.creditLimit + first.temporaryCreditLimit - first.currentDebt),
    );
    expect(first.debtUsagePercentage).toBeGreaterThanOrEqual(0);
    expect([
      CreditStatus.NORMAL,
      CreditStatus.WARNING,
      CreditStatus.EXCEEDED,
      CreditStatus.BLOCKED,
    ]).toContain(first.status);
  });

  it('thống kê tổng quan hạn mức công nợ toàn hệ thống (SN-34)', async () => {
    const stats = await creditLimitService.getCreditLimitStats();
    expect(stats.totalCreditLimit).toBeGreaterThan(0);
    expect(stats.totalCurrentDebt).toBeGreaterThan(0);
    expect(stats.totalCustomers).toBeGreaterThanOrEqual(5);
    expect(stats.averageUsageRate).toBeGreaterThanOrEqual(0);
    expect(
      stats.normalCount +
        stats.warningCount +
        stats.exceededCount +
        stats.blockedCount,
    ).toBe(stats.totalCustomers);
  });

  it('khai báo và cập nhật hạn mức công nợ đại lý kèm Audit Log và History (SN-34)', async () => {
    const updateDto: UpdateCreditLimitDto = {
      creditLimit: 150000000,
      maxDebtDays: 45,
      paymentTerms: 'NET_45',
      temporaryCreditLimit: 20000000,
      reason: 'Nâng hạn mức công nợ quý 4 theo doanh số tăng trưởng vượt bậc',
    };

    const updated = await creditLimitService.updateCreditLimit(
      'cust-001',
      updateDto,
      {
        userId: 'usr-acc-006',
        username: 'accountant',
        email: 'accountant@loha.vn',
        roles: ['ACCOUNTANT' as any],
      },
    );

    expect(updated.creditLimit).toBe(150000000);
    expect(updated.maxDebtDays).toBe(45);
    expect(updated.paymentTerms).toBe('NET_45');
    expect(updated.temporaryCreditLimit).toBe(20000000);

    // Kiểm tra lịch sử cập nhật
    const history = await creditLimitService.getCreditLimitHistory('cust-001');
    expect(history.length).toBeGreaterThan(0);
    const latestHistory = history[0];
    expect(latestHistory.newCreditLimit).toBe(150000000);
    expect(latestHistory.reason).toContain('Nâng hạn mức công nợ quý 4');

    // Kiểm tra đồng bộ sang CustomersService
    const customer = await customersService.getCustomerById('cust-001');
    expect(customer.creditLimit).toBe(150000000);
    expect(customer.maxDebtDays).toBe(45);
  });

  it('khóa và mở khóa hạn mức tín dụng đại lý (SN-34)', async () => {
    const blockDto: UpdateCreditStatusDto = {
      status: CreditStatus.BLOCKED,
      reason: 'Tạm khóa hạn mức tín dụng do phát sinh tranh chấp công nợ',
    };

    const blocked = await creditLimitService.updateCreditStatus(
      'cust-002',
      blockDto,
      {
        userId: 'usr-acc-006',
        username: 'accountant',
        email: 'accountant@loha.vn',
        roles: ['ACCOUNTANT' as any],
      },
    );

    expect(blocked.status).toBe(CreditStatus.BLOCKED);
    expect(blocked.lockReason).toBe(
      'Tạm khóa hạn mức tín dụng do phát sinh tranh chấp công nợ',
    );

    // Mở khóa lại
    const unblockDto: UpdateCreditStatusDto = {
      status: CreditStatus.NORMAL,
      reason: 'Đại lý đã hoàn tất thanh toán nợ quá hạn, mở khóa hạn mức',
    };

    const unblocked = await creditLimitService.updateCreditStatus(
      'cust-002',
      unblockDto,
      {
        userId: 'usr-acc-006',
        username: 'accountant',
        email: 'accountant@loha.vn',
        roles: ['ACCOUNTANT' as any],
      },
    );

    expect(unblocked.status).toBe(CreditStatus.NORMAL);
  });
});
