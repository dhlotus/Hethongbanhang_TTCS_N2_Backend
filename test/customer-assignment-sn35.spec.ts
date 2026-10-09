import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';
import { CustomersService } from '../src/modules/customers/customers.service';
import { CustomerStatus } from '../src/modules/customers/enums/customer-status.enum';

describe('[SN-35] Phan cong Nhan vien Kinh doanh theo Dai ly va Khu vuc', () => {
  let service: CustomersService;

  const mockManagerUser: ICurrentUser = {
    userId: 'usr-salesmgr-003',
    email: 'salesmanager@loha.vn',
    username: 'salesmanager',
    roles: [UserRole.SALES_MANAGER],
  };

  const mockSalesRepUser: ICurrentUser = {
    userId: 'usr-sales-002',
    email: 'sales@loha.vn',
    username: 'sales',
    roles: [UserRole.SALES_REP],
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    service = new CustomersService();
    service.resetData();
  });

  describe('Phan quyen du lieu xem dai ly (RBAC)', () => {
    it('TC-01: Quan ly kinh doanh nhin thay toan bo danh sach dai ly va so dai ly chua gan', async () => {
      const res = await service.findAll({ limit: 50 }, mockManagerUser);
      expect(res.total).toBeGreaterThanOrEqual(10);
      expect(res.unassignedCount).toBeGreaterThanOrEqual(4);
    });

    it('TC-02: Nhan vien kinh doanh (SALES_REP) chi nhin thay dai ly do minh phu trach chinh', async () => {
      const res = await service.findAll({ limit: 50 }, mockSalesRepUser);
      expect(res.total).toBeGreaterThan(0);
      for (const customer of res.data) {
        expect(customer.salesRepId).toBe('usr-sales-002');
      }
    });

    it('TC-03: Loc dai ly theo khu vuc dia ban', async () => {
      const res = await service.findAll({ region: 'Miền Bắc', limit: 50 }, mockManagerUser);
      expect(res.data.length).toBeGreaterThan(0);
      for (const customer of res.data) {
        expect(customer.region).toBe('Miền Bắc');
      }
    });
  });

  describe('Gan nhan vien phu trach chinh cho dai ly', () => {
    it('TC-04: Gan nhan vien phu trach chinh cho dai ly chua co nguoi phu trach thanh cong', async () => {
      const targetCustomer = (await service.findAll({ unassignedOnly: true }, mockManagerUser)).data[0];
      expect(targetCustomer).toBeDefined();

      const updated = await service.assignSalesRep(
        targetCustomer.id,
        {
          salesRepId: 'usr-sales-002',
          reason: 'Phan cong dai ban moi khu vuc Hai Phong',
        },
        mockManagerUser,
      );

      expect(updated.salesRepId).toBe('usr-sales-002');
      expect(updated.salesRepName).toContain('Trần Văn Nam');

      // Kiem tra lich su duoc ghi nhan
      const historyRes = await service.getAssignmentHistory({ customerId: targetCustomer.id });
      expect(historyRes.total).toBeGreaterThan(0);
      expect(historyRes.data[0].toSalesRepId).toBe('usr-sales-002');
    });

    it('TC-05: Nem NotFoundException khi gan cho dai ly khong ton tai', async () => {
      await expect(
        service.assignSalesRep(
          'non-existent-customer-id',
          { salesRepId: 'usr-sales-002' },
          mockManagerUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Chuyen giao dia ban hang loat khi nhan vien nghi (co ghi lich su)', () => {
    it('TC-06: Chuyen giao thanh cong toan bo dai ly cua nhan vien nghi viec cho nhan vien moi', async () => {
      const result = await service.bulkTransferTerritory(
        {
          fromSalesRepId: 'usr-sales-002',
          toSalesRepId: 'usr-salesmgr-003',
          reason: 'Nhan vien Tran Van Nam nghi viec, ban giao toan bo dia ban cho quan ly',
          notes: 'Ban giao ca so theo doi cong no va diem giao hang',
        },
        mockManagerUser,
      );

      expect(result.transferredCount).toBeGreaterThan(0);
      expect(result.fromSalesRep.id).toBe('usr-sales-002');
      expect(result.toSalesRep.id).toBe('usr-salesmgr-003');
      expect(result.transferBatchId).toMatch(/^BATCH-/);

      // Kiem tra tat ca dai ly da duoc chuyen sang nhan vien moi
      for (const item of result.transferredCustomers) {
        const cust = await service.findById(item.id);
        expect(cust.salesRepId).toBe('usr-salesmgr-003');
      }

      // Kiem tra lich su ghi nhan day du
      const hist = await service.getAssignmentHistory({ fromSalesRepId: 'usr-sales-002' });
      expect(hist.total).toBeGreaterThanOrEqual(result.transferredCount);
      expect(hist.data[0].reason).toContain('nghi viec');
    });

    it('TC-07: Nem BadRequestException khi nhan su chuyen va nhan trung nhau', async () => {
      await expect(
        service.bulkTransferTerritory(
          {
            fromSalesRepId: 'usr-sales-002',
            toSalesRepId: 'usr-sales-002',
            reason: 'Thu nghiem chuyen giao trung lap',
          },
          mockManagerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-08: Nem BadRequestException khi ly do chuyen giao de trong', async () => {
      await expect(
        service.bulkTransferTerritory(
          {
            fromSalesRepId: 'usr-sales-002',
            toSalesRepId: 'usr-salesmgr-003',
            reason: '   ',
          },
          mockManagerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-09: Chuyen giao hang loat voi danh sach customerIds tuy chon', async () => {
      // Gan 2 dai ly cho sales-002
      const all = await service.findAll({ limit: 10 }, mockManagerUser);
      const c1 = all.data[0];
      const c2 = all.data[1];

      await service.assignSalesRep(c1.id, { salesRepId: 'usr-sales-002' }, mockManagerUser);
      await service.assignSalesRep(c2.id, { salesRepId: 'usr-sales-002' }, mockManagerUser);

      // Chi chuyen giao duy nhat c1
      const transferRes = await service.bulkTransferTerritory(
        {
          fromSalesRepId: 'usr-sales-002',
          toSalesRepId: 'usr-salesmgr-003',
          customerIds: [c1.id],
          reason: 'Dieu chuyen rieng 1 dai ly',
        },
        mockManagerUser,
      );

      expect(transferRes.transferredCount).toBe(1);
      const afterC1 = await service.findById(c1.id);
      expect(afterC1.salesRepId).toBe('usr-salesmgr-003');
    });
  });
});
