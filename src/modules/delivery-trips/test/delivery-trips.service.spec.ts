import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeliveryTripsService } from '../delivery-trips.service';
import { DeliveryTripStatus } from '../entities/delivery-trip-status.enum';
import { StopDeliveryStatus } from '../entities/stop-delivery-status.enum';
import { DatabaseService } from '../../../database/database.service';
import { OrdersService } from '../../orders/orders.service';

describe('DeliveryTripsService (SN-194 / SN-197)', () => {
  let service: DeliveryTripsService;

  beforeEach(async () => {
    const mockDatabaseService = {
      isConnected: jest.fn().mockReturnValue(false),
      query: jest.fn(),
    };

    const mockOrdersService = {
      findOrderById: jest.fn().mockResolvedValue({
        id: 'ord-test-01',
        code: 'DH-TEST-01',
        customerId: 'cust-01',
        customerName: 'Đại lý Test',
        shippingAddress: '123 Đường Test, Hà Nội',
        receiverName: 'Anh Test',
        receiverPhone: '0988000111',
        totalAmount: 50000000,
        lines: [],
      }),
      updateOrderStatus: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryTripsService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: OrdersService, useValue: mockOrdersService },
      ],
    }).compile();

    service = module.get<DeliveryTripsService>(DeliveryTripsService);
  });

  it('1. Lấy danh sách chuyến đi và thống kê tiền hàng đang nằm trên đường chính xác', async () => {
    const stats = await service.getGoodsInTransitStats();
    expect(stats.activeTripsCount).toBeGreaterThan(0);
    expect(stats.totalGoodsValueInTransit).toBeGreaterThan(0);
    expect(stats.overdueTripsCount).toBeGreaterThan(0);
  });

  it('2. Cảnh báo chuyến đi quá thời gian dự kiến (isOverdue = true và tính overdueMinutes)', async () => {
    const trips = await service.getTrips();
    const overdueTrip = trips.find((t) => t.id === 'trip-hn-001');

    expect(overdueTrip).toBeDefined();
    expect(overdueTrip?.status).toBe(DeliveryTripStatus.IN_TRANSIT);
    expect(overdueTrip?.isOverdue).toBe(true);
    expect(overdueTrip?.overdueMinutes).toBeGreaterThan(0);
  });

  it('3. Khi điểm giao không thành công: Bắt buộc nhập lý do, nếu để trống phải báo lỗi', async () => {
    await expect(
      service.updateStopStatus('trip-hn-001', 'stop-001-3', {
        status: StopDeliveryStatus.FAILED,
        failureReason: '',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('4. Hàng chưa giao được vẫn thuộc trách nhiệm của chuyến đi, KHÔNG tự về kho và vẫn tính tiền hàng trên đường', async () => {
    const tripBefore = await service.getTripById('trip-hn-001');
    const stopToFail = tripBefore.stops.find((s) => s.id === 'stop-001-3');
    expect(stopToFail?.status).toBe(StopDeliveryStatus.PENDING);

    const initialInTransitValue = tripBefore.inTransitGoodsValue;

    // Cập nhật điểm 3 thành FAILED
    const updatedTrip = await service.updateStopStatus('trip-hn-001', 'stop-001-3', {
      status: StopDeliveryStatus.FAILED,
      failureReason: 'Đại lý đóng cửa nghỉ lễ, bảo vệ từ chối nhận hàng',
    });

    const failedStop = updatedTrip.stops.find((s) => s.id === 'stop-001-3');
    expect(failedStop?.status).toBe(StopDeliveryStatus.FAILED);
    expect(failedStop?.failureReason).toContain('Đại lý đóng cửa');

    // Hàng chưa giao được vẫn nằm trên xe, inTransitGoodsValue KHÔNG bị giảm đi
    expect(updatedTrip.inTransitGoodsValue).toBe(initialInTransitValue);
    expect(updatedTrip.retainedGoodsValue).toBeGreaterThan(0);
    expect(updatedTrip.returnedToWarehouse).toBe(false);
  });

  it('5. Cập nhật điểm giao thành công (DELIVERED) -> trừ tiền hàng trên đường và tăng tiền đã giao', async () => {
    const tripBefore = await service.getTripById('trip-hn-002');
    const stopToDeliver = tripBefore.stops.find((s) => s.id === 'stop-002-2');
    expect(stopToDeliver?.status).toBe(StopDeliveryStatus.PENDING);

    const prevInTransit = tripBefore.inTransitGoodsValue;
    const prevDelivered = tripBefore.deliveredGoodsValue;
    const stopAmount = stopToDeliver?.orderAmount || 0;

    const updatedTrip = await service.updateStopStatus('trip-hn-002', 'stop-002-2', {
      status: StopDeliveryStatus.DELIVERED,
    });

    expect(updatedTrip.deliveredGoodsValue).toBe(prevDelivered + stopAmount);
    expect(updatedTrip.inTransitGoodsValue).toBe(prevInTransit - stopAmount);
  });

  it('6. Không cho phép đối soát về kho nếu vẫn còn điểm PENDING chưa xử lý', async () => {
    await expect(
      service.checkinTripReturn('trip-hn-002', {
        confirmReturnAllFailedGoods: true,
        returnedNotes: 'Về kho',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('7. Đối soát xe về kho thành công: chỉ khi Quản lý kho xác nhận, chuyển COMPLETED và cập nhật returnedToWarehouse', async () => {
    // Trước tiên giải quyết các điểm còn lại của trip-hn-002
    await service.updateStopStatus('trip-hn-002', 'stop-002-2', {
      status: StopDeliveryStatus.DELIVERED,
    });
    await service.updateStopStatus('trip-hn-002', 'stop-002-3', {
      status: StopDeliveryStatus.FAILED,
      failureReason: 'Khách hẹn dời ngày',
    });

    const completedTrip = await service.checkinTripReturn('trip-hn-002', {
      confirmReturnAllFailedGoods: true,
      returnedNotes: 'Quản lý kho đã kiểm đếm và nhận lại toàn bộ hàng chưa giao',
    });

    expect(completedTrip.status).toBe(DeliveryTripStatus.COMPLETED);
    expect(completedTrip.returnedToWarehouse).toBe(true);
    expect(completedTrip.actualCompletionTime).toBeDefined();
  });
});
