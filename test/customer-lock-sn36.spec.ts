import { CustomersService } from '../src/modules/customers/customers.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { CustomerStatus } from '../src/modules/customers/entities/customer.entity';
import { CreateOrderDto } from '../src/modules/orders/dto/create-order.dto';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';

describe('Lock / Unlock Dealer Transactions (SN-31 / SN-36)', () => {
  let customersService: CustomersService;
  let ordersService: OrdersService;

  beforeEach(() => {
    customersService = new CustomersService();
    ordersService = new OrdersService(customersService);
  });

  it('1. Bắt buộc nhập lý do khi khóa giao dịch đại lý (SN-36)', async () => {
    // Khoá không nhập lý do -> Bị từ chối
    await expect(
      customersService.lockCustomer('cust-001', { reason: '' }),
    ).rejects.toThrow('Bắt buộc phải nhập lý do khi khóa đại lý');

    // Khoá có lý do -> Thành công
    const locked = await customersService.lockCustomer('cust-001', {
      reason: 'Quá hạn thanh toán công nợ 60 ngày, có dấu hiệu rủi ro tài chính',
    });

    expect(locked.status).toBe(CustomerStatus.LOCKED);
    expect(locked.lockReason).toBe(
      'Quá hạn thanh toán công nợ 60 ngày, có dấu hiệu rủi ro tài chính',
    );
    expect(locked.lockedAt).toBeDefined();
  });

  it('2. Đại lý bị khóa KHÔNG tạo được đơn mới, kể cả trên cổng đặt hàng (SN-36)', async () => {
    // Khóa đại lý cust-001
    await customersService.lockCustomer('cust-001', {
      reason: 'Đại lý quá hạn thanh toán 90 ngày',
    });

    const newOrderDto: CreateOrderDto = {
      customerId: 'cust-001',
      lines: [
        {
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
          unit: 'Lon',
          baseUnit: 'Lon',
          conversionRate: 1,
          quantity: 5,
          listPrice: 500000,
          unitPrice: 500000,
          discountPercent: 0,
        },
      ],
    };

    // Thử tạo đơn -> Phải báo lỗi từ chối ngay lập tức
    await expect(ordersService.createOrder(newOrderDto)).rejects.toThrow(
      'Đại lý "Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang" đang bị KHÓA GIAO DỊCH',
    );
  });

  it('3. Đơn đang dở của đại lý bị khóa vẫn xử lý tiếp được nhưng có CẢNH BÁO (SN-36)', async () => {
    // 1. Tạo đơn nháp DRAFT khi đại lý chưa bị khóa
    const draftDto: CreateOrderDto = {
      customerId: 'cust-002',
      lines: [
        {
          productId: 'prod-002',
          productSku: 'LH-NUT-180ML',
          productName: 'Sữa Hạt Óc Chó Yến Mạch LOHA 180ml',
          unit: 'Hộp',
          baseUnit: 'Hộp',
          conversionRate: 1,
          quantity: 10,
          listPrice: 15000,
          unitPrice: 15000,
          discountPercent: 0,
        },
      ],
      status: OrderStatus.DRAFT,
    };

    const draftOrder = await ordersService.createOrder(draftDto);
    expect(draftOrder.isCustomerLocked).toBeFalsy();

    // 2. Kế toán công nợ tiến hành KHÓA đại lý cust-002
    await customersService.lockCustomer('cust-002', {
      reason: 'Phát hiện nợ xấu chưa đối soát xong',
    });

    // 3. Đơn đang dở vẫn mở ra xem hoặc chỉnh sửa tiếp được nhưng phải gắn CẢNH BÁO
    const updatedDraft = await ordersService.updateOrder(draftOrder.id, {
      note: 'Tiếp tục xử lý đơn dở',
    });

    expect(updatedDraft.isCustomerLocked).toBe(true);
    expect(updatedDraft.warningMessage).toContain('CẢNH BÁO (SN-36): Đại lý "Đại Lý Bách Hóa Thực Phẩm Bảo Châu" đang bị KHÓA GIAO DỊCH');
    expect(updatedDraft.warningMessage).toContain('Phát hiện nợ xấu chưa đối soát xong');
  });

  it('4. Mở khóa đại lý khôi phục khả năng tạo đơn bình thường (SN-36)', async () => {
    // Khóa
    await customersService.lockCustomer('cust-003', {
      reason: 'Tạm dừng để kiểm tra hợp đồng',
    });

    // Mở khóa
    const unlocked = await customersService.unlockCustomer('cust-003');
    expect(unlocked.status).toBe(CustomerStatus.ACTIVE);
    expect(unlocked.lockReason).toBeUndefined();

    // Tạo đơn mới bình thường
    const orderDto: CreateOrderDto = {
      customerId: 'cust-003',
      lines: [
        {
          productId: 'prod-003',
          productSku: 'LH-NEST-70ML',
          productName: 'Nước Yến Sào Nhân Sâm Thượng Hạng LOHA 70ml',
          unit: 'Hũ',
          baseUnit: 'Hũ',
          conversionRate: 1,
          quantity: 2,
          listPrice: 70000,
          unitPrice: 70000,
          discountPercent: 0,
        },
      ],
    };

    const createdOrder = await ordersService.createOrder(orderDto);
    expect(createdOrder.id).toBeDefined();
    expect(createdOrder.isCustomerLocked).toBeFalsy();
  });
});
