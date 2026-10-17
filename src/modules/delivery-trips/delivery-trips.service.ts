import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { DeliveryTripEntity } from './entities/delivery-trip.entity';
import { DeliveryStopEntity, IDeliveryStopItem } from './entities/delivery-stop.entity';
import { DeliveryTripStatus } from './entities/delivery-trip-status.enum';
import { StopDeliveryStatus } from './entities/stop-delivery-status.enum';
import {
  CreateDeliveryTripDto,
  QueryDeliveryTripsDto,
  TripCheckinReturnDto,
  UpdateStopStatusDto,
} from './dto';
import { OrderStatus } from '../orders/entities/order-status.enum';

export interface IGoodsInTransitStats {
  totalGoodsValueInTransit: number;
  activeTripsCount: number;
  overdueTripsCount: number;
  totalRemainingStops: number;
  totalRetainedUndeliveredValue: number;
  completedTripsToday: number;
}

@Injectable()
export class DeliveryTripsService implements OnModuleInit {
  private readonly logger = new Logger(DeliveryTripsService.name);
  private readonly trips = new Map<string, DeliveryTripEntity>();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional() private readonly ordersService?: OrdersService,
  ) {
    this.seedInitialTrips();
  }

  async onModuleInit(): Promise<void> {
    await this.initDatabaseTables();
  }

  /**
   * Khởi tạo bảng dữ liệu PostgreSQL nếu có kết nối
   */
  private async initDatabaseTables(): Promise<void> {
    if (!this.databaseService?.isConnected()) {
      this.logger.warn('PostgreSQL chưa kết nối, sử dụng bộ nhớ đệm cho Chuyến đi giao hàng.');
      return;
    }

    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS delivery_trips (
          id VARCHAR(100) PRIMARY KEY,
          trip_code VARCHAR(100) UNIQUE NOT NULL,
          trip_name VARCHAR(255) NOT NULL,
          warehouse_id VARCHAR(100) NOT NULL,
          warehouse_name VARCHAR(255) NOT NULL,
          driver_name VARCHAR(255) NOT NULL,
          driver_phone VARCHAR(50) NOT NULL,
          vehicle_number VARCHAR(50) NOT NULL,
          carrier_name VARCHAR(255),
          status VARCHAR(50) NOT NULL DEFAULT 'IN_TRANSIT',
          departed_at TIMESTAMPTZ,
          estimated_completion_time TIMESTAMPTZ NOT NULL,
          actual_completion_time TIMESTAMPTZ,
          returned_to_warehouse BOOLEAN NOT NULL DEFAULT FALSE,
          returned_at TIMESTAMPTZ,
          returned_notes TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS delivery_stops (
          id VARCHAR(100) PRIMARY KEY,
          trip_id VARCHAR(100) REFERENCES delivery_trips(id) ON DELETE CASCADE,
          stop_order INT NOT NULL DEFAULT 1,
          order_id VARCHAR(100) NOT NULL,
          order_code VARCHAR(100) NOT NULL,
          customer_id VARCHAR(100) NOT NULL,
          customer_name VARCHAR(255) NOT NULL,
          delivery_address TEXT NOT NULL,
          contact_person VARCHAR(255) NOT NULL,
          contact_phone VARCHAR(50) NOT NULL,
          order_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
          status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
          failure_reason TEXT,
          delivered_at TIMESTAMPTZ,
          failed_at TIMESTAMPTZ,
          proof_photo_url TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.logger.log('Khởi tạo cấu trúc bảng delivery_trips & delivery_stops thành công.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Lỗi khi tạo bảng delivery_trips: ${msg}`);
    }
  }

  /**
   * Khởi tạo dữ liệu mẫu phong phú mô phỏng thực tế
   */
  private seedInitialTrips(): void {
    const now = Date.now();
    const oneHour = 3600 * 1000;

    // Chuyến 1: ĐANG CHẠY & BỊ QUÁ HẠN (Cảnh báo trễ hạn dự kiến)
    const trip1 = new DeliveryTripEntity({
      id: 'trip-hn-001',
      tripCode: 'CD-2026-HN01',
      tripName: 'Tuyến Cầu Giấy - Nam Từ Liêm (Xe 1.5 Tấn)',
      warehouseId: 'wh-001',
      warehouseName: 'Kho Tổng Miền Bắc - LOHA WH01',
      driverName: 'Nguyễn Văn Toàn',
      driverPhone: '0988123456',
      vehicleNumber: '29C-882.15',
      carrierName: 'Đội xe nội bộ LOHA',
      status: DeliveryTripStatus.IN_TRANSIT,
      departedAt: new Date(now - 3.5 * oneHour),
      estimatedCompletionTime: new Date(now - 1.2 * oneHour), // Quá hạn 1.2 tiếng
      notes: 'Tuyến giao các đại lý bánh kẹo & tiêu dùng nhanh nội thành Hà Nội',
      stops: [
        new DeliveryStopEntity({
          id: 'stop-001-1',
          tripId: 'trip-hn-001',
          stopOrder: 1,
          orderId: 'ord-001',
          orderCode: 'DH2609-09876',
          customerId: 'cust-001',
          customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
          deliveryAddress: 'Kho số 12, KCN Đình Trám, Bắc Giang',
          contactPerson: 'Anh Tuấn',
          contactPhone: '0988123456',
          orderAmount: 35000000,
          status: StopDeliveryStatus.DELIVERED,
          deliveredAt: new Date(now - 2.5 * oneHour),
          notes: 'Đã giao đủ 100% thùng hàng theo phiếu xuất',
          items: [
            {
              productId: 'p-001',
              sku: 'SKU-SUA-01',
              productName: 'Sữa đặc tiệt trùng cao cấp 380g',
              quantity: 100,
              unit: 'Thùng',
              unitPrice: 350000,
              totalPrice: 35000000,
            },
          ],
        }),
        new DeliveryStopEntity({
          id: 'stop-001-2',
          tripId: 'trip-hn-001',
          stopOrder: 2,
          orderId: 'ord-002',
          orderCode: 'DH2609-09880',
          customerId: 'cust-002',
          customerName: 'Tạp hóa Hoàng Gia Cầu Giấy',
          deliveryAddress: 'Số 88 Trần Thái Tông, Cầu Giấy, Hà Nội',
          contactPerson: 'Chị Hoàng Lan',
          contactPhone: '0912345678',
          orderAmount: 22500000,
          status: StopDeliveryStatus.FAILED,
          failureReason:
            'Đoạn đường đang thi công cấm xe tải ban ngày, cửa hàng hẹn chuyển sang giao sau 18h tối',
          failedAt: new Date(now - 1.8 * oneHour),
          notes: 'Hàng vẫn nằm trên xe tài xế quản lý, không tự động hồi về kho',
          items: [
            {
              productId: 'p-002',
              sku: 'SKU-BANH-01',
              productName: 'Bánh bông lan trứng tươi Loha 500g',
              quantity: 50,
              unit: 'Thùng',
              unitPrice: 450000,
              totalPrice: 22500000,
            },
          ],
        }),
        new DeliveryStopEntity({
          id: 'stop-001-3',
          tripId: 'trip-hn-001',
          stopOrder: 3,
          orderId: 'ord-003',
          orderCode: 'DH2609-09882',
          customerId: 'cust-003',
          customerName: 'Siêu thị Mini EcoMart Nam Từ Liêm',
          deliveryAddress: 'Tòa CT2 KĐT Mỹ Đình 2, Nam Từ Liêm, Hà Nội',
          contactPerson: 'Anh Đức Quản lý',
          contactPhone: '0977889900',
          orderAmount: 48000000,
          status: StopDeliveryStatus.PENDING,
          notes: 'Tài xế đang di chuyển tới điểm giao số 3',
        }),
        new DeliveryStopEntity({
          id: 'stop-001-4',
          tripId: 'trip-hn-001',
          stopOrder: 4,
          orderId: 'ord-004',
          orderCode: 'DH2609-09885',
          customerId: 'cust-004',
          customerName: 'Đại lý Tiêu Dùng Xanh',
          deliveryAddress: 'Số 15 Lê Đức Thọ, Nam Từ Liêm, Hà Nội',
          contactPerson: 'Chị Phương Anh',
          contactPhone: '0933221100',
          orderAmount: 16800000,
          status: StopDeliveryStatus.PENDING,
          notes: 'Giao cuối buổi',
        }),
      ],
    });

    // Chuyến 2: ĐANG CHẠY ĐÚNG GIỜ
    const trip2 = new DeliveryTripEntity({
      id: 'trip-hn-002',
      tripCode: 'CD-2026-HN02',
      tripName: 'Tuyến Đông Anh - Sóc Sơn (Xe 2.5 Tấn)',
      warehouseId: 'wh-001',
      warehouseName: 'Kho Tổng Miền Bắc - LOHA WH01',
      driverName: 'Trần Minh Đức',
      driverPhone: '0912888999',
      vehicleNumber: '29B-512.90',
      carrierName: 'Viettel Post',
      status: DeliveryTripStatus.IN_TRANSIT,
      departedAt: new Date(now - 1 * oneHour),
      estimatedCompletionTime: new Date(now + 2.5 * oneHour), // Còn 2.5 tiếng nữa
      notes: 'Giao hàng đợt trưa tuyến ngoại thành',
      stops: [
        new DeliveryStopEntity({
          id: 'stop-002-1',
          tripId: 'trip-hn-002',
          stopOrder: 1,
          orderId: 'ord-005',
          orderCode: 'DH2609-09890',
          customerId: 'cust-005',
          customerName: 'Đại lý Nông sản & Thực phẩm Phù Lỗ',
          deliveryAddress: 'Ngã ba Phù Lỗ, Sóc Sơn, Hà Nội',
          contactPerson: 'Bác Thắng',
          contactPhone: '0904112233',
          orderAmount: 18200000,
          status: StopDeliveryStatus.DELIVERED,
          deliveredAt: new Date(now - 0.3 * oneHour),
        }),
        new DeliveryStopEntity({
          id: 'stop-002-2',
          tripId: 'trip-hn-002',
          stopOrder: 2,
          orderId: 'ord-006',
          orderCode: 'DH2609-09891',
          customerId: 'cust-006',
          customerName: 'Chuỗi Bách hóa Sóc Sơn 1',
          deliveryAddress: 'Số 42 Thị trấn Sóc Sơn, Hà Nội',
          contactPerson: 'Anh Hưng',
          contactPhone: '0915667788',
          orderAmount: 25600000,
          status: StopDeliveryStatus.PENDING,
        }),
        new DeliveryStopEntity({
          id: 'stop-002-3',
          tripId: 'trip-hn-002',
          stopOrder: 3,
          orderId: 'ord-007',
          orderCode: 'DH2609-09895',
          customerId: 'cust-007',
          customerName: 'Đại lý Bánh kẹo Mai Linh',
          deliveryAddress: 'Xã Kim Lũ, Sóc Sơn, Hà Nội',
          contactPerson: 'Chị Mai',
          contactPhone: '0983445566',
          orderAmount: 14000000,
          status: StopDeliveryStatus.PENDING,
        }),
      ],
    });

    // Chuyến 3: ĐANG CHẠY & BỊ QUÁ HẠN (TP.HCM)
    const trip3 = new DeliveryTripEntity({
      id: 'trip-hcm-001',
      tripCode: 'CD-2026-HCM01',
      tripName: 'Tuyến Bình Tân - Bình Chánh (Xe 3 Tấn)',
      warehouseId: 'wh-002',
      warehouseName: 'Kho Tổng Miền Nam - LOHA WH02',
      driverName: 'Lê Quốc Hưng',
      driverPhone: '0903789012',
      vehicleNumber: '51D-431.28',
      carrierName: 'Đội xe nội bộ LOHA',
      status: DeliveryTripStatus.IN_TRANSIT,
      departedAt: new Date(now - 4.5 * oneHour),
      estimatedCompletionTime: new Date(now - 0.5 * oneHour), // Quá hạn 30 phút
      notes: 'Tuyến phân phối hàng siêu thị khu Tây Sài Gòn',
      stops: [
        new DeliveryStopEntity({
          id: 'stop-003-1',
          tripId: 'trip-hcm-001',
          stopOrder: 1,
          orderId: 'ord-008',
          orderCode: 'DH2609-09901',
          customerId: 'cust-008',
          customerName: 'Đại lý Tạp hóa Hưng Yên (Chi nhánh Bình Tân)',
          deliveryAddress: 'Đường Tên Lửa, Bình Trị Đông B, Bình Tân, TP.HCM',
          contactPerson: 'Anh Quân',
          contactPhone: '0938123456',
          orderAmount: 52000000,
          status: StopDeliveryStatus.DELIVERED,
          deliveredAt: new Date(now - 3 * oneHour),
        }),
        new DeliveryStopEntity({
          id: 'stop-003-2',
          tripId: 'trip-hcm-001',
          stopOrder: 2,
          orderId: 'ord-009',
          orderCode: 'DH2609-09905',
          customerId: 'cust-009',
          customerName: 'Siêu thị Gia Đình Vĩnh Lộc',
          deliveryAddress: 'Đường Nguyễn Thị Tú, Vĩnh Lộc B, Bình Chánh, TP.HCM',
          contactPerson: 'Chị Hà Thu',
          contactPhone: '0909554433',
          orderAmount: 31500000,
          status: StopDeliveryStatus.PENDING,
          notes: 'Kẹt xe đường quốc lộ 1A đang chậm tiến độ',
        }),
        new DeliveryStopEntity({
          id: 'stop-003-3',
          tripId: 'trip-hcm-001',
          stopOrder: 3,
          orderId: 'ord-010',
          orderCode: 'DH2609-09908',
          customerId: 'cust-010',
          customerName: 'Đại lý Bách Hóa Tân Tạo',
          deliveryAddress: 'KCN Tân Tạo, Tân Tạo A, Bình Tân, TP.HCM',
          contactPerson: 'Anh Trọng',
          contactPhone: '0918776655',
          orderAmount: 19800000,
          status: StopDeliveryStatus.PENDING,
        }),
      ],
    });

    // Chuyến 4: ĐÃ HOÀN TẤT & ĐỐI SOÁT XONG VỀ KHO
    const trip4 = new DeliveryTripEntity({
      id: 'trip-hn-comp',
      tripCode: 'CD-2026-HN00',
      tripName: 'Tuyến Hoàn Kiếm - Hai Bà Trưng (Ca sáng)',
      warehouseId: 'wh-001',
      warehouseName: 'Kho Tổng Miền Bắc - LOHA WH01',
      driverName: 'Phạm Hồng Thái',
      driverPhone: '0972111222',
      vehicleNumber: '29C-339.81',
      carrierName: 'Đội xe nội bộ LOHA',
      status: DeliveryTripStatus.COMPLETED,
      departedAt: new Date(now - 8 * oneHour),
      estimatedCompletionTime: new Date(now - 4 * oneHour),
      actualCompletionTime: new Date(now - 3.8 * oneHour),
      returnedToWarehouse: true,
      returnedAt: new Date(now - 3.8 * oneHour),
      returnedNotes: 'Xe đã về kho an toàn, hoàn tất 100% điểm giao',
      stops: [
        new DeliveryStopEntity({
          id: 'stop-004-1',
          tripId: 'trip-hn-comp',
          stopOrder: 1,
          orderId: 'ord-011',
          orderCode: 'DH2609-09850',
          customerId: 'cust-011',
          customerName: 'Tạp hóa Bách Khoa',
          deliveryAddress: 'Số 1 Đại Cồ Việt, Hai Bà Trưng, Hà Nội',
          contactPerson: 'Bác Bình',
          contactPhone: '0982334455',
          orderAmount: 28000000,
          status: StopDeliveryStatus.DELIVERED,
          deliveredAt: new Date(now - 5 * oneHour),
        }),
      ],
    });

    this.trips.set(trip1.id, trip1);
    this.trips.set(trip2.id, trip2);
    this.trips.set(trip3.id, trip3);
    this.trips.set(trip4.id, trip4);
  }

  /**
   * Lấy danh sách chuyến đi giao hàng kèm bộ lọc và tính toán trễ hạn
   */
  async getTrips(query?: QueryDeliveryTripsDto): Promise<DeliveryTripEntity[]> {
    let list = Array.from(this.trips.values());

    // Cập nhật lại chỉ số thời gian thực (recalculate metrics)
    list.forEach((t) => t.recalculateMetrics());

    if (query?.warehouseId) {
      list = list.filter((t) => t.warehouseId === query.warehouseId);
    }

    if (query?.status) {
      list = list.filter((t) => t.status === query.status);
    }

    if (query?.isOverdue !== undefined) {
      const isOverdueFilter = query.isOverdue === 'true';
      list = list.filter((t) => t.isOverdue === isOverdueFilter);
    }

    if (query?.search?.trim()) {
      const term = query.search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.tripCode.toLowerCase().includes(term) ||
          t.tripName.toLowerCase().includes(term) ||
          t.driverName.toLowerCase().includes(term) ||
          t.vehicleNumber.toLowerCase().includes(term),
      );
    }

    // Sắp xếp: Chuyến quá hạn lên đầu, kế đến chuyến đang chạy, rồi nháp, hoàn tất
    return list.sort((a, b) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      if (a.status === DeliveryTripStatus.IN_TRANSIT && b.status !== DeliveryTripStatus.IN_TRANSIT) {
        return -1;
      }
      if (a.status !== DeliveryTripStatus.IN_TRANSIT && b.status === DeliveryTripStatus.IN_TRANSIT) {
        return 1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  /**
   * Lấy chi tiết chuyến đi
   */
  async getTripById(id: string): Promise<DeliveryTripEntity> {
    const trip = this.trips.get(id);
    if (!trip) {
      throw new NotFoundException(`Không tìm thấy chuyến đi giao hàng với mã: ${id}`);
    }
    trip.recalculateMetrics();
    return trip;
  }

  /**
   * Thống kê tiền hàng đang nằm trên đường & cảnh báo điều hành kho
   */
  async getGoodsInTransitStats(warehouseId?: string): Promise<IGoodsInTransitStats> {
    const trips = await this.getTrips(warehouseId ? { warehouseId } : undefined);
    const activeTrips = trips.filter((t) => t.status === DeliveryTripStatus.IN_TRANSIT);

    const totalGoodsValueInTransit = activeTrips.reduce(
      (sum, t) => sum + (t.inTransitGoodsValue || 0),
      0,
    );
    const overdueTripsCount = activeTrips.filter((t) => t.isOverdue).length;
    const totalRemainingStops = activeTrips.reduce(
      (sum, t) => sum + (t.remainingStops || 0),
      0,
    );
    const totalRetainedUndeliveredValue = activeTrips.reduce(
      (sum, t) => sum + (t.retainedGoodsValue || 0),
      0,
    );

    const todayStr = new Date().toISOString().slice(0, 10);
    const completedTripsToday = trips.filter(
      (t) =>
        t.status === DeliveryTripStatus.COMPLETED &&
        t.actualCompletionTime &&
        t.actualCompletionTime.toISOString().slice(0, 10) === todayStr,
    ).length;

    return {
      totalGoodsValueInTransit,
      activeTripsCount: activeTrips.length,
      overdueTripsCount,
      totalRemainingStops,
      totalRetainedUndeliveredValue,
      completedTripsToday,
    };
  }

  /**
   * Tạo chuyến đi giao hàng mới từ các đơn hàng đã xuất kho
   */
  async createTrip(
    dto: CreateDeliveryTripDto,
    currentUser?: ICurrentUser,
  ): Promise<DeliveryTripEntity> {
    const tripId = `trip-${Date.now()}`;
    const tripCode =
      dto.tripCode ||
      `CD-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const stops: DeliveryStopEntity[] = [];

    // Tạo các điểm giao hàng từ danh sách đơn hàng
    for (let i = 0; i < dto.orderIds.length; i++) {
      const orderId = dto.orderIds[i];
      const stop = await this.buildStopFromOrder(orderId, tripId, i + 1);
      stops.push(stop);
    }

    const startImmediately = dto.startImmediately !== false;
    const newTrip = new DeliveryTripEntity({
      id: tripId,
      tripCode,
      tripName: dto.tripName,
      warehouseId: dto.warehouseId,
      warehouseName: dto.warehouseName || 'Kho Tổng LOHA',
      driverName: dto.driverName,
      driverPhone: dto.driverPhone,
      vehicleNumber: dto.vehicleNumber,
      carrierName: dto.carrierName || 'Đội xe nội bộ LOHA',
      status: startImmediately ? DeliveryTripStatus.IN_TRANSIT : DeliveryTripStatus.DRAFT,
      departedAt: startImmediately ? new Date() : undefined,
      estimatedCompletionTime: new Date(dto.estimatedCompletionTime),
      notes: dto.notes,
      stops,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.trips.set(tripId, newTrip);

    // Nếu xuất phát ngay, đồng bộ cập nhật trạng thái các đơn hàng sang SHIPPED (Đang giao)
    if (startImmediately) {
      await this.syncOrdersStatusToShipped(dto.orderIds);
    }

    return newTrip;
  }

  /**
   * Helper: Trích xuất thông tin đơn hàng để tạo DeliveryStopEntity
   */
  private async buildStopFromOrder(
    orderId: string,
    tripId: string,
    orderIndex: number,
  ): Promise<DeliveryStopEntity> {
    let orderDetails = null;
    if (this.ordersService) {
      try {
        orderDetails = await this.ordersService.findOrderById(orderId);
      } catch {
        // Fallback nếu không tìm thấy
      }
    }

    return new DeliveryStopEntity({
      id: `stop-${Date.now()}-${orderIndex}`,
      tripId,
      stopOrder: orderIndex,
      orderId,
      orderCode: orderDetails?.orderCode || `DH-${orderId}`,
      customerId: orderDetails?.customerId || 'cust-generic',
      customerName: orderDetails?.customerName || `Đại lý nhận hàng ${orderIndex}`,
      deliveryAddress:
        orderDetails?.deliveryPoint?.address ||
        'Địa chỉ theo phiếu xuất kho',
      contactPerson:
        orderDetails?.deliveryPoint?.receiverName ||
        orderDetails?.customerName ||
        'Đại diện nhận hàng',
      contactPhone: orderDetails?.deliveryPoint?.phone || '0988000111',
      orderAmount: Number(orderDetails?.grandTotal) || 20000000,
      status: StopDeliveryStatus.PENDING,
      items: (orderDetails?.lines || []).map((l) => ({
        productId: l.productId,
        sku: l.productSku || '',
        productName: l.productName,
        quantity: l.dispatchedQuantity || l.quantity,
        unit: l.unit || 'Thùng',
        unitPrice: l.unitPrice,
        totalPrice: (l.dispatchedQuantity || l.quantity) * l.unitPrice,
      })),
    });
  }

  /**
   * Helper: Cập nhật trạng thái các đơn hàng sang SHIPPED khi xe xuất phát
   */
  private async syncOrdersStatusToShipped(orderIds: string[]): Promise<void> {
    if (!this.ordersService) return;
    for (const orderId of orderIds) {
      try {
        await this.ordersService.updateOrderStatus(orderId, {
          status: OrderStatus.SHIPPED,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.debug(`Không thể đồng bộ trạng thái đơn ${orderId} sang SHIPPED: ${msg}`);
      }
    }
  }

  /**
   * Bắt đầu chuyến đi giao hàng (DRAFT -> IN_TRANSIT)
   */
  async startTrip(id: string, currentUser?: ICurrentUser): Promise<DeliveryTripEntity> {
    const trip = await this.getTripById(id);
    if (trip.status !== DeliveryTripStatus.DRAFT) {
      throw new BadRequestException(
        `Chỉ có thể bắt đầu chuyến đi đang ở trạng thái DRAFT. Trạng thái hiện tại: ${trip.status}`,
      );
    }

    trip.status = DeliveryTripStatus.IN_TRANSIT;
    trip.departedAt = new Date();
    trip.updatedAt = new Date();
    trip.recalculateMetrics();

    await this.syncOrdersStatusToShipped(trip.stops.map((s) => s.orderId));
    this.trips.set(id, trip);
    return trip;
  }

  /**
   * Cập nhật trạng thái từng điểm giao hàng trên chuyến đi
   * QUY TẮC CỐT LÕI (SN-194 / SN-197):
   * - Hàng chưa giao được vẫn thuộc trách nhiệm chuyến đi, KHÔNG TỰ VỀ KHO!
   */
  async updateStopStatus(
    tripId: string,
    stopId: string,
    dto: UpdateStopStatusDto,
    currentUser?: ICurrentUser,
  ): Promise<DeliveryTripEntity> {
    const trip = await this.getTripById(tripId);
    if (trip.status !== DeliveryTripStatus.IN_TRANSIT) {
      throw new BadRequestException(
        `Không thể cập nhật điểm dừng khi chuyến đi không ở trạng thái Đang chạy (IN_TRANSIT)`,
      );
    }

    const stop = trip.stops.find((s) => s.id === stopId);
    if (!stop) {
      throw new NotFoundException(`Không tìm thấy điểm giao hàng với mã: ${stopId}`);
    }

    stop.status = dto.status;
    stop.notes = dto.notes || stop.notes;
    stop.proofPhotoUrl = dto.proofPhotoUrl || stop.proofPhotoUrl;
    stop.updatedAt = new Date();

    if (dto.status === StopDeliveryStatus.DELIVERED) {
      stop.deliveredAt = new Date();
      stop.failureReason = undefined;
      // Đồng bộ đơn hàng thành công
      await this.syncSingleOrderStatus(stop.orderId, OrderStatus.DELIVERED);
    } else if (dto.status === StopDeliveryStatus.FAILED) {
      if (!dto.failureReason?.trim()) {
        throw new BadRequestException(
          'Bắt buộc nhập lý do khi ghi nhận giao không thành công (Hàng vẫn giữ trên xe)',
        );
      }
      stop.failedAt = new Date();
      stop.failureReason = dto.failureReason.trim();
      // QUY ĐỊNH CỐT LÕI: Hàng vẫn thuộc trách nhiệm chuyến đi, KHÔNG TỰ HỒI TỒN KHO!
      // Không chuyển đơn về CANCELLED hay RETURNED lúc này, đơn vẫn ở trạng thái xe quản lý!
    }

    trip.updatedAt = new Date();
    trip.recalculateMetrics();
    this.trips.set(tripId, trip);
    return trip;
  }

  /**
   * Helper: Đồng bộ trạng thái 1 đơn hàng an toàn
   */
  private async syncSingleOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    if (!this.ordersService) return;
    try {
      await this.ordersService.updateOrderStatus(orderId, { status });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Không thể đồng bộ trạng thái đơn ${orderId} sang ${status}: ${msg}`);
    }
  }

  /**
   * Quản lý kho xác nhận xe về kho & kiểm đếm đối soát hàng chưa giao
   * Lúc này hàng chưa giao mới chính thức được làm thủ tục nhập lại kho!
   */
  async checkinTripReturn(
    id: string,
    dto: TripCheckinReturnDto,
    currentUser?: ICurrentUser,
  ): Promise<DeliveryTripEntity> {
    const trip = await this.getTripById(id);

    if (trip.status !== DeliveryTripStatus.IN_TRANSIT) {
      throw new BadRequestException(
        `Chỉ có thể làm thủ tục đối soát về kho cho chuyến đi đang chạy (IN_TRANSIT). Trạng thái hiện tại: ${trip.status}`,
      );
    }

    const pendingStops = trip.stops.filter((s) => s.status === StopDeliveryStatus.PENDING);
    if (pendingStops.length > 0) {
      throw new BadRequestException(
        `Còn ${pendingStops.length} điểm giao chưa được ghi nhận kết quả (Chưa chọn Giao thành công hoặc Chưa giao được). Vui lòng cập nhật tất cả các điểm trước khi đối soát về kho.`,
      );
    }

    if (!dto.confirmReturnAllFailedGoods) {
      throw new BadRequestException(
        'Quản lý kho bắt buộc tích chọn xác nhận đã kiểm đếm đầy đủ hàng trả về để nhập kho.',
      );
    }

    trip.returnedToWarehouse = true;
    trip.returnedAt = new Date();
    trip.returnedNotes = dto.returnedNotes;
    trip.status = DeliveryTripStatus.COMPLETED;
    trip.actualCompletionTime = new Date();
    trip.updatedAt = new Date();
    trip.recalculateMetrics();

    // Giờ đây khi xe đã về kho và đối soát xong, các đơn giao không thành công mới chuyển sang RETURNED
    for (const stop of trip.stops) {
      if (stop.status === StopDeliveryStatus.FAILED) {
        await this.syncSingleOrderStatus(stop.orderId, OrderStatus.RETURNED);
      }
    }

    this.trips.set(id, trip);
    return trip;
  }
}
