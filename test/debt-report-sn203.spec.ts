import { Test, TestingModule } from '@nestjs/testing';
import { DebtReportService } from '../src/modules/debt-report/debt-report.service';
import { CustomersService } from '../src/modules/customers/customers.service';
import { AgingDebtGroup } from '../src/modules/debt-report/enums/aging-debt-group.enum';
import { CustomerEntity } from '../src/modules/customers/entities/customer.entity';

describe('[SN-203] DebtReportService - Sổ Công Nợ và Phân Tích Tuổi Nợ', () => {
  let service: DebtReportService;
  let mockCustomersService: Partial<CustomersService>;

  beforeEach(async () => {
    mockCustomersService = {
      findAllCustomers: jest.fn().mockResolvedValue([
        new CustomerEntity({
          id: 'cust-1',
          code: 'DL-0001',
          name: 'Đại lý Minh Khang',
          customerGroup: 'AGENT_LEVEL_1',
          currentDebt: 45000000,
          creditLimit: 500000000,
          maxDebtDays: 45,
          phone: '0901234561',
          region: 'Miền Nam',
          salesRepName: 'Trần Văn Long',
        }),
        new CustomerEntity({
          id: 'cust-2',
          code: 'DL-0003',
          name: 'Đại lý Tân Phú',
          customerGroup: 'AGENT_LEVEL_1',
          currentDebt: 72000000,
          creditLimit: 300000000,
          maxDebtDays: 30,
          phone: '0901234563',
          region: 'Miền Nam',
          salesRepName: 'Trần Văn Long',
        }),
        new CustomerEntity({
          id: 'cust-3',
          code: 'DL-0005',
          name: 'Nhà Phân Phối Hoàng Gia',
          customerGroup: 'AGENT_LEVEL_1',
          currentDebt: 0,
          creditLimit: 350000000,
          maxDebtDays: 30,
          phone: '0901234565',
          region: 'Miền Trung',
          salesRepName: 'Nguyễn Văn A',
        }),
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DebtReportService,
        {
          provide: CustomersService,
          useValue: mockCustomersService,
        },
      ],
    }).compile();

    service = module.get<DebtReportService>(DebtReportService);
  });

  describe('calculateAgingGroup', () => {
    it('phân nhóm 0–30 ngày chính xác', () => {
      expect(service.calculateAgingGroup(15)).toBe(AgingDebtGroup.AGE_0_30);
      expect(service.calculateAgingGroup(30)).toBe(AgingDebtGroup.AGE_0_30);
    });

    it('phân nhóm 31–60 ngày chính xác', () => {
      expect(service.calculateAgingGroup(31)).toBe(AgingDebtGroup.AGE_31_60);
      expect(service.calculateAgingGroup(60)).toBe(AgingDebtGroup.AGE_31_60);
    });

    it('phân nhóm 61–90 ngày chính xác', () => {
      expect(service.calculateAgingGroup(61)).toBe(AgingDebtGroup.AGE_61_90);
      expect(service.calculateAgingGroup(90)).toBe(AgingDebtGroup.AGE_61_90);
    });

    it('phân nhóm Trên 90 ngày chính xác', () => {
      expect(service.calculateAgingGroup(91)).toBe(AgingDebtGroup.AGE_OVER_90);
      expect(service.calculateAgingGroup(120)).toBe(AgingDebtGroup.AGE_OVER_90);
    });
  });

  describe('getAgentDebtReport', () => {
    it('lấy toàn bộ báo cáo kèm phân rã tuổi nợ và tổng cộng chân bảng', async () => {
      const res = await service.getAgentDebtReport({});
      expect(res.data).toHaveLength(3);
      expect(res.summary).toBeDefined();
      expect(res.summary.totalAgencies).toBe(3);
      expect(res.summary.remainingDebt).toBe(45000000 + 72000000);
      expect(res.summary.totalReceivable).toBeGreaterThan(0);
      expect(res.summary.totalPaid).toBeGreaterThan(0);
    });

    it('lọc chỉ đại lý có nợ quá hạn (isOverdueOnly)', async () => {
      const res = await service.getAgentDebtReport({ isOverdueOnly: true });
      expect(res.data.every((item) => item.isOverdue)).toBe(true);
      expect(res.summary.overdueAgenciesCount).toBe(res.data.length);
    });

    it('lọc chính xác đại lý nợ trong hạn (debtStatus: IN_TERM)', async () => {
      const res = await service.getAgentDebtReport({ debtStatus: 'IN_TERM' });
      expect(res.data.every((item) => !item.isOverdue && item.overdueAmount === 0)).toBe(true);
      expect(res.data.some((item) => item.agencyCode === 'DL-0001')).toBe(false);
      expect(res.data.some((item) => item.agencyCode === 'DL-0005')).toBe(true);
    });

    it('lọc theo từ khóa tìm kiếm (search)', async () => {
      const res = await service.getAgentDebtReport({ search: 'Tân Phú' });
      expect(res.data).toHaveLength(1);
      expect(res.data[0].agencyCode).toBe('DL-0003');
    });

    it('lọc theo nhóm tuổi nợ 61–90 ngày (agingGroup)', async () => {
      const res = await service.getAgentDebtReport({
        agingGroup: AgingDebtGroup.AGE_61_90,
      });
      expect(res.data.every((item) => item.age61To90 > 0)).toBe(true);
    });

    it('ưu tiên sắp xếp đại lý có tuổi nợ lâu nhất lên đầu danh sách', async () => {
      const res = await service.getAgentDebtReport({});
      expect(res.data[0].agencyCode).toBe('DL-0003'); // 75 ngày
      expect(res.data[1].agencyCode).toBe('DL-0001'); // 40 ngày
      expect(res.data[2].agencyCode).toBe('DL-0005'); // 0 ngày
    });
  });

  describe('getAgencyInvoices', () => {
    it('lấy danh sách hóa đơn theo đại lý khớp với tổng dư nợ và dải tuổi nợ', async () => {
      const invoices = await service.getAgencyInvoices('DL-0001');
      expect(invoices).toHaveLength(2);
      const totalRemaining = invoices.reduce((sum, inv) => sum + inv.remainingAmount, 0);
      expect(totalRemaining).toBe(45000000);
      expect(invoices[0].daysOld).toBeGreaterThanOrEqual(invoices[1].daysOld);
    });

    it('ném lỗi NotFoundException khi không tìm thấy đại lý', async () => {
      await expect(service.getAgencyInvoices('DL-NON-EXISTENT')).rejects.toThrow();
    });
  });

  describe('exportDebtToExcel', () => {
    it('tạo buffer Excel hợp lệ chứa chữ ký và bảng tính', async () => {
      const buffer = await service.exportDebtToExcel({});
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(1000);
    });

    it('hiển thị chính xác nhóm tuổi nợ kèm số ngày nợ thực tế', () => {
      const agencyOverdue = {
        remainingDebt: 22000000,
        ageOver90: 8000000,
        oldestDebtDays: 110,
      } as any;
      expect(service.getAgingGroupForAgency(agencyOverdue)).toBe('> 90 ngày (110 ngày)');

      const agencyPaid = {
        remainingDebt: 0,
        oldestDebtDays: 0,
      } as any;
      expect(service.getAgingGroupForAgency(agencyPaid)).toBe('Đã tất toán');

      const agency61To90 = {
        remainingDebt: 65000000,
        age61To90: 25000000,
        oldestDebtDays: 75,
      } as any;
      expect(service.getAgingGroupForAgency(agency61To90)).toBe('61–90 ngày (75 ngày)');
    });
  });
});
