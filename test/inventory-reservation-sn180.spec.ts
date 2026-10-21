import { BadRequestException } from '@nestjs/common';
import { CustomersService } from '../src/modules/customers/customers.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ProductsService } from '../src/modules/products/products.service';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';
import { CreateOrderDto } from '../src/modules/orders/dto/create-order.dto';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';

describe('Quản lý Giữ chỗ Tồn kho & Nhả tồn tự động (JIRA SN-180 / Parent SN-229)', () => {
  let customersService: CustomersService;
  let productsService: ProductsService;
  let inventoryService: InventoryService;
  let ordersService: OrdersService;

  const mockManager: ICurrentUser = {
    userId: 'usr-manager-01',
    username: 'manager_hcm',
    email: 'manager@loha.vn',
    roles: [UserRole.SALES_MANAGER],
  };

  beforeEach(async () => {
    customersService = new CustomersService();
    productsService = new ProductsService();
    inventoryService = new InventoryService(productsService, undefined as any);
    ordersService = new OrdersService(
      customersService,
      undefined,
      undefined,
      productsService,
      inventoryService,
    );
    try {
      await customersService.unlockCustomer('cust-001');
    } catch {}
  });

  describe('1. Tiêu chí AC1: Đơn duyệt -> Tồn tương ứng được giữ chỗ 24h', () => {
    it('TC-01: Duyệt đơn thành công sẽ chuyển trạng thái APPROVED và ghi nhận giữ chỗ kho', async () => {
      // 1. Kiểm tra tồn ban đầu của SKU LH-MILK-900G
      const initialOverview = await inventoryService.getStockOverview();
      const initialProduct = initialOverview.find((p) => p.sku === 'LH-MILK-900G')!;
      const baseReserved = initialProduct.reservedQuantity;
      const baseAvailable = initialProduct.availableQuantity;

      // 2. Tạo đơn hàng PENDING với 5 Lon sữa bột (LH-MILK-900G)
      const orderDto: CreateOrderDto = {
        customerId: 'cust-001',
        deliveryDate: '2026-10-25',
        lines: [
          {
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            unit: 'Lon',
            baseUnit: 'Lon',
            conversionRate: 1,
            quantity: 5,
            listPrice: 520000,
            unitPrice: 520000,
            discountPercent: 0,
          },
        ],
        status: OrderStatus.PENDING,
      };

      const order = await ordersService.createOrder(orderDto);
      expect([OrderStatus.PENDING, OrderStatus.PENDING_APPROVAL]).toContain(order.status);

      // 3. Quản lý duyệt đơn hàng
      const approvedOrder = await ordersService.approveOrder(order.id, mockManager);
      expect(approvedOrder.status).toBe(OrderStatus.APPROVED);
      expect(approvedOrder.approvedAt).toBeDefined();
      expect(approvedOrder.reservedUntil).toBeDefined();

      // Hạn giữ chỗ phải là 24 giờ sau
      const reservedDiffHours =
        (approvedOrder.reservedUntil!.getTime() - approvedOrder.approvedAt!.getTime()) / (1000 * 60 * 60);
      expect(Math.round(reservedDiffHours)).toBe(24);

      // 4. Kiểm tra tồn sau khi duyệt: reserved tăng 5, available giảm 5
      const afterOverview = await inventoryService.getStockOverview();
      const afterProduct = afterOverview.find((p) => p.sku === 'LH-MILK-900G')!;
      expect(afterProduct.physicalQuantity).toBe(initialProduct.physicalQuantity);
      expect(afterProduct.reservedQuantity).toBe(baseReserved + 5);
      expect(afterProduct.availableQuantity).toBe(baseAvailable - 5);

      // 5. Kiểm tra danh sách activeReservations
      expect(afterProduct.activeReservations.length).toBeGreaterThan(0);
      const activeRes = afterProduct.activeReservations.find((r) => r.orderId === order.id);
      expect(activeRes).toBeDefined();
      expect(activeRes!.quantity).toBe(5);
    });
  });

  describe('2. Tiêu chí AC3: Kiểm tra tồn khả dụng & Rollback khi thiếu hàng', () => {
    it('TC-02: Từ chối duyệt đơn và giữ nguyên trạng thái cũ nếu đơn yêu cầu vượt tồn khả dụng tại thời điểm duyệt', async () => {
      // Đơn 1 cần 120 lon, Đơn 2 cần 100 lon (tổng 220 <= 232 khả dụng, cả 2 tạo PENDING hợp lệ)
      const order1 = await ordersService.createOrder({
        customerId: 'cust-001',
        deliveryDate: '2026-10-25',
        lines: [
          {
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            unit: 'Lon',
            baseUnit: 'Lon',
            conversionRate: 1,
            quantity: 120,
            listPrice: 520000,
            unitPrice: 520000,
          },
        ],
        status: OrderStatus.PENDING,
      });

      const order2 = await ordersService.createOrder({
        customerId: 'cust-001',
        deliveryDate: '2026-10-25',
        lines: [
          {
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            unit: 'Lon',
            baseUnit: 'Lon',
            conversionRate: 1,
            quantity: 100,
            listPrice: 520000,
            unitPrice: 520000,
          },
        ],
        status: OrderStatus.PENDING,
      });

      // Duyệt đơn 1 thành công (chiếm 120 lon)
      await ordersService.approveOrder(order1.id, mockManager);

      // Giả lập tồn kho thực tế bị giảm (ví dụ xuất hủy/hỏng 50 lon) khiến tồn khả dụng không còn đủ 100 lon
      const prod = await productsService.findById('LH-MILK-900G');
      await productsService.setStockQuantity(prod.id, 250);

      // Đơn 2 cố gắng duyệt -> Bị từ chối vì không đủ tồn khả dụng tại thời điểm duyệt
      await expect(ordersService.approveOrder(order2.id, mockManager)).rejects.toThrow(
        BadRequestException,
      );

      // Đơn 2 vẫn giữ nguyên trạng thái PENDING
      const currentOrder2 = await ordersService.findOrderById(order2.id);
      expect([OrderStatus.PENDING, OrderStatus.PENDING_APPROVAL]).toContain(currentOrder2.status);
    });
  });

  describe('3. Tiêu chí AC2: Hủy đơn & Tự động hoàn lại tồn khả dụng', () => {
    it('TC-03: Hủy đơn bắt buộc phải có lý do hủy', async () => {
      const orderDto: CreateOrderDto = {
        customerId: 'cust-001',
        lines: [
          {
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            unit: 'Lon',
            baseUnit: 'Lon',
            conversionRate: 1,
            quantity: 2,
            listPrice: 520000,
            unitPrice: 520000,
          },
        ],
        status: OrderStatus.PENDING,
      };
      const order = await ordersService.createOrder(orderDto);

      await expect(ordersService.cancelOrder(order.id, '')).rejects.toThrow(BadRequestException);
      await expect(ordersService.cancelOrder(order.id, '   ')).rejects.toThrow(BadRequestException);
    });

    it('TC-04: Hủy đơn đã APPROVED sẽ tự động nhả tồn giữ chỗ về kho khả dụng ngay lập tức', async () => {
      const initialOverview = await inventoryService.getStockOverview();
      const initialProduct = initialOverview.find((p) => p.sku === 'LH-MILK-900G')!;
      const baseReserved = initialProduct.reservedQuantity;
      const baseAvailable = initialProduct.availableQuantity;

      const orderDto: CreateOrderDto = {
        customerId: 'cust-001',
        lines: [
          {
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            unit: 'Lon',
            baseUnit: 'Lon',
            conversionRate: 1,
            quantity: 10,
            listPrice: 520000,
            unitPrice: 520000,
          },
        ],
        status: OrderStatus.PENDING,
      };

      const order = await ordersService.createOrder(orderDto);
      await ordersService.approveOrder(order.id, mockManager);

      // Kiểm tra đang giữ chỗ tăng 10 lon
      let overview = await inventoryService.getStockOverview();
      let prod = overview.find((p) => p.sku === 'LH-MILK-900G')!;
      expect(prod.reservedQuantity).toBe(baseReserved + 10);
      expect(prod.availableQuantity).toBe(baseAvailable - 10);

      // Hủy đơn hàng với lý do cụ thể
      const cancelled = await ordersService.cancelOrder(
        order.id,
        'Khách hàng thay đổi kế hoạch kinh doanh',
        mockManager,
      );
      expect(cancelled.status).toBe(OrderStatus.CANCELLED);
      expect(cancelled.cancelReason).toBe('Khách hàng thay đổi kế hoạch kinh doanh');

      // Tồn giữ chỗ phải được nhả hết về ban đầu, tồn khả dụng phục hồi lại
      overview = await inventoryService.getStockOverview();
      prod = overview.find((p) => p.sku === 'LH-MILK-900G')!;
      expect(prod.reservedQuantity).toBe(baseReserved);
      expect(prod.availableQuantity).toBe(baseAvailable);
      expect(prod.activeReservations.some((r) => r.orderId === order.id)).toBe(false);
    });
  });

  describe('4. Tiêu chí AC2: Quá hạn giữ chỗ 24h tự động nhả tồn kho', () => {
    it('TC-05: Tự động giải phóng tồn giữ chỗ và hủy đơn khi phiếu giữ chỗ hết hạn', async () => {
      const initialOverview = await inventoryService.getStockOverview();
      const initialProduct = initialOverview.find((p) => p.sku === 'LH-MILK-900G')!;
      const baseReserved = initialProduct.reservedQuantity;
      const baseAvailable = initialProduct.availableQuantity;

      const orderDto: CreateOrderDto = {
        customerId: 'cust-001',
        lines: [
          {
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            unit: 'Lon',
            baseUnit: 'Lon',
            conversionRate: 1,
            quantity: 15,
            listPrice: 520000,
            unitPrice: 520000,
          },
        ],
        status: OrderStatus.PENDING,
      };

      const order = await ordersService.createOrder(orderDto);
      await ordersService.approveOrder(order.id, mockManager);

      // Giả lập reservation bị quá hạn (hết hạn từ 1 giờ trước)
      const reservations = await inventoryService.getActiveReservations(undefined, order.id);
      expect(reservations.length).toBe(1);
      reservations[0].expiredAt = new Date(Date.now() - 3600 * 1000);
      inventoryService.addMemoryReservation(reservations[0]);

      // Kích hoạt quét nhả tồn tự động
      const cleanupResult = await ordersService.releaseExpiredReservations();
      expect(cleanupResult.releasedReservations).toBe(1);
      expect(cleanupResult.cancelledOrders).toBe(1);

      // Đơn hàng tự động chuyển sang CANCELLED
      const checkedOrder = await ordersService.findOrderById(order.id);
      expect(checkedOrder.status).toBe(OrderStatus.CANCELLED);
      expect(checkedOrder.cancelReason).toContain('quá hạn giữ chỗ 24h');

      // Tồn khả dụng được phục hồi hoàn toàn
      const overview = await inventoryService.getStockOverview();
      const prod = overview.find((p) => p.sku === 'LH-MILK-900G')!;
      expect(prod.reservedQuantity).toBe(baseReserved);
      expect(prod.availableQuantity).toBe(baseAvailable);
    });
  });

  describe('5. Sổ tồn 3 cột & Xem chi tiết giữ chỗ', () => {
    it('TC-06: Sổ tồn hiển thị chính xác 3 cột: physicalQuantity, reservedQuantity, availableQuantity', async () => {
      const overview = await inventoryService.getStockOverview();
      expect(overview.length).toBeGreaterThan(0);

      for (const item of overview) {
        expect(typeof item.physicalQuantity).toBe('number');
        expect(typeof item.reservedQuantity).toBe('number');
        expect(typeof item.availableQuantity).toBe('number');
        expect(item.availableQuantity).toBe(
          Math.max(0, item.physicalQuantity - item.reservedQuantity),
        );
        expect(Array.isArray(item.activeReservations)).toBe(true);
      }
    });
  });
});
