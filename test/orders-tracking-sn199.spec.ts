import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { OrdersModule } from '../src/modules/orders/orders.module';
import { DatabaseModule } from '../src/database/database.module';
import { AuthModule } from '../src/modules/auth/auth.module';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';

describe('SN-199: Theo dõi trạng thái giao hàng & Số lượng thực giao (Đại lý)', () => {
  let ordersService: OrdersService;
  let ordersController: OrdersController;

  const mockAgencyUser1: ICurrentUser = {
    userId: 'usr-agent-01',
    username: 'daily_minhkhang',
    email: 'minhkhang@loha.vn',
    roles: [UserRole.CUSTOMER],
    agencyId: 'cust-001',
    customerId: 'cust-001',
  };

  const mockAgencyUser2: ICurrentUser = {
    userId: 'usr-agent-02',
    username: 'daily_toancau',
    email: 'toancau@loha.vn',
    roles: [UserRole.CUSTOMER],
    agencyId: 'cust-dl-0002',
    customerId: 'cust-dl-0002',
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, OrdersModule],
    }).compile();

    ordersService = moduleRef.get<OrdersService>(OrdersService);
    ordersController = moduleRef.get<OrdersController>(OrdersController);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Đơn mới được duyệt (APPROVED)
  // ──────────────────────────────────────────────────────────────────────────
  it('1. Đơn mới được duyệt: có trạng thái APPROVED và mốc thời gian approvedAt thực tế', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 20 });
    const approvedOrder = result.data.find((o) => o.status === OrderStatus.APPROVED);

    expect(approvedOrder).toBeDefined();
    if (approvedOrder) {
      expect(approvedOrder.status).toBe(OrderStatus.APPROVED);
      expect(approvedOrder.approvedAt).toBeDefined();
      expect(new Date(approvedOrder.approvedAt!).getTime()).not.toBeNaN();
      // Đơn mới duyệt chưa chuyển sang soạn hay xuất kho
      expect(approvedOrder.dispatchedAt).toBeUndefined();
      expect(approvedOrder.deliveredAt).toBeUndefined();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Đơn đang soạn hàng (PROCESSING)
  // ──────────────────────────────────────────────────────────────────────────
  it('2. Đơn đang soạn hàng: có trạng thái PROCESSING, ghi nhận approvedAt và processingAt', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 20 });
    const processingOrder = result.data.find((o) => o.status === OrderStatus.PROCESSING);

    expect(processingOrder).toBeDefined();
    if (processingOrder) {
      expect(processingOrder.status).toBe(OrderStatus.PROCESSING);
      expect(processingOrder.approvedAt).toBeDefined();
      expect(processingOrder.processingAt).toBeDefined();
      expect(new Date(processingOrder.processingAt!).getTime()).not.toBeNaN();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Đơn đã xuất kho (DISPATCHED)
  // ──────────────────────────────────────────────────────────────────────────
  it('3. Đơn đã xuất kho: có trạng thái DISPATCHED, mốc dispatchedAt và số lượng xuất kho', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 20 });
    const dispatchedOrder = result.data.find((o) => o.status === OrderStatus.DISPATCHED);

    expect(dispatchedOrder).toBeDefined();
    if (dispatchedOrder) {
      expect(dispatchedOrder.status).toBe(OrderStatus.DISPATCHED);
      expect(dispatchedOrder.dispatchedAt).toBeDefined();
      expect(new Date(dispatchedOrder.dispatchedAt!).getTime()).not.toBeNaN();
      // Phân biệt: Dòng hàng có dispatchedQuantity ghi nhận đã xuất kho
      expect(dispatchedOrder.lines.length).toBeGreaterThan(0);
      expect(dispatchedOrder.lines[0].dispatchedQuantity).toBeDefined();
      expect(dispatchedOrder.lines[0].dispatchedQuantity).toBe(dispatchedOrder.lines[0].quantity);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Đơn đang giao (SHIPPED)
  // ──────────────────────────────────────────────────────────────────────────
  it('4. Đơn đang giao: có trạng thái SHIPPED, có mốc thời gian shippedAt, thông tin xe và tài xế', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 20 });
    const shippedOrder = result.data.find((o) => o.status === OrderStatus.SHIPPED);

    expect(shippedOrder).toBeDefined();
    if (shippedOrder) {
      expect(shippedOrder.status).toBe(OrderStatus.SHIPPED);
      expect(shippedOrder.shippedAt).toBeDefined();
      expect(shippedOrder.deliveryPoint).toBeDefined();
      expect(shippedOrder.deliveryPoint?.name).toBeDefined();
      expect(shippedOrder.carrierName).toBeDefined();
      expect(shippedOrder.licensePlate).toBeDefined();
      expect(shippedOrder.driverName).toBeDefined();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Đơn đã giao hoàn tất (DELIVERED)
  // ──────────────────────────────────────────────────────────────────────────
  it('5. Đơn đã giao hoàn tất: có trạng thái DELIVERED và mốc thời gian deliveredAt', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 20 });
    const deliveredOrder = result.data.find((o) => o.status === OrderStatus.DELIVERED);

    expect(deliveredOrder).toBeDefined();
    if (deliveredOrder) {
      expect(deliveredOrder.status).toBe(OrderStatus.DELIVERED);
      expect(deliveredOrder.deliveredAt).toBeDefined();
      expect(new Date(deliveredOrder.deliveredAt!).getTime()).not.toBeNaN();
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Đơn giao đủ số lượng
  // ──────────────────────────────────────────────────────────────────────────
  it('6. Đơn giao đủ số lượng: deliveredQuantity bằng quantity ban đầu, isShortDelivery là false', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 20 });
    const fullDeliveredOrder = result.data.find(
      (o) => o.status === OrderStatus.DELIVERED && o.isShortDelivery !== true,
    );

    expect(fullDeliveredOrder).toBeDefined();
    if (fullDeliveredOrder) {
      expect(fullDeliveredOrder.isShortDelivery).toBe(false);
      for (const line of fullDeliveredOrder.lines) {
        if (line.deliveredQuantity !== undefined) {
          expect(line.deliveredQuantity).toBe(line.quantity);
          const shortQuantity = Math.max(0, line.quantity - line.deliveredQuantity);
          expect(shortQuantity).toBe(0);
        }
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Đơn giao thiếu một hoặc nhiều sản phẩm
  // ──────────────────────────────────────────────────────────────────────────
  it('7. Đơn giao thiếu: deliveredQuantity < quantity, tính đúng SL thiếu và có lý do giao thiếu', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 20 });
    const shortOrder = result.data.find((o) => o.isShortDelivery === true);

    expect(shortOrder).toBeDefined();
    if (shortOrder) {
      expect(shortOrder.isShortDelivery).toBe(true);
      const shortLine = shortOrder.lines.find(
        (l) => l.deliveredQuantity !== undefined && l.deliveredQuantity < l.quantity,
      );
      expect(shortLine).toBeDefined();
      if (shortLine) {
        expect(shortLine.deliveredQuantity).toBeLessThan(shortLine.quantity);
        const missingQty = Math.max(0, shortLine.quantity - (shortLine.deliveredQuantity || 0));
        expect(missingQty).toBe(shortLine.quantity - shortLine.deliveredQuantity!);
        expect(missingQty).toBeGreaterThan(0);
        expect(shortLine.shortDeliveryReason).toBeDefined();
        expect(shortLine.shortDeliveryReason!.length).toBeGreaterThan(0);
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Đơn chưa có dữ liệu thực giao
  // ──────────────────────────────────────────────────────────────────────────
  it('8. Đơn chưa có dữ liệu thực giao: deliveredQuantity là undefined, không tự động gán bằng quantity', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 20 });
    // Các đơn APPROVED, PROCESSING, DISPATCHED, SHIPPED chưa giao nhận
    const pendingDeliveryOrder = result.data.find(
      (o) => o.status === OrderStatus.APPROVED || o.status === OrderStatus.SHIPPED,
    );

    expect(pendingDeliveryOrder).toBeDefined();
    if (pendingDeliveryOrder) {
      // Dòng hàng chưa có xác nhận giao thì deliveredQuantity không được tự gán
      const hasUnconfirmedLine = pendingDeliveryOrder.lines.some(
        (l) => l.deliveredQuantity === undefined,
      );
      expect(hasUnconfirmedLine).toBe(true);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. Backend trả về dữ liệu rỗng hoặc lỗi
  // ──────────────────────────────────────────────────────────────────────────
  it('9. Backend trả về dữ liệu rỗng: khi customer không có đơn hàng thì trả mảng data rỗng chuẩn cấu trúc', async () => {
    const result = await ordersService.findOrdersByCustomer('cust-non-existent-999', {
      page: 1,
      limit: 10,
    });
    expect(result).toBeDefined();
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);

    // Tìm kiếm đơn không tồn tại
    await expect(ordersService.findOrderById('ord-non-existent-999')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 10. Tải lại trang vẫn hiển thị đúng dữ liệu (Tính nhất quán của dữ liệu)
  // ──────────────────────────────────────────────────────────────────────────
  it('10. Nhất quán dữ liệu: truy vấn lặp lại nhiều lần hoặc theo ID đơn trả về đúng thông tin', async () => {
    const firstCall = await ordersService.findOrdersByCustomer('cust-001', { page: 1, limit: 10 });
    expect(firstCall.data.length).toBeGreaterThan(0);
    const orderId = firstCall.data[0].id;

    const secondCall = await ordersService.findOrderById(orderId);
    expect(secondCall).toBeDefined();
    expect(secondCall.id).toBe(orderId);
    expect(secondCall.orderCode).toBe(firstCall.data[0].orderCode);
    expect(secondCall.status).toBe(firstCall.data[0].status);
    expect(secondCall.lines.length).toBe(firstCall.data[0].lines.length);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 11. Đại lý không được truy cập đơn của đại lý khác (Cách ly dữ liệu)
  // ──────────────────────────────────────────────────────────────────────────
  it('11. Bảo mật cách ly dữ liệu: Đại lý cust-001 bị chặn 403 Forbidden nếu cố tình truy cập đơn của đại lý khác', async () => {
    // ord-002 thuộc về đại lý cust-dl-0002
    const otherOrder = await ordersService.findOrderById('ord-002');
    expect(otherOrder.customerId).toBe('cust-dl-0002');

    // Đại lý cust-001 gọi qua API portal/my-orders/:id của ord-002 -> Phải bị chặn 403
    await expect(ordersController.getMyOrderById('ord-002', mockAgencyUser1)).rejects.toThrow(
      ForbiddenException,
    );

    // Đại lý cust-001 gọi qua API getOrderById của ord-002 kèm currentUser -> Phải bị chặn 403
    await expect(
      ordersController.getOrderById('ord-002', undefined, mockAgencyUser1),
    ).rejects.toThrow(ForbiddenException);

    // Ngược lại, đại lý cust-dl-0002 truy cập đơn ord-002 của chính mình -> Thành công
    const allowed = await ordersController.getMyOrderById('ord-002', mockAgencyUser2);
    expect(allowed).toBeDefined();
    expect(allowed.id).toBe('ord-002');
  });
});
