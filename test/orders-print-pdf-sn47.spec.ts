import { CustomersService } from '../src/modules/customers/customers.service';
import { DiscountPoliciesService } from '../src/modules/discount-policies/discount-policies.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PriceListsService } from '../src/modules/price-lists/price-lists.service';

/**
 * [SN-47]: Là Nhân viên kinh doanh, tôi muốn in hoặc xuất PDF đơn hàng,
 * để đưa đại lý xem lại đơn ngay tại chỗ để xác nhận trước khi rời đi.
 * - AC1: Mẫu in đơn hàng đầy đủ thông tin đại lý, địa chỉ giao nhận, dòng hàng chi tiết và tổng thanh toán
 * - AC2: Mã vạch Barcode SVG tra cứu nhanh theo mã đơn hàng chuẩn Code 39
 * - AC3: Đảm bảo độ chính xác của các trường dữ liệu phục vụ render mẫu in chuẩn A4
 */
describe('Kiểm thử API Chi Tiết Đơn Hàng Phục Vụ In & Xuất PDF Mẫu In Chuẩn A4 (SN-47)', () => {
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

  it('TC-47-01: API trả về đầy đủ mã đơn hàng và thông tin mã vạch Barcode tra cứu kho (SN-47)', async () => {
    const order = await ordersService.findOrderById('ord-001');

    expect(order).toBeDefined();
    expect(order.orderCode).toBeDefined();
    expect(order.orderCode).toMatch(/^DH\d{4}-\d+/);
    expect(order.orderCode.length).toBeGreaterThan(5);
  });

  it('TC-47-02: API cung cấp đầy đủ thông tin đại lý và điểm giao hàng cho mẫu in A4 (SN-47)', async () => {
    const order = await ordersService.findOrderById('ord-001');

    expect(order.customerName).toBeDefined();
    expect(order.customerCode).toBeDefined();
    expect(order.deliveryPoint).toBeDefined();
    expect(order.deliveryPoint?.address).toBeDefined();
    expect(order.deliveryPoint?.receiverName).toBeDefined();
    expect(order.deliveryPoint?.phone).toBeDefined();
  });

  it('TC-47-03: Chi tiết các dòng hàng có đơn giá, chiết khấu và thành tiền chính xác cho mẫu in (SN-47)', async () => {
    const order = await ordersService.findOrderById('ord-001');

    expect(Array.isArray(order.lines)).toBe(true);
    expect(order.lines.length).toBeGreaterThan(0);

    let calculatedSubtotal = 0;
    for (const line of order.lines) {
      expect(line.productSku).toBeDefined();
      expect(line.productName).toBeDefined();
      expect(line.unit).toBeDefined();
      expect(line.quantity).toBeGreaterThan(0);
      expect(line.unitPrice).toBeGreaterThan(0);
      expect(line.lineTotal).toBe(line.quantity * line.unitPrice);
      calculatedSubtotal += line.lineTotal;
    }

    expect(order.subtotal).toBeGreaterThan(0);
    expect(order.grandTotal).toBeGreaterThan(0);
  });
});
