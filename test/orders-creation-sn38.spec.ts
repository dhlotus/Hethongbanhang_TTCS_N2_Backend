import { CustomersService } from '../src/modules/customers/customers.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { CreateOrderDto } from '../src/modules/orders/dto/create-order.dto';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';

describe('Order Creation & Live Calculation (SN-38 & SN-39)', () => {
  let customersService: CustomersService;
  let ordersService: OrdersService;

  beforeEach(() => {
    customersService = new CustomersService();
    ordersService = new OrdersService(customersService);
  });

  it('tạo đơn hàng với tính toán tức thời: tổng tiền hàng, chiết khấu, tổng phải thu (SN-38)', async () => {
    const orderDto: CreateOrderDto = {
      customerId: 'cust-001',
      deliveryDate: '2026-10-20',
      lines: [
        {
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
          unit: 'Thùng (12 lon)',
          baseUnit: 'Lon',
          conversionRate: 12,
          quantity: 10,
          listPrice: 5000000,
          unitPrice: 4500000,
          discountPercent: 10,
        },
        {
          productId: 'prod-002',
          productSku: 'LH-NUT-180ML',
          productName: 'Sữa Hạt Óc Chó Yến Mạch LOHA 180ml',
          unit: 'Thùng (48 hộp)',
          baseUnit: 'Hộp',
          conversionRate: 48,
          quantity: 2,
          listPrice: 600000,
          unitPrice: 600000,
          discountPercent: 0,
        },
      ],
      note: 'Giao giờ hành chính',
      status: OrderStatus.PENDING,
    };

    const created = await ordersService.createOrder(orderDto);

    expect(created.orderCode).toBeDefined();
    expect(created.customerId).toBe('cust-001');
    expect(created.lines.length).toBe(2);

    // Dòng 1: 10 * 5tr = 50tr list; 10 * 4.5tr = 45tr lineTotal; chiết khấu = 5tr. BaseQty = 120 lon.
    expect(created.lines[0].baseQuantity).toBe(120);
    expect(created.lines[0].lineTotal).toBe(45000000);

    // Dòng 2: 2 * 600k = 1.2tr list; 2 * 600k = 1.2tr lineTotal; chiết khấu = 0. BaseQty = 96 hộp.
    expect(created.lines[1].baseQuantity).toBe(96);
    expect(created.lines[1].lineTotal).toBe(1200000);

    // Tổng đơn hàng
    expect(created.subtotal).toBe(51200000);
    expect(created.totalDiscount).toBe(5000000);
    expect(created.grandTotal).toBe(46200000);

    // Điểm giao hàng tự động gán điểm mặc định của đại lý nếu không truyền
    expect(created.deliveryPoint).toBeDefined();
    expect(created.deliveryPoint?.address).toContain('Nguyễn Trọng Tuyển');
  });

  it('đơn hàng chọn điểm giao trong danh sách của đúng đại lý đó (SN-31)', async () => {
    // Thử truyền điểm giao thuộc đại lý cust-002 cho đại lý cust-001 -> Phải bị từ chối
    const invalidDto: CreateOrderDto = {
      customerId: 'cust-001',
      deliveryPoint: {
        id: 'dp-002-1', // Điểm của cust-002
        address: '456 Lê Văn Việt',
      },
      lines: [
        {
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
          unit: 'Lon',
          baseUnit: 'Lon',
          conversionRate: 1,
          quantity: 1,
          listPrice: 500000,
          unitPrice: 500000,
          discountPercent: 0,
        },
      ],
    };

    await expect(ordersService.createOrder(invalidDto)).rejects.toThrow(
      'Điểm giao hàng đã chọn không thuộc danh sách điểm giao của đại lý',
    );
  });

  it('lưu nháp được và mở lại tiếp tục gõ (SN-39)', async () => {
    // 1. Lưu nháp
    const draftDto: CreateOrderDto = {
      customerId: 'cust-001',
      lines: [
        {
          productId: 'prod-003',
          productSku: 'LH-NEST-70ML',
          productName: 'Nước Yến Sào Nhân Sâm Thượng Hạng LOHA 70ml',
          unit: 'Hũ',
          baseUnit: 'Hũ',
          conversionRate: 1,
          quantity: 5,
          listPrice: 70000,
          unitPrice: 70000,
          discountPercent: 0,
        },
      ],
      note: 'Đang gõ dở tại cửa hàng',
      status: OrderStatus.DRAFT,
    };

    const draftOrder = await ordersService.createOrder(draftDto);
    expect(draftOrder.status).toBe(OrderStatus.DRAFT);
    expect(draftOrder.grandTotal).toBe(350000);

    // 2. Mở lại tiếp tục gõ (thêm dòng hàng, đổi số lượng)
    const updatedOrder = await ordersService.updateOrder(draftOrder.id, {
      lines: [
        {
          productId: 'prod-003',
          productSku: 'LH-NEST-70ML',
          productName: 'Nước Yến Sào Nhân Sâm Thượng Hạng LOHA 70ml',
          unit: 'Hũ',
          baseUnit: 'Hũ',
          conversionRate: 1,
          quantity: 10, // Tăng số lượng lên 10
          listPrice: 70000,
          unitPrice: 65000, // Chiết khấu
          discountPercent: 7,
        },
      ],
      note: 'Đã hoàn tất gõ đơn',
      status: OrderStatus.PENDING, // Chuyển từ nháp sang chờ duyệt
    });

    expect(updatedOrder.status).toBe(OrderStatus.PENDING);
    expect(updatedOrder.subtotal).toBe(700000);
    expect(updatedOrder.grandTotal).toBe(650000);
    expect(updatedOrder.totalDiscount).toBe(50000);
  });
});
