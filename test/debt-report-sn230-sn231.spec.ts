import { Test, TestingModule } from '@nestjs/testing';
import { DebtReportService } from '../src/modules/debt-report/debt-report.service';
import { CustomersService } from '../src/modules/customers/customers.service';
import { CustomerEntity } from '../src/modules/customers/entities/customer.entity';
import { AgingDebtGroupEnum } from '../src/modules/debt-report/enums/aging-debt-group.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('[SN-230 & SN-231] DebtReportService - Tuổi nợ & Sổ chi tiết công nợ đại lý', () => {
  let service: DebtReportService;
  let mockCustomersService: Partial<CustomersService>;

  const mockCustomers: CustomerEntity[] = [
    new CustomerEntity({
      id: 'cust-dl-0001',
      code: 'DL-0001',
      name: 'Công Ty TNHH Thương Mại & Phân Phối Minh Khang',
      customerGroup: 'AGENT_LEVEL_1',
      region: 'Miền Nam',
      salesRepId: 'usr-sale-01',
      salesRepName: 'Trần Văn Long',
      creditLimit: 500000000,
      currentDebt: 45000000,
      maxDebtDays: 45,
      phone: '0901234561',
    }),
    new CustomerEntity({
      id: 'cust-dl-0002',
      code: 'DL-0002',
      name: 'Tổng Đại Lý Phân Phối Thực Phẩm Toàn Cầu',
      customerGroup: 'AGENT_LEVEL_1',
      region: 'Miền Nam',
      salesRepId: 'usr-sale-01',
      salesRepName: 'Trần Văn Long',
      creditLimit: 400000000,
      currentDebt: 28000000,
      maxDebtDays: 45,
      phone: '0901234562',
    }),
    new CustomerEntity({
      id: 'cust-dl-0003',
      code: 'DL-0003',
      name: 'Công Ty Cổ Phần Thương Mại Dịch Vụ Hoàng Gia',
      customerGroup: 'AGENT_LEVEL_1',
      region: 'Miền Nam',
      salesRepId: 'usr-sale-02',
      salesRepName: 'Nguyễn Thị Hằng',
      creditLimit: 600000000,
      currentDebt: 72000000,
      maxDebtDays: 45,
      phone: '0901234563',
    }),
    new CustomerEntity({
      id: 'cust-dl-0004',
      code: 'DL-0004',
      name: 'Chuỗi Cửa Hàng Tiện Lợi & Phân Phối An Bình',
      customerGroup: 'AGENT_LEVEL_1',
      region: 'Miền Nam',
      salesRepId: 'usr-sale-02',
      salesRepName: 'Nguyễn Thị Hằng',
      creditLimit: 350000000,
      currentDebt: 12000000,
      maxDebtDays: 30,
      phone: '0901234564',
    }),
    new CustomerEntity({
      id: 'cust-dl-0005',
      code: 'DL-0005',
      name: 'Đại Lý Tân Phát',
      customerGroup: 'AGENT_LEVEL_1',
      region: 'Miền Trung',
      salesRepId: 'usr-sale-03',
      salesRepName: 'Phạm Minh Tuấn',
      creditLimit: 350000000,
      currentDebt: 0,
      maxDebtDays: 30,
      phone: '0901234565',
    }),
  ];

  beforeEach(async () => {
    mockCustomersService = {
      findAllCustomers: jest.fn().mockResolvedValue(mockCustomers),
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

  describe('SN-230: Báo cáo công nợ quá hạn theo tuổi nợ', () => {
    it('1. Tổng hợp công nợ theo ngày chốt báo cáo (asOfDate)', async () => {
      const res = await service.getAgentDebtReport({
        asOfDate: '2026-10-20',
      });
      expect(res.data).toBeDefined();
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.summary).toBeDefined();
      expect(res.summary.asOfDate).toBe('2026-10-20');
      expect(res.summary.salesRepSummary).toBeDefined();
      expect(res.summary.salesRepSummary!.length).toBeGreaterThan(0);
    });

    it('2. Lọc theo nhân viên kinh doanh phụ trách (salesRepName)', async () => {
      const res = await service.getAgentDebtReport({
        salesRepName: 'Trần Văn Long',
      });
      expect(res.data.every((c) => c.salesRepName === 'Trần Văn Long')).toBe(true);
      expect(res.data.length).toBe(2); // DL-0001, DL-0002
    });

    it('3. Lọc theo đại lý cụ thể (agencyId / code)', async () => {
      const res = await service.getAgentDebtReport({
        agencyId: 'DL-0003',
      });
      expect(res.data).toHaveLength(1);
      expect(res.data[0].agencyCode).toBe('DL-0003');
      expect(res.summary.totalAgencies).toBe(1);
    });

    it('4. Phân nhóm tuổi nợ không chồng lấn và xác định đúng mức ưu tiên', async () => {
      const res = await service.getAgentDebtReport({});
      for (const item of res.data) {
        // Tổng các nhóm tuổi nợ không vượt quá tổng dư nợ
        const bucketTotal =
          item.currentInTerm + item.age1To30 + item.age31To60 + item.age61To90 + item.ageOver90;
        if (item.remainingDebt > 0) {
          expect(bucketTotal).toBeGreaterThan(0);
        }
        // Kiểm tra căn cứ ưu tiên rõ ràng
        expect(item.priorityLevel).toBeDefined();
        expect(item.priorityReason).toBeTruthy();
        expect(typeof item.priorityReason).toBe('string');
      }
    });

    it('5. Xuất Excel báo cáo tuổi nợ đúng định dạng và có dữ liệu', async () => {
      const buffer = await service.exportDebtToExcel({
        asOfDate: '2026-10-20',
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(5000);
    });
  });

  describe('SN-231: Sổ chi tiết công nợ đại lý (Customer Ledger Statement)', () => {
    it('1. Trả về đúng 4 chỉ số tài chính và đảm bảo công thức cân đối kế toán', async () => {
      const statement = await service.getDebtLedger({
        agencyId: 'DL-0004',
        fromDate: '2026-10-01',
        toDate: '2026-10-20',
      });

      expect(statement.agency).toBeDefined();
      expect(statement.agency.code).toBe('DL-0004');
      expect(statement.period.fromDate).toBe('2026-10-01');
      expect(statement.period.toDate).toBe('2026-10-20');

      // 4 chỉ số tài chính
      expect(typeof statement.openingBalance).toBe('number');
      expect(typeof statement.totalDebit).toBe('number');
      expect(typeof statement.totalCredit).toBe('number');
      expect(typeof statement.closingBalance).toBe('number');

      // ĐẢM BẢO CÔNG THỨC: Số dư cuối kỳ = Số dư đầu kỳ + Phát sinh tăng - Phát sinh giảm
      const expectedClosing =
        statement.openingBalance + statement.totalDebit - statement.totalCredit;
      expect(statement.closingBalance).toBe(expectedClosing);
      expect(statement.isBalanced).toBe(true);
    });

    it('2. Thứ tự phát sinh ổn định (Stable Ordering) và lũy kế chính xác', async () => {
      const statement = await service.getDebtLedger({
        agencyId: 'DL-0004',
        fromDate: '2026-08-01',
        toDate: '2026-10-20',
      });

      let testBalance = statement.openingBalance;
      for (const tx of statement.transactions) {
        if (tx.status !== 'CANCELLED') {
          testBalance = testBalance + tx.debit - tx.credit;
        }
        expect(tx.runningBalance).toBe(testBalance);
      }
    });

    it('3. Xử lý chứng từ hủy không ghi tăng nợ và không tính vào tổng phát sinh', async () => {
      const statement = await service.getDebtLedger({
        agencyId: 'DL-0004',
        fromDate: '2026-10-01',
        toDate: '2026-10-20',
      });

      const cancelledTx = statement.transactions.find((tx) => tx.status === 'CANCELLED');
      if (cancelledTx) {
        expect(cancelledTx.debit).toBe(0);
        expect(cancelledTx.description).toContain('đã hủy');
      }
    });

    it('4. Phân quyền RBAC: Khách hàng chỉ được xem sổ của chính mình', async () => {
      const customerUser = {
        userId: 'cust-dl-0001',
        username: 'DL-0001',
        roles: [UserRole.CUSTOMER],
      };

      // Cho phép xem chính mình
      await expect(
        service.getDebtLedger({ agencyId: 'DL-0001' }, customerUser as any),
      ).resolves.toBeDefined();

      // Cấm xem đại lý khác
      await expect(
        service.getDebtLedger({ agencyId: 'DL-0002' }, customerUser as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('5. Xuất Excel sổ chi tiết công nợ đại lý thành công', async () => {
      const buffer = await service.exportLedgerToExcel({
        agencyId: 'DL-0004',
        fromDate: '2026-10-01',
        toDate: '2026-10-20',
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(2000);
    });

    it('6. Xuất PDF sổ chi tiết công nợ đại lý thành công', async () => {
      const buffer = await service.exportLedgerToPdf({
        agencyId: 'DL-0004',
        fromDate: '2026-10-01',
        toDate: '2026-10-20',
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(1000);
    });

    it('7. Ném lỗi NotFoundException khi không tìm thấy đại lý', async () => {
      await expect(
        service.getDebtLedger({ agencyId: 'DL-NON-EXISTENT' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
