import { CustomersService } from '../src/modules/customers/customers.service';
import { DiscountPoliciesService } from '../src/modules/discount-policies/discount-policies.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';
import { PriceListsService } from '../src/modules/price-lists/price-lists.service';

describe('Order Cloning (SN-48)', () => {
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

  it('sao chép toàn bộ dòng hàng của đơn cũ sang đơn mới (SN-48)', async () => {
    // ord-001 là đơn mẫu có sẵn trong seed: 2 dòng hàng, status APPROVED
    const sourceOrder = await ordersService.findOrderById('ord-001');
    expect(sourceOrder.status).toBe(OrderStatus.APPROVED);
    expect(sourceOrder.lines.length).toBe(2);

    const clonedOrder = await ordersService.cloneOrder('ord-001');

    // 1. Kiểm tra sao chép toàn bộ dòng hàng
    expect(clonedOrder.id).not.toBe(sourceOrder.id);
    expect(clonedOrder.orderCode).not.toBe(sourceOrder.orderCode);
    expect(clonedOrder.customerId).toBe(sourceOrder.customerId);
    expect(clonedOrder.lines.length).toBe(sourceOrder.lines.length);

    expect(clonedOrder.lines[0].productId).toBe(sourceOrder.lines[0].productId);
    expect(clonedOrder.lines[0].productSku).toBe(sourceOrder.lines[0].productSku);
    expect(clonedOrder.lines[0].quantity).toBe(sourceOrder.lines[0].quantity);
    expect(clonedOrder.lines[0].unit).toBe(sourceOrder.lines[0].unit);

    expect(clonedOrder.lines[1].productId).toBe(sourceOrder.lines[1].productId);
    expect(clonedOrder.lines[1].quantity).toBe(sourceOrder.lines[1].quantity);

    // 2. Điểm giao hàng được kế thừa
    expect(clonedOrder.deliveryPoint?.address).toBe(sourceOrder.deliveryPoint?.address);
  });

  it('bản sao luôn bắt đầu ở trạng thái Nháp (DRAFT) dù đơn gốc là APPROVED (SN-48)', async () => {
    const sourceOrder = await ordersService.findOrderById('ord-001');
    expect(sourceOrder.status).toBe(OrderStatus.APPROVED);

    const clonedOrder = await ordersService.cloneOrder('ord-001');

    // Bản sao BẮT BUỘC luôn ở trạng thái Nháp
    expect(clonedOrder.status).toBe(OrderStatus.DRAFT);
  });

  it('giá và chiết khấu được áp lại theo bảng giá hiện hành, không kế thừa giá cũ (SN-48)', async () => {
    // Tạo đơn gốc với giá cố ý khác giá hiện hành
    const source = await ordersService.createOrder({
      customerId: 'cust-001',
      status: OrderStatus.PENDING,
      lines: [
        {
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
          unit: 'Lon',
          baseUnit: 'Lon',
          conversionRate: 1,
          quantity: 50,
          listPrice: 9999999, // Giá cũ không còn áp dụng
          unitPrice: 8888888, // Giá cũ không còn áp dụng
          discountPercent: 11.11,
        },
      ],
    });

    // Thực hiện sao chép đơn
    const cloned = await ordersService.cloneOrder(source.id);

    // Bản sao phải áp theo bảng giá hiện hành (pl-002: 440.000 đ) và chiết khấu theo chính sách hiện hành (5%)
    expect(cloned.lines[0].listPrice).toBe(440000);
    expect(cloned.lines[0].discountPercent).toBe(5);
    expect(cloned.lines[0].unitPrice).toBe(418000);
    expect(cloned.grandTotal).toBe(20900000); // 50 * 418.000 = 20.900.000 đ
    expect(cloned.status).toBe(OrderStatus.DRAFT);
  });

  it('bản sao luôn ở trạng thái DRAFT kể cả khi tổng tiền đơn hàng làm vượt hạn mức công nợ (SN-48)', async () => {
    // cust-001 có creditLimit = 50.000.000 đ. Tạo đơn số lượng lớn vượt hạn mức
    const source = await ordersService.createOrder({
      customerId: 'cust-001',
      status: OrderStatus.PENDING,
      lines: [
        {
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
          unit: 'Lon',
          baseUnit: 'Lon',
          conversionRate: 1,
          quantity: 200, // 200 * 418.000 = 83.600.000 > 50.000.000
        },
      ],
    });

    const cloned = await ordersService.cloneOrder(source.id);

    // Bản sao BẮT BUỘC luôn bắt đầu ở trạng thái Nháp (DRAFT) theo đúng AC của SN-48
    expect(cloned.status).toBe(OrderStatus.DRAFT);
  });
});
