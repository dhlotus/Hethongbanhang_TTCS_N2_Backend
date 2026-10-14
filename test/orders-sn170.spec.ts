import { CustomersService } from '../src/modules/customers/customers.service';
import { DiscountPoliciesService } from '../src/modules/discount-policies/discount-policies.service';
import { PriceListsService } from '../src/modules/price-lists/price-lists.service';
import { ProductsService } from '../src/modules/products/products.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { QueryOrdersDto } from '../src/modules/orders/dto/query-orders.dto';

/**
 * [SN-170]: Là Đại lý, tôi muốn theo dõi trạng thái các đơn hàng của mình,
 * để biết khi nào hàng tới mà không phải gọi cho nhân viên kinh doanh.
 * - AC1: Danh sách đơn hàng kèm trạng thái, ngày giao dự kiến, tổng tiền
 * - AC2: Chi tiết số lượng thực giao nếu thiếu (Short Delivery)
 * - AC3: Phân quyền Scoped Data Isolation - Đại lý chỉ thấy đơn hàng của chính mình
 */
describe('Kiểm thử chức năng SN-170 - Cổng Đại lý Theo dõi Đơn hàng & Giao thiếu', () => {
  let customersService: CustomersService;
  let productsService: ProductsService;
  let priceListsService: PriceListsService;
  let discountPoliciesService: DiscountPoliciesService;
  let ordersService: OrdersService;
  let ordersController: OrdersController;

  const CUSTOMER_ID = 'cust-dl-0004';

  beforeEach(() => {
    customersService = new CustomersService();
    productsService = new ProductsService();
    priceListsService = new PriceListsService();
    discountPoliciesService = new DiscountPoliciesService();

    ordersService = new OrdersService(
      customersService,
      priceListsService,
      discountPoliciesService,
      productsService,
    );

    ordersController = new OrdersController(ordersService);
  });

  it('TC-170-01: Chỉ xem được danh sách đơn hàng của chính mình (Scoped Customer ID)', async () => {
    const response = await ordersService.findOrdersByCustomer(CUSTOMER_ID, {});

    expect(response).toBeDefined();
    expect(response.data.length).toBeGreaterThan(0);

    for (const order of response.data) {
      expect(order.customerId).toBe(CUSTOMER_ID);
    }

    const hasOtherCustomer = response.data.some((order) => order.customerId !== CUSTOMER_ID);
    expect(hasOtherCustomer).toBe(false);
  });

  it('TC-170-02: Dữ liệu đơn hàng trả về có đầy đủ các trường thông tin bắt buộc', async () => {
    const response = await ordersService.findOrdersByCustomer(CUSTOMER_ID, {});
    const sampleOrder = response.data[0];

    expect(sampleOrder.id).toBeDefined();
    expect(sampleOrder.orderCode).toBeDefined();
    expect(sampleOrder.status).toBeDefined();
    expect(sampleOrder.deliveryDate).toBeDefined();
    expect(sampleOrder.grandTotal).toBeGreaterThan(0);
    expect(sampleOrder.createdAt).toBeDefined();
    expect(Array.isArray(sampleOrder.lines)).toBe(true);
  });

  it('TC-170-03: Kiểm tra chi tiết đơn hàng giao thiếu (Short Delivery) và lý do giao thiếu', async () => {
    const order = await ordersService.findOrderById('ord-004');

    expect(order).toBeDefined();
    expect(order.isShortDelivery).toBe(true);
    expect(order.status).toBe(OrderStatus.DELIVERED);

    const teaLine = order.lines.find((line) => line.productSku === 'LH-TEA-240ML');
    expect(teaLine).toBeDefined();
    expect(teaLine?.quantity).toBe(25);
    expect(teaLine?.deliveredQuantity).toBe(20);
    expect(teaLine?.isShortDelivery).toBe(true);
    expect(teaLine?.shortDeliveryReason).toBeDefined();

    const nutLine = order.lines.find((line) => line.productSku === 'LH-NUT-180ML');
    expect(nutLine).toBeDefined();
    expect(nutLine?.quantity).toBe(12);
    expect(nutLine?.deliveredQuantity).toBe(12);
    expect(nutLine?.isShortDelivery).toBe(false);
  });

  it('TC-170-04: Lọc đơn hàng theo trạng thái chính xác', async () => {
    const deliveredQuery: QueryOrdersDto = { status: OrderStatus.DELIVERED };
    const deliveredResponse = await ordersService.findOrdersByCustomer(CUSTOMER_ID, deliveredQuery);

    expect(deliveredResponse.data.length).toBeGreaterThan(0);
    for (const order of deliveredResponse.data) {
      expect(order.status).toBe(OrderStatus.DELIVERED);
    }
  });

  it('TC-170-05: Tìm kiếm đơn hàng theo mã đơn hàng hoặc thông tin người nhận', async () => {
    const searchQuery: QueryOrdersDto = { search: 'DH2610-10015' };
    const searchResponse = await ordersService.findOrdersByCustomer(CUSTOMER_ID, searchQuery);

    expect(searchResponse.data.length).toBe(1);
    expect(searchResponse.data[0].id).toBe('ord-004');
    expect(searchResponse.data[0].orderCode).toBe('DH2610-10015');
  });

  it('TC-170-06: GET /portal/my-orders tự động nhận diện đại lý và trả về đúng dữ liệu', async () => {
    const result = await ordersController.getMyOrders({}, {
      userId: 'usr-dl-0004',
      username: 'anphat',
      email: 'anphat@example.com',
      agencyId: CUSTOMER_ID,
      roles: [UserRole.CUSTOMER],
    });

    expect(result).toBeDefined();
    expect(result.data.length).toBeGreaterThan(0);
    for (const order of result.data) {
      expect(order.customerId).toBe(CUSTOMER_ID);
    }
  });
});
