import { CustomersService } from '../src/modules/customers/customers.service';
import { CreateDeliveryPointDto } from '../src/modules/customers/dto/create-delivery-point.dto';

describe('Customers & Delivery Points Management (SN-31 & SN-32)', () => {
  let customersService: CustomersService;

  beforeEach(() => {
    customersService = new CustomersService();
  });

  it('phải có sẵn danh sách đại lý và điểm giao hàng mẫu thực tế', async () => {
    const customers = await customersService.findAllCustomers();
    expect(customers.length).toBeGreaterThanOrEqual(5);

    const first = customers[0];
    expect(first.deliveryPoints.length).toBeGreaterThanOrEqual(2);
    expect(first.deliveryPoints.some((dp) => dp.isDefault)).toBe(true);
  });

  it('mỗi điểm giao hàng phải có đầy đủ: địa chỉ, người nhận, số điện thoại, ghi chú đường đi (SN-31)', async () => {
    const points = await customersService.getDeliveryPoints('cust-001');
    expect(points.length).toBeGreaterThan(0);

    for (const point of points) {
      expect(point.address).toBeDefined();
      expect(point.receiverName).toBeDefined();
      expect(point.phone).toBeDefined();
      expect(point.roadNote).toBeDefined();
    }
  });

  it('thêm điểm giao hàng mới và kiểm tra logic đặt làm mặc định (SN-31)', async () => {
    const newPointDto: CreateDeliveryPointDto = {
      name: 'Kho Phụ Hóc Môn',
      address: '77 Lý Thường Kiệt, TT. Hóc Môn, TP.HCM',
      receiverName: 'Anh Ba Hóc Môn',
      phone: '0988776655',
      roadNote: 'Đường xe tải 5T vào được, cổng phụ bên hông',
      isDefault: true,
    };

    const createdPoint = await customersService.createDeliveryPoint('cust-001', newPointDto);
    expect(createdPoint.id).toBeDefined();
    expect(createdPoint.name).toBe('Kho Phụ Hóc Môn');
    expect(createdPoint.isDefault).toBe(true);

    // Điểm mới là mặc định thì các điểm khác phải thành isDefault = false
    const allPoints = await customersService.getDeliveryPoints('cust-001');
    const defaultPoints = allPoints.filter((p) => p.isDefault);
    expect(defaultPoints.length).toBe(1);
    expect(defaultPoints[0].id).toBe(createdPoint.id);
  });

  it('có thể đổi điểm giao hàng mặc định sang điểm khác (SN-31)', async () => {
    const points = await customersService.getDeliveryPoints('cust-002');
    const targetPoint = points.find((p) => !p.isDefault);
    expect(targetPoint).toBeDefined();

    if (targetPoint) {
      const updated = await customersService.setDefaultDeliveryPoint(
        'cust-002',
        targetPoint.id,
      );
      expect(updated.isDefault).toBe(true);

      const refreshedPoints = await customersService.getDeliveryPoints('cust-002');
      const defaultPoints = refreshedPoints.filter((p) => p.isDefault);
      expect(defaultPoints.length).toBe(1);
      expect(defaultPoints[0].id).toBe(targetPoint.id);
    }
  });

  it('cập nhật và xóa điểm giao hàng', async () => {
    const points = await customersService.getDeliveryPoints('cust-001');
    const pointToUpdate = points[0];

    const updated = await customersService.updateDeliveryPoint('cust-001', pointToUpdate.id, {
      name: 'Tên Kho Đã Cập Nhật',
      receiverName: 'Người Nhận Mới',
    });

    expect(updated.name).toBe('Tên Kho Đã Cập Nhật');
    expect(updated.receiverName).toBe('Người Nhận Mới');

    const result = await customersService.deleteDeliveryPoint('cust-001', pointToUpdate.id);
    expect(result.success).toBe(true);

    const remainingPoints = await customersService.getDeliveryPoints('cust-001');
    expect(remainingPoints.some((p) => p.id === pointToUpdate.id)).toBe(false);
  });
});
