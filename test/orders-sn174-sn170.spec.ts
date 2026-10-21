import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomersService } from '../src/modules/customers/customers.service';
import { DiscountPoliciesService } from '../src/modules/discount-policies/discount-policies.service';
import { PriceListsService } from '../src/modules/price-lists/price-lists.service';
import { ProductsService } from '../src/modules/products/products.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ReorderDto } from '../src/modules/orders/dto/create-order.dto';
import { QueryOrdersDto } from '../src/modules/orders/dto/query-orders.dto';

/**
 * Bộ kiểm thử toàn diện cho 2 User Story:
 * 1. SN-174: Đặt lại đơn hàng cũ định kỳ (Reorder với bảng giá hiện hành & loại bỏ hàng ngừng kinh doanh)
 * 2. SN-170: Theo dõi trạng thái đơn hàng & thông tin giao thiếu của Đại lý (Customer Portal & Short Delivery Tracking)
 *
 * Tuân thủ nghiêm ngặt 3 tiêu chuẩn:
 * - CODE_CONVENTION.md
 * - CODE_CONVENTION.docx
 * - UI_GUIDELINES.md
 */
describe('Kiểm thử chức năng SN-174 & SN-170 (Orders Service & Controller)', () => {
  let customersService: CustomersService;
  let productsService: ProductsService;
  let priceListsService: PriceListsService;
  let discountPoliciesService: DiscountPoliciesService;
  let ordersService: OrdersService;
  let ordersController: OrdersController;

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

  // ============================================================================
  // PHẦN 1: KIỂM THỬ SN-174 - ĐẶT LẠI ĐƠN HÀNG CŨ ĐỊNH KỲ (REORDER)
  // ============================================================================
  describe('SN-174: Đặt lại đơn hàng cũ định kỳ', () => {
    const SOURCE_ORDER_ID = 'ord-005'; // Đơn có 1 sản phẩm còn bán và 1 sản phẩm ngừng kinh doanh (prod-011)
    const VALID_CUSTOMER_ID = 'cust-001';

    it('TC-174-01: Preview reorder phát hiện chính xác sản phẩm ngừng kinh doanh và đưa vào danh sách cảnh báo', async () => {
      const preview = await ordersService.getReorderPreview(SOURCE_ORDER_ID, VALID_CUSTOMER_ID);

      expect(preview).toBeDefined();
      expect(preview.orderId).toBe(SOURCE_ORDER_ID);
      expect(preview.orderCode).toBe('DH2609-09880');
      expect(preview.customerId).toBe(VALID_CUSTOMER_ID);

      // Phải có đúng 1 mặt hàng ngừng kinh doanh (LH-OLD-COFFEE-CAN)
      expect(preview.discontinuedItems).toBeDefined();
      expect(preview.discontinuedItems.length).toBe(1);
      expect(preview.discontinuedItems[0].productSku).toBe('LH-OLD-COFFEE-CAN');
      expect(preview.discontinuedItems[0].reason).toContain('ngừng kinh doanh');

      // Phải có banner cảnh báo tự động
      expect(preview.warningMessage).toBeDefined();
      expect(preview.warningMessage).toContain('đã tự động loại bỏ 1 mặt hàng ngừng kinh doanh');

      // Danh sách khả dụng chỉ chứa các mặt hàng còn hoạt động
      expect(preview.availableItems.length).toBe(1);
      expect(preview.availableItems[0].productSku).toBe('LH-MILK-900G');
    });

    it('TC-174-02: Preview reorder áp lại bảng giá hiện hành và đánh dấu các mặt hàng có biến động giá', async () => {
      const preview = await ordersService.getReorderPreview(SOURCE_ORDER_ID, VALID_CUSTOMER_ID);
      const milkItem = preview.availableItems[0];

      // Đơn giá cũ trong đơn ord-005 là 4,940,000 đ
      expect(milkItem.oldUnitPrice).toBe(4940000);

      // Bảng giá hiện hành của AGENT_LEVEL_1 cho LH-MILK-900G:
      // Giá niêm yết hiện hành = 5,280,000 đ (440,000/lon * 12)
      // Chiết khấu bậc thang theo số lượng 4 thùng (48 lon) = 2% -> Đơn giá = 5,174,400 đ
      expect(milkItem.currentListPrice).toBe(5280000);
      expect(milkItem.currentUnitPrice).toBe(5174400);
      expect(milkItem.currentDiscountPercent).toBe(2);

      // Vì giá mới 5,174,400 đ khác giá cũ 4,940,000 đ nên cờ isPriceChanged là true
      expect(milkItem.isPriceChanged).toBe(true);
    });

    it('TC-174-03: Đặt lại toàn bộ đơn hàng hợp lệ - tự động loại bỏ hàng ngừng bán và sinh đơn mới với giá hiện hành', async () => {
      const reorderDto: ReorderDto = {
        deliveryDate: '2026-10-25',
        note: 'Đại lý Minh Khang đặt lại đơn định kỳ cuối tháng 10',
      };

      const result = await ordersService.reorder(SOURCE_ORDER_ID, reorderDto, VALID_CUSTOMER_ID);

      expect(result).toBeDefined();
      expect(result.discontinuedItems.length).toBe(1);
      expect(result.discontinuedItems[0].productSku).toBe('LH-OLD-COFFEE-CAN');
      expect(result.message).toContain('Đã đặt lại thành công đơn hàng mới');
      expect(result.message).toContain('Đã loại bỏ 1 mặt hàng ngừng kinh doanh');

      // Đơn hàng mới
      const newOrder = result.newOrder;
      expect(newOrder.id).toBeDefined();
      expect(newOrder.id).not.toBe(SOURCE_ORDER_ID);
      expect(newOrder.orderCode).toMatch(/^DH26/);
      expect([OrderStatus.PENDING, OrderStatus.PENDING_APPROVAL]).toContain(
        newOrder.status,
      );
      expect(newOrder.deliveryDate).toBe('2026-10-25');
      expect(newOrder.customerId).toBe(VALID_CUSTOMER_ID);

      // Đơn mới chỉ có 1 dòng (đã loại bỏ dòng ngừng kinh doanh)
      expect(newOrder.lines.length).toBe(1);
      const newLine = newOrder.lines[0];
      expect(newLine.productSku).toBe('LH-MILK-900G');
      expect(newLine.quantity).toBe(4);
      expect(newLine.unitPrice).toBe(5174400); // Áp giá hiện hành
      expect(newLine.lineTotal).toBe(4 * 5174400);

      // Tổng tiền đơn mới
      expect(newOrder.grandTotal).toBe(4 * 5174400);
      expect(newOrder.subtotal).toBe(4 * 5280000);
      expect(newOrder.totalDiscount).toBe(4 * 5280000 - 4 * 5174400);

      // Ghi chú đơn mới có cảnh báo tự động về việc loại bỏ hàng ngừng kinh doanh
      expect(newOrder.note).toContain('Đã loại bỏ 1 mặt hàng ngừng kinh doanh');
    });

    it('TC-174-04: Đặt lại một phần dòng hàng và tùy chỉnh số lượng đặt mới', async () => {
      const preview = await ordersService.getReorderPreview(SOURCE_ORDER_ID, VALID_CUSTOMER_ID);
      const milkLineId = preview.availableItems[0].lineId;

      const reorderDto: ReorderDto = {
        selectedLineIds: [milkLineId],
        items: [
          {
            productSku: 'LH-MILK-900G',
            quantity: 8, // Tăng số lượng từ 4 lên 8 thùng (96 lon -> đạt bậc chiết khấu 5%)
          },
        ],
        deliveryDate: '2026-10-28',
      };

      const result = await ordersService.reorder(SOURCE_ORDER_ID, reorderDto, VALID_CUSTOMER_ID);
      const newOrder = result.newOrder;

      expect(newOrder.lines.length).toBe(1);
      expect(newOrder.lines[0].quantity).toBe(8);
      // Với số lượng 8 thùng, áp mức chiết khấu bậc thang 5% (5,280,000 * 0.95 = 5,016,000 đ)
      expect(newOrder.lines[0].unitPrice).toBe(5016000);
      expect(newOrder.lines[0].lineTotal).toBe(8 * 5016000);
      expect(newOrder.grandTotal).toBe(8 * 5016000);
    });

    it('TC-174-05: Chặn đặt lại đơn khi không có dòng hàng nào được chọn hoặc tất cả dòng hàng được chọn đều đã ngừng kinh doanh', async () => {
      const reorderDto: ReorderDto = {
        selectedLineIds: ['line-005-2'], // line-005-2 là mặt hàng ngừng kinh doanh LH-OLD-COFFEE-CAN
      };

      await expect(
        ordersService.reorder(SOURCE_ORDER_ID, reorderDto, VALID_CUSTOMER_ID),
      ).rejects.toThrow(BadRequestException);

      await expect(
        ordersService.reorder(SOURCE_ORDER_ID, { selectedLineIds: [] }, VALID_CUSTOMER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-174-06: Bảo mật phân quyền - Đại lý không được phép xem trước hoặc đặt lại đơn hàng của đại lý khác', async () => {
      const OTHER_CUSTOMER_ID = 'cust-002';

      await expect(
        ordersService.getReorderPreview(SOURCE_ORDER_ID, OTHER_CUSTOMER_ID),
      ).rejects.toThrow(BadRequestException);

      await expect(
        ordersService.reorder(SOURCE_ORDER_ID, {}, OTHER_CUSTOMER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-174-07: Báo lỗi khi ID đơn hàng nguồn không tồn tại trong hệ thống', async () => {
      await expect(
        ordersService.getReorderPreview('ord-non-existent', VALID_CUSTOMER_ID),
      ).rejects.toThrow(NotFoundException);

      await expect(
        ordersService.reorder('ord-non-existent', {}, VALID_CUSTOMER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================================================
  // PHẦN 2: KIỂM THỬ SN-170 - THEO DÕI TRẠNG THÁI ĐƠN HÀNG CỦA ĐẠI LÝ
  // ============================================================================
  describe('SN-170: Theo dõi trạng thái đơn hàng của Đại lý', () => {
    const CUSTOMER_ID_1 = 'cust-001';
    const CUSTOMER_ID_2 = 'cust-002';

    it('TC-170-01: Chỉ xem được danh sách đơn hàng của chính mình (Scoped Customer ID)', async () => {
      const response = await ordersService.findOrdersByCustomer(CUSTOMER_ID_1, {});

      expect(response).toBeDefined();
      expect(response.data.length).toBeGreaterThan(0);

      // 100% đơn hàng trả về phải thuộc về CUSTOMER_ID_1 hoặc alias cust-dl-0001
      for (const order of response.data) {
        expect(['cust-001', 'cust-dl-0001']).toContain(order.customerId);
      }

      // Đảm bảo không lẫn đơn của khách hàng khác
      const hasOtherCustomer = response.data.some((order) => !['cust-001', 'cust-dl-0001'].includes(order.customerId));
      expect(hasOtherCustomer).toBe(false);
    });

    it('TC-170-02: Dữ liệu đơn hàng trả về có đầy đủ các trường thông tin bắt buộc theo quy chuẩn', async () => {
      const response = await ordersService.findOrdersByCustomer(CUSTOMER_ID_1, {});
      const sampleOrder = response.data[0];

      expect(sampleOrder.id).toBeDefined();
      expect(sampleOrder.orderCode).toBeDefined();
      expect(sampleOrder.status).toBeDefined();
      expect(sampleOrder.deliveryDate).toBeDefined();
      expect(sampleOrder.grandTotal).toBeGreaterThanOrEqual(0);
      expect(sampleOrder.createdAt).toBeDefined();
      expect(Array.isArray(sampleOrder.lines)).toBe(true);
    });

    it('TC-170-03: Kiểm tra chi tiết đơn hàng giao thiếu (Short Delivery) và lý do giao thiếu', async () => {
      // Đơn ord-004 là đơn giao thiếu điển hình
      const order = await ordersService.findOrderById('ord-004');

      expect(order).toBeDefined();
      expect(order.isShortDelivery).toBe(true);
      expect(order.status).toBe(OrderStatus.DELIVERED);

      // Dòng 1: Nước Yến (LH-NEST-70ML) bị giao thiếu (đặt 10, giao 8)
      const nestLine = order.lines.find((line) => line.productSku === 'LH-NEST-70ML');
      expect(nestLine).toBeDefined();
      expect(nestLine?.quantity).toBe(10);
      expect(nestLine?.deliveredQuantity).toBe(8);
      expect(nestLine?.isShortDelivery).toBe(true);
      expect(nestLine?.shortDeliveryReason).toBeDefined();
      expect(nestLine?.shortDeliveryReason?.length).toBeGreaterThan(0);

      // Dòng 2: Sữa Bột (LH-MILK-900G) được giao đủ (đặt 5, giao 5)
      const milkLine = order.lines.find((line) => line.productSku === 'LH-MILK-900G');
      expect(milkLine).toBeDefined();
      expect(milkLine?.quantity).toBe(5);
      expect(milkLine?.deliveredQuantity).toBe(5);
      expect(milkLine?.isShortDelivery).toBe(false);
    });

    it('TC-170-04: Lọc đơn hàng theo trạng thái chính xác', async () => {
      // Lọc các đơn đã giao (DELIVERED)
      const deliveredQuery: QueryOrdersDto = { status: OrderStatus.DELIVERED };
      const deliveredResponse = await ordersService.findOrdersByCustomer(CUSTOMER_ID_1, deliveredQuery);

      expect(deliveredResponse.data.length).toBeGreaterThan(0);
      for (const order of deliveredResponse.data) {
        expect(order.status).toBe(OrderStatus.DELIVERED);
      }

      // Lọc các đơn đang chờ duyệt (PENDING)
      const pendingQuery: QueryOrdersDto = { status: OrderStatus.PENDING };
      const pendingResponse = await ordersService.findOrdersByCustomer(CUSTOMER_ID_1, pendingQuery);
      for (const order of pendingResponse.data) {
        expect(order.status).toBe(OrderStatus.PENDING);
      }
    });

    it('TC-170-05: Tìm kiếm đơn hàng theo mã đơn hàng hoặc thông tin người nhận', async () => {
      const searchQuery: QueryOrdersDto = { search: 'DH2610-10015' };
      const searchResponse = await ordersService.findOrdersByCustomer(CUSTOMER_ID_1, searchQuery);

      expect(searchResponse.data.length).toBe(1);
      expect(searchResponse.data[0].id).toBe('ord-004');
      expect(searchResponse.data[0].orderCode).toBe('DH2610-10015');
    });

    it('TC-170-06: Đại lý khác nhau có danh sách đơn hàng hoàn toàn độc lập và tách biệt', async () => {
      const responseCust1 = await ordersService.findOrdersByCustomer(CUSTOMER_ID_1, {});
      const responseCust2 = await ordersService.findOrdersByCustomer(CUSTOMER_ID_2, {});

      const codesCust1 = responseCust1.data.map((o) => o.orderCode);
      const codesCust2 = responseCust2.data.map((o) => o.orderCode);

      // Không được có mã đơn nào trùng giữa 2 đại lý khác nhau
      const hasIntersection = codesCust1.some((code) => codesCust2.includes(code));
      expect(hasIntersection).toBe(false);
    });
  });

  // ============================================================================
  // PHẦN 3: KIỂM THỬ CONTROLLER ENDPOINTS (INTEGRATION FLOW)
  // ============================================================================
  describe('Tích hợp Controller Endpoints (SN-170 & SN-174)', () => {
    it('TC-INT-01: GET /portal/my-orders tự động nhận diện đại lý và trả về đúng dữ liệu', async () => {
      const result = await ordersController.getMyOrders({}, {
        userId: 'usr-dealer-1',
        username: 'dealer',
        email: 'dealer@minhkhang.vn',
        roles: [UserRole.CUSTOMER],
      });

      expect(result).toBeDefined();
      expect(result.data.length).toBeGreaterThan(0);
      for (const order of result.data) {
        expect(['cust-001', 'cust-dl-0001']).toContain(order.customerId);
      }
    });

    it('TC-INT-02: GET /:id/reorder-preview ủy quyền xử lý nghiệp vụ cho OrdersService', async () => {
      const preview = await ordersController.getReorderPreview('ord-005', 'cust-001');
      expect(preview.orderId).toBe('ord-005');
      expect(preview.discontinuedItems.length).toBe(1);
    });

    it('TC-INT-03: POST /:id/reorder thực thi tạo đơn mới thành công qua Controller', async () => {
      const result = await ordersController.reorder(
        'ord-005',
        { deliveryDate: '2026-10-30', note: 'Đặt lại qua Portal API' },
        'cust-001',
      );

      expect(result.newOrder).toBeDefined();
      expect(result.newOrder.orderCode).toBeDefined();
      expect([OrderStatus.PENDING, OrderStatus.PENDING_APPROVAL]).toContain(
        result.newOrder.status,
      );
    });
  });
});
