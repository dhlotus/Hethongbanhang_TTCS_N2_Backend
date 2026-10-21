import { CustomersService } from '../src/modules/customers/customers.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';
import { PriceListsService } from '../src/modules/price-lists/price-lists.service';
import { DiscountPoliciesService } from '../src/modules/discount-policies/discount-policies.service';

describe('Order Management & Filtering for Sales Manager & Rep (JIRA SN-46)', () => {
  let customersService: CustomersService;
  let priceListsService: PriceListsService;
  let discountPoliciesService: DiscountPoliciesService;
  let ordersService: OrdersService;

  beforeEach(() => {
    customersService = new CustomersService();
    priceListsService = new PriceListsService();
    discountPoliciesService = new DiscountPoliciesService();
    ordersService = new OrdersService(
      customersService,
      priceListsService,
      discountPoliciesService,
    );
  });

  describe('1. Bộ lọc đơn hàng đa tiêu chí (SN-46)', () => {
    it('TC-01: Lọc đơn hàng theo trạng thái chính xác', async () => {
      const res = await ordersService.findAllOrders({ status: OrderStatus.APPROVED });
      expect(res.data.length).toBeGreaterThanOrEqual(1);
      expect(res.data.every((o) => o.status === OrderStatus.APPROVED)).toBe(true);
    });

    it('TC-02: Lọc đơn hàng theo đại lý (customerId)', async () => {
      const res = await ordersService.findAllOrders({ customerId: 'cust-001' });
      expect(res.data.length).toBeGreaterThanOrEqual(1);
      expect(res.data.every((o) => ['cust-001', 'cust-dl-0001'].includes(o.customerId))).toBe(true);
    });

    it('TC-03: Lọc đơn hàng theo nhân viên kinh doanh (salesRepId / assignedUser)', async () => {
      const res = await ordersService.findAllOrders({ salesRepId: 'usr-sale-01' });
      expect(res.data.length).toBeGreaterThanOrEqual(2);
      expect(res.data.every((o) => o.salesRepId === 'usr-sale-01')).toBe(true);
    });

    it('TC-04: Lọc đơn hàng theo khu vực địa lý (region: Miền Bắc, Miền Trung, Miền Nam)', async () => {
      const northRes = await ordersService.findAllOrders({ region: 'Miền Bắc' });
      expect(northRes.data.length).toBeGreaterThanOrEqual(1);
      expect(northRes.data.some((o) => o.region === 'Miền Bắc')).toBe(true);

      const southRes = await ordersService.findAllOrders({ region: 'Miền Nam' });
      expect(southRes.data.length).toBeGreaterThanOrEqual(1);
    });

    it('TC-05: Lọc đơn hàng theo khoảng thời gian (fromDate, toDate)', async () => {
      const res = await ordersService.findAllOrders({
        fromDate: '2026-10-06',
        toDate: '2026-10-07',
      });
      expect(res.data.length).toBeGreaterThanOrEqual(1);
      for (const order of res.data) {
        const time = new Date(order.createdAt).getTime();
        expect(time).toBeGreaterThanOrEqual(new Date('2026-10-06').getTime());
      }
    });

    it('TC-06: Tìm kiếm từ khóa theo mã đơn, mã đại lý, tên đại lý', async () => {
      const res = await ordersService.findAllOrders({ search: 'Minh Khang' });
      expect(res.data.length).toBeGreaterThanOrEqual(1);
      expect(res.data[0].customerName).toContain('Minh Khang');
    });
  });

  describe('2. Hiển thị tổng tiền của tập kết quả đang lọc (SN-46 Core)', () => {
    it('TC-07: Tính đúng tổng tiền (totalAmount) của tập kết quả thỏa mãn bộ lọc', async () => {
      const allOrders = await ordersService.findAllOrders({});
      expect(allOrders.totalAmount).toBeGreaterThan(0);

      // Lọc riêng đơn có status APPROVED
      const approvedOrders = await ordersService.findAllOrders({ status: OrderStatus.APPROVED });
      const expectedTotal = approvedOrders.data.reduce((sum, o) => sum + o.grandTotal, 0);
      expect(approvedOrders.totalAmount).toBe(expectedTotal);
    });
  });

  describe('3. Phân quyền dữ liệu theo vai trò người dùng (SN-46 RBAC)', () => {
    it('TC-08: Nhân viên kinh doanh (SALES_REP) chỉ thấy đơn do mình phụ trách', async () => {
      const salesRepUser = {
        id: 'usr-sale-01',
        role: 'SALES_REP',
        username: 'tranvanlong',
      };

      const res = await ordersService.findAllOrders({}, salesRepUser);
      expect(res.data.length).toBeGreaterThanOrEqual(1);
      // Toàn bộ đơn trả về phải thuộc về usr-sale-01
      expect(res.data.every((o) => o.salesRepId === 'usr-sale-01')).toBe(true);
    });

    it('TC-09: Quản lý kinh doanh (SALES_MANAGER) xem được toàn bộ đơn hàng của công ty', async () => {
      const managerUser = {
        id: 'usr-mgr-01',
        role: 'SALES_MANAGER',
        username: 'salesmanager',
      };

      const res = await ordersService.findAllOrders({}, managerUser);
      // Phải nhìn thấy đơn của nhiều nhân viên khác nhau
      const uniqueReps = new Set(res.data.map((o) => o.salesRepId));
      expect(uniqueReps.size).toBeGreaterThan(1);
    });
  });
});
