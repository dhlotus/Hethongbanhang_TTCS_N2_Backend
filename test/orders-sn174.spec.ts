import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomersService } from '../src/modules/customers/customers.service';
import { DiscountPoliciesService } from '../src/modules/discount-policies/discount-policies.service';
import { PriceListsService } from '../src/modules/price-lists/price-lists.service';
import { ProductsService } from '../src/modules/products/products.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';

/**
 * [SN-174]: Là Đại lý, tôi muốn đặt lại một đơn đã mua trước đây,
 * để lấy hàng định kỳ mà không phải chọn lại từng mặt hàng.
 * - AC1: Tự động tải lại toàn bộ dòng hàng từ đơn cũ
 * - AC2: Loại bỏ và cảnh báo các mặt hàng đã ngừng kinh doanh (Discontinued Items)
 * - AC3: Áp lại giá niêm yết và chiết khấu theo bảng giá hiện hành
 * - AC4: Cho phép chọn/bỏ chọn dòng hàng hoặc điều chỉnh số lượng đặt lại
 * - AC5: Bảo mật Scoped Authorization - Chặn thao tác trên đơn hàng của đại lý khác
 */
describe('Kiểm thử chức năng SN-174 - Đại lý Đặt Lại Đơn Hàng Cũ Định Kỳ (1-Click Reorder)', () => {
  let customersService: CustomersService;
  let productsService: ProductsService;
  let priceListsService: PriceListsService;
  let discountPoliciesService: DiscountPoliciesService;
  let ordersService: OrdersService;
  let ordersController: OrdersController;

  const SOURCE_ORDER_ID = 'ord-005';
  const VALID_CUSTOMER_ID = 'cust-dl-0005';

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

  it('TC-174-01: Preview reorder phát hiện chính xác sản phẩm ngừng kinh doanh và đưa vào danh sách cảnh báo', async () => {
    const preview = await ordersService.getReorderPreview(SOURCE_ORDER_ID, VALID_CUSTOMER_ID);

    expect(preview).toBeDefined();
    expect(preview.orderId).toBe(SOURCE_ORDER_ID);
    expect(preview.orderCode).toBe('DH2609-09880');
    expect(preview.customerId).toBe(VALID_CUSTOMER_ID);

    // Có 1 sản phẩm ngừng kinh doanh: prod-011 (LH-OLD-COFFEE-CAN)
    expect(preview.discontinuedItems.length).toBe(1);
    expect(preview.discontinuedItems[0].productSku).toBe('LH-OLD-COFFEE-CAN');
    expect(preview.warningMessage).toBeDefined();

    // Có 1 sản phẩm còn bán: prod-001 (LH-MILK-900G)
    expect(preview.availableItems.length).toBe(1);
    expect(preview.availableItems[0].productSku).toBe('LH-MILK-900G');
  });

  it('TC-174-02: Tái áp giá niêm yết và chiết khấu hiện hành theo bảng giá hiệu lực', async () => {
    const preview = await ordersService.getReorderPreview(SOURCE_ORDER_ID, VALID_CUSTOMER_ID);
    const item = preview.availableItems[0];

    expect(item.currentListPrice).toBeGreaterThan(0);
    expect(item.currentUnitPrice).toBeGreaterThan(0);
    expect(item.currentUnitPrice).toBeLessThanOrEqual(item.currentListPrice);
  });

  it('TC-174-03: Thực hiện đặt lại toàn bộ đơn hàng (Reorder) tạo ra đơn hàng mới ở trạng thái PENDING', async () => {
    const result = await ordersService.reorder(
      SOURCE_ORDER_ID,
      {
        deliveryDate: '2026-10-28',
        note: 'Đơn đặt lại định kỳ hàng tháng',
      },
      VALID_CUSTOMER_ID,
    );

    expect(result).toBeDefined();
    expect(result.newOrder).toBeDefined();
    expect(result.newOrder.id).not.toBe(SOURCE_ORDER_ID);
    expect(result.newOrder.orderCode).toMatch(/^DH\d{4}-\d+/);
    expect(result.newOrder.customerId).toBe(VALID_CUSTOMER_ID);
    expect(result.newOrder.status).toBe(OrderStatus.PENDING);
    expect(result.newOrder.lines.length).toBe(1);
    expect(result.newOrder.lines[0].productSku).toBe('LH-MILK-900G');
  });

  it('TC-174-04: Đặt lại một phần dòng hàng và tùy chỉnh số lượng đặt mới', async () => {
    const preview = await ordersService.getReorderPreview(SOURCE_ORDER_ID, VALID_CUSTOMER_ID);
    const lineToKeep = preview.availableItems[0];

    const result = await ordersService.reorder(
      SOURCE_ORDER_ID,
      {
        deliveryDate: '2026-10-29',
        items: [
          {
            productSku: lineToKeep.productSku,
            quantity: 10,
          },
        ],
      },
      VALID_CUSTOMER_ID,
    );

    expect(result.newOrder.lines.length).toBe(1);
    expect(result.newOrder.lines[0].quantity).toBe(10);
  });

  it('TC-174-05: Chặn hành vi truy cập trái phép đơn hàng của đại lý khác (Security Scope)', async () => {
    const OTHER_CUSTOMER_ID = 'cust-dl-0004';

    await expect(
      ordersService.getReorderPreview(SOURCE_ORDER_ID, OTHER_CUSTOMER_ID),
    ).rejects.toThrow(BadRequestException);

    await expect(
      ordersService.reorder(SOURCE_ORDER_ID, {}, OTHER_CUSTOMER_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('TC-174-06: Endpoint GET /:id/reorder-preview và POST /:id/reorder ủy quyền hợp lệ qua Controller', async () => {
    const preview = await ordersController.getReorderPreview(SOURCE_ORDER_ID, VALID_CUSTOMER_ID);
    expect(preview.orderId).toBe(SOURCE_ORDER_ID);
    expect(preview.discontinuedItems.length).toBe(1);

    const reorderResult = await ordersController.reorder(
      SOURCE_ORDER_ID,
      { deliveryDate: '2026-10-30', note: 'Đặt lại qua Controller' },
      VALID_CUSTOMER_ID,
    );
    expect(reorderResult.newOrder).toBeDefined();
    expect(reorderResult.newOrder.status).toBe(OrderStatus.PENDING);
  });
});
