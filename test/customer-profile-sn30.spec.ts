import { BadRequestException } from '@nestjs/common';
import { CustomersService } from '../src/modules/customers/customers.service';
import { CustomerStatus } from '../src/modules/customers/entities/customer.entity';

describe('Customer Profile Management (SN-30)', () => {
  let service: CustomersService;

  beforeEach(() => {
    service = new CustomersService();
    service.resetData();
  });

  describe('AC1: Khai báo thông tin hồ sơ đại lý', () => {
    it('phải tạo đại lý thành công với đầy đủ các trường thông tin chuẩn', async () => {
      const newCust = await service.createCustomer({
        code: 'DL-TEST-001',
        name: 'Đại Lý Thực Phẩm Xanh Hà Nội',
        taxCode: '0101234567',
        customerGroup: 'AGENT_LEVEL_1',
        region: 'Miền Bắc',
        salesRepId: 'usr-sales-002',
        salesRepName: 'Trần Văn Nam',
        phone: '0981234567',
        email: 'dailyxanh@gmail.com',
        address: '100 Hoàng Quốc Việt, Cầu Giấy, Hà Nội',
        creditLimit: 200000000,
        maxDebtDays: 30,
      });

      expect(newCust).toBeDefined();
      expect(newCust.id).toBeDefined();
      expect(newCust.code).toBe('DL-TEST-001');
      expect(newCust.name).toBe('Đại Lý Thực Phẩm Xanh Hà Nội');
      expect(newCust.taxCode).toBe('0101234567');
      expect(newCust.customerGroup).toBe('AGENT_LEVEL_1');
      expect(newCust.region).toBe('Miền Bắc');
      expect(newCust.salesRepId).toBe('usr-sales-002');
      expect(newCust.salesRepName).toBe('Trần Văn Nam');
      expect(newCust.status).toBe(CustomerStatus.ACTIVE);
      expect(newCust.currentDebt).toBe(0);
      expect(newCust.creditLimit).toBe(200000000);
      expect(newCust.maxDebtDays).toBe(30);
    });

    it('nếu có điểm giao hàng ban đầu thì phải khởi tạo điểm giao hàng mặc định', async () => {
      const newCust = await service.createCustomer({
        code: 'DL-TEST-002',
        name: 'Bách Hóa Tiện Lợi Miền Nam',
        taxCode: '0319876543',
        customerGroup: 'AGENT_LEVEL_2',
        region: 'Miền Nam',
        phone: '0901234568',
        email: 'tienloimiennam@gmail.com',
        address: '50 Lê Duẩn, Q.1, TP.HCM',
        deliveryPointName: 'Kho Trung Tâm Quận 1',
        receiverName: 'Anh Hùng Kho',
      });

      expect(newCust.deliveryPoints.length).toBe(1);
      expect(newCust.deliveryPoints[0].name).toBe('Kho Trung Tâm Quận 1');
      expect(newCust.deliveryPoints[0].isDefault).toBe(true);
      expect(newCust.deliveryPoints[0].receiverName).toBe('Anh Hùng Kho');
    });
  });

  describe('AC2: Mã đại lý là duy nhất (Unique Code)', () => {
    it('phải ném lỗi BadRequestException nếu tạo đại lý với mã đã tồn tại', async () => {
      await service.createCustomer({
        code: 'DL-UNIQUE-01',
        name: 'Đại Lý Đầu Tiên',
        taxCode: '0101111222',
        region: 'Miền Bắc',
        phone: '0981111222',
        email: 'daily01@gmail.com',
        address: 'Hà Nội',
      });

      // Thử tạo đại lý thứ hai với cùng mã
      await expect(
        service.createCustomer({
          code: 'DL-UNIQUE-01',
          name: 'Đại Lý Trùng Mã',
          taxCode: '0103333444',
          region: 'Miền Bắc',
          phone: '0983333444',
          email: 'dailytrung@gmail.com',
          address: 'Hải Phòng',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('phải chặn trùng mã ngay cả khi viết hoa/thường hoặc khoảng trắng thừa', async () => {
      await service.createCustomer({
        code: 'DL-CASE-TEST',
        name: 'Đại Lý Gốc',
        taxCode: '0105555666',
        region: 'Miền Trung',
        phone: '0945555666',
        email: 'dailygoc@gmail.com',
        address: 'Đà Nẵng',
      });

      // Thử tạo với chữ thường 'dl-case-test'
      await expect(
        service.createCustomer({
          code: '  dl-case-test  ',
          name: 'Đại Lý Case-Insensitive Duplicate',
          taxCode: '0107777888',
          region: 'Miền Trung',
          phone: '0947777888',
          email: 'caseins@gmail.com',
          address: 'Huế',
        }),
      ).rejects.toThrow('Mã đại lý "dl-case-test" đã tồn tại trong hệ thống');
    });

    it('phải ném lỗi nếu mã đại lý rỗng hoặc chỉ có khoảng trắng', async () => {
      await expect(
        service.createCustomer({
          code: '   ',
          name: 'Đại Lý Mã Rỗng',
          taxCode: '0109999000',
          region: 'Miền Bắc',
          phone: '0989999000',
          email: 'marong@gmail.com',
          address: 'Hà Nội',
        }),
      ).rejects.toThrow('Mã đại lý không được để trống.');
    });
  });

  describe('AC3: Nhóm khách hàng quyết định bảng giá áp dụng', () => {
    it('hỗ trợ đầy đủ 4 nhóm khách hàng tương ứng với 4 chính sách giá', async () => {
      const groups = ['AGENT_LEVEL_1', 'AGENT_LEVEL_2', 'WHOLESALE', 'RETAIL'];

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const cust = await service.createCustomer({
          code: `DL-GRP-00${i + 1}`,
          name: `Đại lý nhóm ${group}`,
          taxCode: `010000000${i}`,
          customerGroup: group,
          region: 'Miền Nam',
          phone: `090000000${i}`,
          email: `group${i}@gmail.com`,
          address: 'TP.HCM',
        });

        expect(cust.customerGroup).toBe(group);
      }
    });
  });

  describe('AC4: Đại lý đã phát sinh giao dịch thì không xoá được, chỉ ngừng giao dịch', () => {
    it('phải ném lỗi BadRequestException khi xóa đại lý có dư nợ > 0', async () => {
      // cust-hn-001 trong seed có dư nợ 45,000,000 đ
      const custWithDebt = await service.getCustomerById('cust-hn-001');
      expect(custWithDebt.currentDebt).toBeGreaterThan(0);

      await expect(service.deleteCustomer('cust-hn-001')).rejects.toThrow(
        'không thể xóa. Chỉ được phép chuyển sang trạng thái Ngừng giao dịch (INACTIVE)',
      );
    });

    it('phải ném lỗi khi xóa đại lý đã phát sinh giao dịch (hasTransactions = true)', async () => {
      // cust-hn-002 có giao dịch
      await expect(service.deleteCustomer('cust-hn-002', true)).rejects.toThrow(
        'không thể xóa. Chỉ được phép chuyển sang trạng thái Ngừng giao dịch (INACTIVE)',
      );
    });

    it('cho phép chuyển trạng thái đại lý sang Ngừng giao dịch (INACTIVE)', async () => {
      const deactivated = await service.deactivateCustomer('cust-hn-001');
      expect(deactivated.status).toBe(CustomerStatus.INACTIVE);

      // Đại lý vẫn tồn tại trong hệ thống với trạng thái INACTIVE
      const fetched = await service.getCustomerById('cust-hn-001');
      expect(fetched.status).toBe(CustomerStatus.INACTIVE);
    });

    it('cho phép xóa đại lý nếu chưa từng phát sinh giao dịch và dư nợ = 0', async () => {
      const newCust = await service.createCustomer({
        code: 'DL-CLEAN-001',
        name: 'Đại Lý Mới Chưa Phát Sinh Đơn Hàng',
        taxCode: '0109999888',
        customerGroup: 'AGENT_LEVEL_2',
        region: 'Miền Bắc',
        phone: '0989999888',
        email: 'clean01@gmail.com',
        address: 'Bắc Ninh',
      });

      expect(newCust.currentDebt).toBe(0);

      const deleteRes = await service.deleteCustomer(newCust.id);
      expect(deleteRes.success).toBe(true);
      expect(deleteRes.customerId).toBe(newCust.id);

      // Đã bị xóa khỏi Map
      await expect(service.getCustomerById(newCust.id)).rejects.toThrow('Không tìm thấy đại lý');
    });
  });
});
