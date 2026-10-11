import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService } from '../src/modules/customers/customers.service';
import { removeVietnameseTones, matchesSearchTerm } from '../src/common/utils/vietnamese.util';

describe('Customer Accent-Insensitive Search (Tìm kiếm đại lý không dấu)', () => {
  let service: CustomersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomersService],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
    service.resetData();
  });

  describe('Tiện ích removeVietnameseTones & matchesSearchTerm', () => {
    it('phải loại bỏ chính xác toàn bộ dấu tiếng Việt', () => {
      expect(removeVietnameseTones('Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang')).toBe(
        'cua hang thuc pham tieu dung minh khang',
      );
      expect(removeVietnameseTones('Đại Lý Bách Hóa Thực Phẩm Bảo Châu')).toBe(
        'dai ly bach hoa thuc pham bao chau',
      );
      expect(removeVietnameseTones('Đà Nẵng & Hà Nội & Sài Gòn')).toBe(
        'da nang & ha noi & sai gon',
      );
    });

    it('matchesSearchTerm phải khớp cả khi từ khóa có dấu và không dấu', () => {
      const name = 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang';
      expect(matchesSearchTerm(name, 'minh khang')).toBe(true);
      expect(matchesSearchTerm(name, 'MINH KHANG')).toBe(true);
      expect(matchesSearchTerm(name, 'Minh Khang')).toBe(true);
      expect(matchesSearchTerm(name, 'thuc pham')).toBe(true);
      expect(matchesSearchTerm(name, 'tieu dung')).toBe(true);
      expect(matchesSearchTerm(name, 'khong-ton-tai')).toBe(false);
    });
  });

  describe('Tìm kiếm đại lý qua filterCustomers', () => {
    it('phải tìm được đại lý khi nhập từ khóa tên không dấu "minh khang"', async () => {
      const result = await service.filterCustomers({ search: 'minh khang' });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(
        result.data.some((c) => c.name.includes('Minh Khang')),
      ).toBe(true);
    });

    it('phải tìm được đại lý khi nhập từ khóa tên không dấu "bao chau"', async () => {
      const result = await service.filterCustomers({ search: 'bao chau' });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(
        result.data.some((c) => c.name.includes('Bảo Châu')),
      ).toBe(true);
    });

    it('phải tìm được đại lý khi nhập từ khóa tên không dấu "thang long"', async () => {
      const result = await service.filterCustomers({ search: 'thang long' });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(
        result.data.some((c) => c.name.includes('Thăng Long')),
      ).toBe(true);
    });

    it('phải tìm được đại lý khi nhập từ khóa tên không dấu "ha dong"', async () => {
      const result = await service.filterCustomers({ search: 'ha dong' });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(
        result.data.some((c) => c.name.includes('Hà Đông')),
      ).toBe(true);
    });

    it('phải tìm được đại lý khi nhập từ khóa chung không dấu "dai ly"', async () => {
      const result = await service.filterCustomers({ search: 'dai ly' });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      for (const c of result.data) {
        expect(
          matchesSearchTerm(c.name, 'dai ly') ||
            matchesSearchTerm(c.code, 'dai ly') ||
            matchesSearchTerm(c.address, 'dai ly'),
        ).toBe(true);
      }
    });

    it('vẫn tìm kiếm chính xác khi nhập từ khóa CÓ DẤU', async () => {
      const result = await service.filterCustomers({ search: 'Bảo Châu' });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].name).toContain('Bảo Châu');
    });

    it('tìm kiếm theo mã đại lý không phân biệt hoa thường', async () => {
      const result = await service.filterCustomers({ search: 'dl-hcm-001' });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].code).toBe('DL-HCM-001');
    });

    it('tìm kiếm theo địa chỉ không dấu', async () => {
      const result = await service.filterCustomers({ search: 'cau giay' });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].address).toContain('Cầu Giấy');
    });

    it('lọc theo khu vực không dấu "mien bac"', async () => {
      const result = await service.filterCustomers({ region: 'mien bac' as any });
      expect(result.data.length).toBeGreaterThanOrEqual(1);
      for (const c of result.data) {
        expect(c.region).toBe('Miền Bắc');
      }
    });
  });

  describe('Tìm kiếm đại lý qua findAllCustomers', () => {
    it('phải tìm được đại lý khi gọi findAllCustomers với search không dấu', async () => {
      const list = await service.findAllCustomers({ search: 'phuong nam' });
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.some((c) => c.name.includes('Phương Nam'))).toBe(true);
    });
  });
});
