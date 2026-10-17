import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { OrdersService } from '../orders/orders.service';
import {
  DeliveryTripEntity,
  DeliveryTripStopEntity,
  DeliveryTripStatus,
} from './entities/delivery-trip.entity';
import {
  CreateDeliveryTripDto,
  UpdateDeliveryTripDto,
  AssignDriverDto,
} from './dto/delivery-trip.dto';

export interface ShipmentItem {
  id: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  salesRepId?: string;
  warehouseId?: string;
  status: 'PENDING' | 'PICKING' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  deliveryAddress?: string;
  receiverName?: string;
  phone?: string;
  trackingNumber?: string;
  carrierName?: string;
  proofOfDeliveryUrl?: string;
  deliveryNote?: string;
  failureReason?: string;
  tripId?: string;
  tripCode?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);
  private readonly shipments = new Map<string, ShipmentItem>();
  private readonly trips = new Map<string, DeliveryTripEntity>();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService?: OrdersService,
  ) {
    this.seedInitialShipments();
    this.seedInitialTrips();
  }

  private seedInitialShipments() {
    const seed: ShipmentItem[] = [
      {
        id: 'shp-001',
        orderId: 'ord-001',
        orderCode: 'DH2609-09876',
        customerId: 'cust-001',
        customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-001',
        status: 'SHIPPED',
        deliveryAddress: 'Kho số 12, KCN Đình Trám, Bắc Giang',
        receiverName: 'Anh Tuấn',
        phone: '0988123456',
        trackingNumber: 'TRK-2026-001',
        carrierName: 'Giao Hàng Nhanh',
        shippedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'shp-002',
        orderId: 'ord-002',
        orderCode: 'DH2609-09877',
        customerId: 'cust-002',
        customerName: 'Đại lý Tạp hóa Hưng Yên',
        salesRepId: 'usr-sale-02',
        warehouseId: 'wh-001',
        status: 'DELIVERED',
        deliveryAddress: 'Số 45 Điện Biên Phủ, TP Hưng Yên',
        receiverName: 'Chị Lan',
        phone: '0912345678',
        trackingNumber: 'TRK-2026-002',
        carrierName: 'Viettel Post',
        shippedAt: new Date(Date.now() - 86400000),
        deliveredAt: new Date(),
        createdAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(),
      },
      {
        id: 'shp-1792084366553',
        orderId: 'ord-dh2610-62440',
        orderCode: 'DH2610-62440',
        customerId: 'cust-003',
        customerName: 'Công Ty TNHH Thương Mại & Phân Phối Minh Khang',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-001',
        status: 'DELIVERED',
        deliveryAddress: 'Tổ 10 Gia Sàng',
        receiverName: 'Khánh',
        phone: '0563408845',
        trackingNumber: 'TRK-2026-555796',
        carrierName: 'Giao Hàng Nhanh',
        shippedAt: new Date(Date.now() - 3600000),
        deliveredAt: new Date(),
        createdAt: new Date(Date.now() - 7200000),
        updatedAt: new Date(),
      },
      {
        id: 'shp-1792084655213',
        orderId: 'ord-dh2610-10212',
        orderCode: 'DH2610-10212',
        customerId: 'cust-004',
        customerName: 'Đại Lý Thực Phẩm Sạch Thăng Long',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-001',
        status: 'PICKING',
        deliveryAddress: 'Tổ 6 Tân Thịnh',
        receiverName: 'Ánh',
        phone: '0562546558',
        trackingNumber: 'TRK-2026-520340',
        carrierName: 'Giao Hàng Nhanh',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    for (const s of seed) {
      this.shipments.set(s.id, s);
    }
  }

  /**
   * Phân quyền Data Scope (*) cho Module 6 (Phiếu xuất & giao hàng):
   * - Customer: R* (Chỉ thấy phiếu xuất của chính mình)
   * - Sales Rep: R* (Chỉ thấy phiếu xuất của tuyến mình)
   */
  async findAll(
    query?: { orderId?: string; orderCode?: string; status?: ShipmentItem['status'] },
    currentUser?: ICurrentUser,
  ): Promise<ShipmentItem[]> {
    let list = Array.from(this.shipments.values());

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER');

      if (!isManagerOrAdmin) {
        if (roles.includes(UserRole.CUSTOMER)) {
          const targetCustId =
            currentUser.username === 'dealer' ||
            currentUser.email?.includes('dealer') ||
            currentUser.email?.includes('daily')
              ? 'cust-001'
              : currentUser.userId;
          list = list.filter((s) => s.customerId === targetCustId || s.customerId === currentUser.userId);
        } else if (roles.includes(UserRole.SALES_REP)) {
          const repId = currentUser.userId;
          list = list.filter(
            (s) =>
              s.salesRepId === repId ||
              (repId === 'usr-sale-01' && (s.salesRepId === 'usr-sales-002' || s.salesRepId === 'usr-sale-01')) ||
              (repId === 'usr-sales-002' && (s.salesRepId === 'usr-sale-01' || s.salesRepId === 'usr-sales-002')),
          );
        }
      }
    }

    if (query?.orderId) {
      list = list.filter((s) => s.orderId === query.orderId);
    }
    if (query?.orderCode) {
      const qCode = String(query.orderCode).toLowerCase().trim();
      list = list.filter((s) => s.orderCode?.toLowerCase().trim() === qCode);
    }
    if (query?.status) {
      list = list.filter((s) => s.status === query.status);
    }

    return list;
  }

  async findById(id: string, currentUser?: ICurrentUser): Promise<ShipmentItem> {
    const shipment = this.shipments.get(id);
    if (!shipment) {
      throw new NotFoundException(`Không tìm thấy phiếu xuất kho ${id}`);
    }

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER');

      if (!isManagerOrAdmin) {
        if (roles.includes(UserRole.CUSTOMER)) {
          const targetCustId =
            currentUser.username === 'dealer' ||
            currentUser.email?.includes('dealer') ||
            currentUser.email?.includes('daily')
              ? 'cust-001'
              : currentUser.userId;
          if (shipment.customerId !== targetCustId && shipment.customerId !== currentUser.userId) {
            throw new ForbiddenException('Bạn chỉ có quyền xem phiếu xuất kho của chính đại lý mình');
          }
        } else if (roles.includes(UserRole.SALES_REP)) {
          const repId = currentUser.userId;
          const isAssigned =
            shipment.salesRepId === repId ||
            (repId === 'usr-sale-01' && (shipment.salesRepId === 'usr-sales-002' || shipment.salesRepId === 'usr-sale-01')) ||
            (repId === 'usr-sales-002' && (shipment.salesRepId === 'usr-sale-01' || shipment.salesRepId === 'usr-sales-002'));
          if (!isAssigned) {
            throw new ForbiddenException('Bạn chỉ có quyền xem phiếu xuất kho thuộc tuyến phụ trách');
          }
        }
      }
    }

    return shipment;
  }

  async create(dto: Partial<ShipmentItem>, user?: ICurrentUser): Promise<ShipmentItem> {
    if (!dto.orderCode || !dto.orderCode.trim()) {
      throw new BadRequestException('Mã đơn hàng không được để trống');
    }
    if (!dto.customerName || !dto.customerName.trim()) {
      throw new BadRequestException('Tên đại lý / Khách hàng không được để trống');
    }
    if (dto.phone) {
      const cleanPhone = dto.phone.trim();
      if (!/^0[0-9]{9}$/.test(cleanPhone)) {
        throw new BadRequestException('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0');
      }
    }
    const id = `shp-${Date.now()}`;
    const newShipment: ShipmentItem = {
      id,
      orderId: dto.orderId || 'ord-unknown',
      orderCode: dto.orderCode || 'DH-UNKNOWN',
      customerId: dto.customerId || 'cust-001',
      customerName: dto.customerName || 'Đại lý',
      salesRepId: dto.salesRepId,
      warehouseId: dto.warehouseId || 'wh-001',
      status: dto.status && dto.status !== 'PENDING' ? dto.status : 'PICKING',
      deliveryAddress: dto.deliveryAddress,
      receiverName: dto.receiverName,
      phone: dto.phone,
      trackingNumber: dto.trackingNumber,
      carrierName: dto.carrierName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.shipments.set(id, newShipment);
    if (newShipment.orderCode || newShipment.orderId) {
      await this.syncOrder(newShipment.orderCode || newShipment.orderId, newShipment.status);
    }
    return newShipment;
  }

  async updateStatus(id: string, status: ShipmentItem['status'], dto?: Partial<ShipmentItem>): Promise<ShipmentItem> {
    const shipment = await this.findById(id);
    shipment.status = status;
    shipment.updatedAt = new Date();
    if (dto?.trackingNumber) shipment.trackingNumber = dto.trackingNumber;
    if (dto?.carrierName) shipment.carrierName = dto.carrierName;
    if (dto?.proofOfDeliveryUrl) shipment.proofOfDeliveryUrl = dto.proofOfDeliveryUrl;
    if (status === 'SHIPPED') shipment.shippedAt = new Date();
    if (status === 'DELIVERED') shipment.deliveredAt = new Date();
    this.shipments.set(id, shipment);

    if (shipment.orderCode || shipment.orderId) {
      await this.syncOrder(shipment.orderCode || shipment.orderId, status);
    }

    return shipment;
  }

  async confirm(id: string): Promise<ShipmentItem> {
    return this.updateStatus(id, 'DELIVERED');
  }

  /**
   * SN-198: Xác nhận giao hàng thành công kèm ảnh chứng từ
   */
  async confirmDelivery(
    id: string,
    payload: { receiverName: string; deliveredAt: string; proofOfDeliveryUrl?: string; note?: string },
  ): Promise<ShipmentItem> {
    const shipment = await this.findById(id);
    if (!payload.receiverName || !payload.receiverName.trim()) {
      throw new BadRequestException('Tên người nhận hàng không được để trống');
    }
    shipment.status = 'DELIVERED';
    shipment.receiverName = payload.receiverName.trim();
    shipment.deliveredAt = payload.deliveredAt ? new Date(payload.deliveredAt) : new Date();
    if (payload.proofOfDeliveryUrl) {
      shipment.proofOfDeliveryUrl = payload.proofOfDeliveryUrl;
    }
    if (payload.note) {
      shipment.deliveryNote = payload.note;
    }
    shipment.updatedAt = new Date();
    this.shipments.set(id, shipment);

    if (shipment.orderCode || shipment.orderId) {
      await this.syncOrder(shipment.orderCode || shipment.orderId, 'DELIVERED');
    }

    return shipment;
  }

  /**
   * SN-198: Báo giao hàng không thành công, hàng quay về kho
   */
  async reportFailedDelivery(
    id: string,
    payload: { failureReason: string; note?: string },
  ): Promise<ShipmentItem> {
    const shipment = await this.findById(id);
    if (!payload.failureReason || !payload.failureReason.trim()) {
      throw new BadRequestException('Lý do giao hàng không thành công không được để trống');
    }
    shipment.status = 'PACKED'; // Hàng quay về kho
    shipment.failureReason = payload.failureReason.trim();
    if (payload.note) {
      shipment.deliveryNote = payload.note;
    }
    shipment.updatedAt = new Date();
    this.shipments.set(id, shipment);

    if (shipment.orderCode || shipment.orderId) {
      await this.syncOrder(shipment.orderCode || shipment.orderId, 'PACKED');
    }

    return shipment;
  }

  // =========================================================================
  // SN-196: QUẢN LÝ CHUYẾN GIAO HÀNG & PHÂN TUYẾN (DELIVERY TRIPS)
  // =========================================================================

  private seedInitialTrips(): void {
    const trip1: DeliveryTripEntity = {
      id: 'trip-001',
      tripCode: 'TRIP-2610-001',
      name: 'Chuyến giao Miền Đông - Tuyến Bình Dương & Đồng Nai',
      routeArea: 'Bình Dương - Đồng Nai',
      warehouseId: '11111111-0000-0000-0000-000000000001',
      warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
      driverName: 'Nguyễn Văn Hùng',
      driverPhone: '0908123456',
      vehicleNumber: '61C-456.78',
      vehicleType: 'Xe tải 2.5T Thaco',
      departureDate: new Date(),
      status: DeliveryTripStatus.IN_TRANSIT,
      stops: [
        {
          id: 'stop-001',
          tripId: 'trip-001',
          shipmentId: 'shp-001',
          orderCode: 'DH2609-09876',
          stopOrder: 1,
          customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
          receiverName: 'Anh Tuấn',
          receiverPhone: '0988123456',
          deliveryAddress: 'Kho số 12, KCN Đình Trám, Bắc Giang',
          packageCount: 15,
          codAmount: 0,
          status: 'PENDING',
        },
        {
          id: 'stop-002',
          tripId: 'trip-001',
          shipmentId: 'shp-1792084366553',
          orderCode: 'DH2610-62440',
          stopOrder: 2,
          customerName: 'Công Ty TNHH Thương Mại & Phân Phối Minh Khang',
          receiverName: 'Khánh',
          receiverPhone: '0563408845',
          deliveryAddress: 'Tổ 10 Gia Sàng',
          packageCount: 28,
          codAmount: 14500000,
          status: 'DELIVERED',
          deliveredAt: new Date(),
        },
      ],
      totalStops: 2,
      deliveredStops: 1,
      totalCodAmount: 14500000,
      note: 'Ưu tiên giao điểm 1 trước 11h trưa để đại lý kịp nhập kho',
      createdAt: new Date(Date.now() - 14400000),
      updatedAt: new Date(),
    };

    const trip2: DeliveryTripEntity = {
      id: 'trip-002',
      tripCode: 'TRIP-2610-002',
      name: 'Tuyến Nội thành Hà Nội - Buổi chiều',
      routeArea: 'Hà Nội - Hoàn Kiếm & Ba Đình',
      warehouseId: '11111111-0000-0000-0000-000000000002',
      warehouseName: 'Kho Miền Bắc (Hà Nội)',
      driverName: 'Trần Quốc Tuấn',
      driverPhone: '0912348899',
      vehicleNumber: '29D-789.12',
      vehicleType: 'Xe van 1.25T Hyundai',
      departureDate: new Date(Date.now() + 3600000),
      status: DeliveryTripStatus.ASSIGNED,
      stops: [
        {
          id: 'stop-003',
          tripId: 'trip-002',
          shipmentId: 'shp-1792084655213',
          orderCode: 'DH2610-10212',
          stopOrder: 1,
          customerName: 'Đại Lý Thực Phẩm Sạch Thăng Long',
          receiverName: 'Ánh',
          receiverPhone: '0562546558',
          deliveryAddress: 'Tổ 6 Tân Thịnh',
          packageCount: 12,
          codAmount: 8200000,
          status: 'PENDING',
        },
      ],
      totalStops: 1,
      deliveredStops: 0,
      totalCodAmount: 8200000,
      note: 'Đường phố cổ cấm tải giờ cao điểm, xe van vào sau 14h',
      createdAt: new Date(Date.now() - 3600000),
      updatedAt: new Date(),
    };

    this.trips.set(trip1.id, trip1);
    this.trips.set(trip2.id, trip2);

    const s1 = this.shipments.get('shp-001');
    if (s1) {
      s1.tripId = trip1.id;
      s1.tripCode = trip1.tripCode;
    }
    const s2 = this.shipments.get('shp-1792084366553');
    if (s2) {
      s2.tripId = trip1.id;
      s2.tripCode = trip1.tripCode;
    }
    const s3 = this.shipments.get('shp-1792084655213');
    if (s3) {
      s3.tripId = trip2.id;
      s3.tripCode = trip2.tripCode;
    }
  }

  /**
   * Danh sách chuyến giao hàng (SN-196)
   */
  async findAllTrips(query?: {
    routeArea?: string;
    status?: DeliveryTripStatus;
    search?: string;
  }): Promise<DeliveryTripEntity[]> {
    let list = Array.from(this.trips.values());

    // Cập nhật trạng thái các stop theo trạng thái thực tế của shipment
    for (const trip of list) {
      let deliveredCount = 0;
      for (const stop of trip.stops) {
        const shp = this.shipments.get(stop.shipmentId);
        if (shp) {
          if (shp.status === 'DELIVERED') {
            stop.status = 'DELIVERED';
            stop.deliveredAt = shp.deliveredAt;
            deliveredCount++;
          } else if (shp.status === 'PACKED' && shp.failureReason) {
            stop.status = 'FAILED';
            stop.note = `Giao không thành công: ${shp.failureReason}`;
          }
        }
      }
      trip.deliveredStops = deliveredCount;
      if (trip.status === DeliveryTripStatus.IN_TRANSIT && deliveredCount === trip.totalStops && trip.totalStops > 0) {
        trip.status = DeliveryTripStatus.COMPLETED;
        trip.completedAt = trip.completedAt || new Date();
      }
    }

    if (query?.routeArea) {
      const qArea = query.routeArea.toLowerCase().trim();
      list = list.filter((t) => t.routeArea.toLowerCase().includes(qArea));
    }
    if (query?.status) {
      list = list.filter((t) => t.status === query.status);
    }
    if (query?.search) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.tripCode.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.driverName?.toLowerCase().includes(q) ||
          t.vehicleNumber?.toLowerCase().includes(q) ||
          t.routeArea.toLowerCase().includes(q),
      );
    }

    // Sắp xếp chuyến mới nhất lên đầu
    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Chi tiết chuyến giao hàng
   */
  async findTripById(id: string): Promise<DeliveryTripEntity> {
    const trip = this.trips.get(id);
    if (!trip) {
      throw new NotFoundException(`Không tìm thấy chuyến giao hàng với ID ${id}`);
    }

    // Đồng bộ lại trạng thái stop từ shipment
    let deliveredCount = 0;
    for (const stop of trip.stops) {
      const shp = this.shipments.get(stop.shipmentId);
      if (shp) {
        if (shp.status === 'DELIVERED') {
          stop.status = 'DELIVERED';
          stop.deliveredAt = shp.deliveredAt;
          deliveredCount++;
        } else if (shp.status === 'PACKED' && shp.failureReason) {
          stop.status = 'FAILED';
          stop.note = `Giao không thành công: ${shp.failureReason}`;
        }
      }
    }
    trip.deliveredStops = deliveredCount;
    return trip;
  }

  /**
   * Tạo chuyến giao hàng mới gom nhiều phiếu xuất (SN-196 AC 1 & 2)
   */
  async createTrip(
    dto: CreateDeliveryTripDto,
    currentUser?: ICurrentUser,
  ): Promise<DeliveryTripEntity> {
    if (!dto.name || !dto.name.trim()) {
      throw new BadRequestException('Tên chuyến giao không được để trống');
    }
    if (!dto.routeArea || !dto.routeArea.trim()) {
      throw new BadRequestException('Khu vực tuyến giao không được để trống');
    }
    if (!dto.shipmentIds || dto.shipmentIds.length === 0) {
      throw new BadRequestException('Chuyến giao phải có ít nhất 1 phiếu xuất kho');
    }

    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const tripCode = dto.tripCode || `TRIP-${year.toString().slice(-2)}${month}-${randomSuffix}`;
    const id = `trip-${Date.now()}`;

    // Lấy thông tin các phiếu xuất được gom
    const stops: DeliveryTripStopEntity[] = [];
    let totalCod = 0;

    for (let i = 0; i < dto.shipmentIds.length; i++) {
      const sId = dto.shipmentIds[i];
      const shp = this.shipments.get(sId);
      if (!shp) {
        throw new BadRequestException(`Không tìm thấy phiếu xuất kho với ID ${sId}`);
      }
      if (shp.status === 'DELIVERED' || shp.status === 'CANCELLED') {
        throw new BadRequestException(`Phiếu ${shp.id} đã ở trạng thái ${shp.status}, không thể gom vào chuyến mới`);
      }

      const stop: DeliveryTripStopEntity = {
        id: `stop-${Date.now()}-${i + 1}`,
        tripId: id,
        shipmentId: shp.id,
        orderCode: shp.orderCode,
        stopOrder: i + 1,
        customerName: shp.customerName,
        receiverName: shp.receiverName || 'Đại lý',
        receiverPhone: shp.phone || '',
        deliveryAddress: shp.deliveryAddress || 'Tại kho đại lý',
        packageCount: 1,
        codAmount: 0,
        status: 'PENDING',
      };
      stops.push(stop);
      totalCod += stop.codAmount || 0;

      // Cập nhật shipment
      shp.tripId = id;
      shp.tripCode = tripCode;
      if (dto.driverName) {
        shp.carrierName = `Tài xế: ${dto.driverName} (${dto.vehicleNumber || 'Xe riêng'})`;
      }
      this.shipments.set(shp.id, shp);
    }

    const initialStatus = dto.driverName && dto.vehicleNumber
      ? DeliveryTripStatus.ASSIGNED
      : DeliveryTripStatus.DRAFT;

    const newTrip: DeliveryTripEntity = {
      id,
      tripCode,
      name: dto.name.trim(),
      routeArea: dto.routeArea.trim(),
      warehouseId: dto.warehouseId || '11111111-0000-0000-0000-000000000001',
      warehouseName: dto.warehouseName || 'Kho Miền Nam (TP. Hồ Chí Minh)',
      driverName: dto.driverName?.trim(),
      driverPhone: dto.driverPhone?.trim(),
      vehicleNumber: dto.vehicleNumber?.trim(),
      vehicleType: dto.vehicleType?.trim(),
      departureDate: dto.departureDate ? new Date(dto.departureDate) : new Date(),
      status: initialStatus,
      stops,
      totalStops: stops.length,
      deliveredStops: 0,
      totalCodAmount: totalCod,
      note: dto.note?.trim(),
      createdBy: currentUser?.email || currentUser?.username || 'Quản lý kho',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.trips.set(id, newTrip);
    this.logger.log(`[ShipmentsService] Đã tạo chuyến giao hàng ${tripCode} gồm ${stops.length} điểm giao`);
    return newTrip;
  }

  /**
   * Cập nhật chuyến giao hàng (SN-196)
   */
  async updateTrip(id: string, dto: UpdateDeliveryTripDto): Promise<DeliveryTripEntity> {
    const trip = await this.findTripById(id);

    if (dto.name !== undefined) trip.name = dto.name.trim();
    if (dto.routeArea !== undefined) trip.routeArea = dto.routeArea.trim();
    if (dto.driverName !== undefined) trip.driverName = dto.driverName.trim();
    if (dto.driverPhone !== undefined) trip.driverPhone = dto.driverPhone.trim();
    if (dto.vehicleNumber !== undefined) trip.vehicleNumber = dto.vehicleNumber.trim();
    if (dto.vehicleType !== undefined) trip.vehicleType = dto.vehicleType.trim();
    if (dto.departureDate !== undefined) trip.departureDate = new Date(dto.departureDate);
    if (dto.note !== undefined) trip.note = dto.note.trim();

    if (dto.status !== undefined) {
      trip.status = dto.status;
      if (dto.status === DeliveryTripStatus.COMPLETED) {
        trip.completedAt = new Date();
      }
    }

    // Nếu gán tài xế thì cập nhật thông tin vận chuyển vào các phiếu xuất con
    if (trip.driverName) {
      for (const stop of trip.stops) {
        const shp = this.shipments.get(stop.shipmentId);
        if (shp) {
          shp.carrierName = `Tài xế: ${trip.driverName} (${trip.vehicleNumber || 'Xe riêng'})`;
          this.shipments.set(shp.id, shp);
        }
      }
    }

    trip.updatedAt = new Date();
    this.trips.set(id, trip);
    return trip;
  }

  /**
   * Gán tài xế và phương tiện cho chuyến (SN-196 AC 2)
   */
  async assignDriver(id: string, dto: AssignDriverDto): Promise<DeliveryTripEntity> {
    const trip = await this.findTripById(id);
    if (!dto.driverName?.trim()) {
      throw new BadRequestException('Tên tài xế không được để trống');
    }
    if (!dto.vehicleNumber?.trim()) {
      throw new BadRequestException('Biển số xe không được để trống');
    }

    trip.driverName = dto.driverName.trim();
    trip.driverPhone = dto.driverPhone?.trim();
    trip.vehicleNumber = dto.vehicleNumber.trim();
    if (dto.vehicleType) trip.vehicleType = dto.vehicleType.trim();

    if (trip.status === DeliveryTripStatus.DRAFT) {
      trip.status = DeliveryTripStatus.ASSIGNED;
    }

    // Cập nhật thông tin tài xế cho các phiếu xuất
    for (const stop of trip.stops) {
      const shp = this.shipments.get(stop.shipmentId);
      if (shp) {
        shp.carrierName = `Tài xế: ${trip.driverName} (${trip.vehicleNumber})`;
        this.shipments.set(shp.id, shp);
      }
    }

    trip.updatedAt = new Date();
    this.trips.set(id, trip);
    return trip;
  }

  /**
   * Xuất phát chuyến giao hàng (Đổi trạng thái sang IN_TRANSIT và chuyển các phiếu xuất sang SHIPPED)
   */
  async dispatchTrip(id: string): Promise<DeliveryTripEntity> {
    const trip = await this.findTripById(id);
    if (!trip.driverName || !trip.vehicleNumber) {
      throw new BadRequestException('Chuyến giao phải được gán tài xế và biển số xe trước khi xuất phát');
    }

    trip.status = DeliveryTripStatus.IN_TRANSIT;
    trip.updatedAt = new Date();

    // Chuyển toàn bộ các phiếu xuất kho trong chuyến sang SHIPPED
    for (const stop of trip.stops) {
      const shp = this.shipments.get(stop.shipmentId);
      if (shp && shp.status !== 'DELIVERED' && shp.status !== 'CANCELLED') {
        shp.status = 'SHIPPED';
        shp.shippedAt = new Date();
        shp.carrierName = `Tài xế: ${trip.driverName} (${trip.vehicleNumber})`;
        this.shipments.set(shp.id, shp);

        // Đồng bộ đơn hàng sang SHIPPED
        if (shp.orderCode || shp.orderId) {
          await this.syncOrder(shp.orderCode || shp.orderId, 'SHIPPED');
        }
      }
    }

    this.trips.set(id, trip);
    this.logger.log(`[ShipmentsService] Chuyến giao ${trip.tripCode} đã xuất phát (IN_TRANSIT)`);
    return trip;
  }

  /**
   * Hoàn thành chuyến giao hàng
   */
  async completeTrip(id: string): Promise<DeliveryTripEntity> {
    const trip = await this.findTripById(id);
    trip.status = DeliveryTripStatus.COMPLETED;
    trip.completedAt = new Date();
    trip.updatedAt = new Date();
    this.trips.set(id, trip);
    return trip;
  }

  /**
   * Hủy chuyến giao hàng (trả lại các phiếu xuất để gom vào chuyến khác)
   */
  async cancelTrip(id: string, reason?: string): Promise<DeliveryTripEntity> {
    const trip = await this.findTripById(id);
    trip.status = DeliveryTripStatus.CANCELLED;
    if (reason) {
      trip.note = trip.note ? `${trip.note} (Lý do hủy: ${reason})` : `Lý do hủy: ${reason}`;
    }
    trip.updatedAt = new Date();

    // Gỡ trip khỏi các phiếu xuất chưa giao
    for (const stop of trip.stops) {
      const shp = this.shipments.get(stop.shipmentId);
      if (shp && shp.status !== 'DELIVERED') {
        delete shp.tripId;
        delete shp.tripCode;
        this.shipments.set(shp.id, shp);
      }
    }

    this.trips.set(id, trip);
    return trip;
  }

  /**
   * Xóa chuyến giao hàng
   */
  async deleteTrip(id: string): Promise<{ success: boolean; message: string }> {
    const trip = await this.findTripById(id);
    for (const stop of trip.stops) {
      const shp = this.shipments.get(stop.shipmentId);
      if (shp) {
        delete shp.tripId;
        delete shp.tripCode;
        this.shipments.set(shp.id, shp);
      }
    }
    this.trips.delete(id);
    return { success: true, message: `Đã xóa chuyến giao hàng ${trip.tripCode}` };
  }

  /**
   * Lấy dữ liệu in ấn danh sách điểm giao (Delivery Manifest) (SN-196 AC 3)
   */
  async getTripManifest(id: string) {
    const trip = await this.findTripById(id);
    return {
      trip,
      stops: trip.stops,
      printedAt: new Date(),
    };
  }

  /**
   * Xóa phiếu xuất kho
   */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const shipment = await this.findById(id);
    this.shipments.delete(id);
    return { success: true, message: `Đã xóa phiếu xuất kho ${shipment.id}` };
  }

  /**
   * Đồng bộ trạng thái đơn hàng khi phiếu xuất kho thay đổi
   */
  private async syncOrder(orderIdOrCode: string, shipmentStatus: string): Promise<void> {
    if (!orderIdOrCode || orderIdOrCode === 'DH-UNKNOWN' || orderIdOrCode === 'ord-unknown') return;
    try {
      if (this.ordersService) {
        await this.ordersService.syncOrderStatusFromShipment(orderIdOrCode, shipmentStatus);
      } else if (this.databaseService?.isConnected()) {
        let targetStatus: string | null = null;
        if (shipmentStatus === 'PICKING') targetStatus = 'PROCESSING';
        else if (shipmentStatus === 'PACKED') targetStatus = 'PACKED';
        else if (shipmentStatus === 'SHIPPED') targetStatus = 'SHIPPED';
        else if (shipmentStatus === 'DELIVERED') targetStatus = 'DELIVERED';
        else if (shipmentStatus === 'CANCELLED') targetStatus = 'APPROVED';
        else if (shipmentStatus === 'PENDING') targetStatus = 'PROCESSING';

        if (targetStatus) {
          const rows = await this.databaseService.query<{ payload: any }>(
            'SELECT payload FROM app_order_records WHERE id = $1 OR order_code = $1 LIMIT 1',
            [orderIdOrCode],
          );
          if (rows[0]?.payload) {
            const payload = rows[0].payload;
            payload.status = targetStatus;
            payload.updatedAt = new Date();
            await this.databaseService.query(
              'UPDATE app_order_records SET payload = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2 OR order_code = $2',
              [JSON.stringify(payload), orderIdOrCode],
            );
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Lỗi khi syncOrder (${orderIdOrCode}): ${e}`);
    }
  }
}


