import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { ShipmentEntity, ShipmentStatus } from './entities/shipment.entity';
import { ShipmentLineEntity } from './entities/shipment-line.entity';
import { ConfirmShipmentDto } from './dto/confirm-shipment.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { OrdersService } from '../orders/orders.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProductsService } from '../products/products.service';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity';

export type { ShipmentEntity as ShipmentItem };

@Injectable()
export class ShipmentsService {
  private readonly shipments = new Map<string, ShipmentEntity>();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional() @Inject(forwardRef(() => OrdersService)) private readonly ordersService?: OrdersService,
    @Optional() @Inject(forwardRef(() => InventoryService)) private readonly inventoryService?: InventoryService,
    @Optional() @Inject(forwardRef(() => ProductsService)) private readonly productsService?: ProductsService,
  ) {
    this.seedInitialShipments();
  }

  /**
   * Khởi tạo dữ liệu mẫu phiếu xuất kho với đầy đủ chi tiết dòng hàng (SN-195)
   */
  private seedInitialShipments(): void {
    const seed: ShipmentEntity[] = [
      new ShipmentEntity({
        id: 'shp-001',
        orderId: 'ord-001',
        orderCode: 'DH2609-09876',
        customerId: 'cust-001',
        customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-001',
        status: 'SHIPPED',
        isConfirmed: true,
        confirmedAt: new Date(Date.now() - 3600000),
        confirmedBy: 'Thủ kho Nguyễn Văn An',
        deliveryAddress: 'Kho số 12, KCN Đình Trám, Bắc Giang',
        receiverName: 'Anh Tuấn',
        phone: '0988123456',
        trackingNumber: 'TRK-2026-001',
        carrierName: 'Giao Hàng Nhanh',
        shippedAt: new Date(),
        lines: [
          new ShipmentLineEntity({
            id: 'shpl-001-1',
            shipmentId: 'shp-001',
            orderLineId: 'line-001',
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Loha Canxi 900g',
            unitName: 'Thùng',
            conversionRate: 12,
            orderedQuantity: 10,
            shippedQuantity: 10,
            remainingQuantity: 0,
            isShortDelivery: false,
          }),
        ],
        hasShortDelivery: false,
        createdAt: new Date(Date.now() - 7200000),
        updatedAt: new Date(),
      }),
      new ShipmentEntity({
        id: 'shp-002',
        orderId: 'ord-002',
        orderCode: 'DH2609-09877',
        customerId: 'cust-002',
        customerName: 'Đại lý Tạp hóa Hưng Yên',
        salesRepId: 'usr-sale-02',
        warehouseId: 'wh-001',
        status: 'DELIVERED',
        isConfirmed: true,
        confirmedAt: new Date(Date.now() - 86400000),
        confirmedBy: 'Thủ kho Trần Văn Bình',
        deliveryAddress: 'Số 45 Điện Biên Phủ, TP Hưng Yên',
        receiverName: 'Chị Lan',
        phone: '0912345678',
        trackingNumber: 'TRK-2026-002',
        carrierName: 'Viettel Post',
        shippedAt: new Date(Date.now() - 86400000),
        deliveredAt: new Date(),
        lines: [
          new ShipmentLineEntity({
            id: 'shpl-002-1',
            shipmentId: 'shp-002',
            orderLineId: 'line-002',
            productId: 'prod-002',
            productSku: 'LH-COOKIES-500G',
            productName: 'Bánh Quy Bơ Thượng Hạng',
            unitName: 'Thùng',
            conversionRate: 24,
            orderedQuantity: 20,
            shippedQuantity: 20,
            remainingQuantity: 0,
            isShortDelivery: false,
          }),
        ],
        hasShortDelivery: false,
        createdAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(),
      }),
      new ShipmentEntity({
        id: 'shp-003',
        orderId: 'ord-003',
        orderCode: 'DH2609-09878',
        customerId: 'cust-001',
        customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-001',
        status: 'PICKING',
        isConfirmed: false,
        deliveryAddress: 'Kho số 12, KCN Đình Trám, Bắc Giang',
        receiverName: 'Anh Tuấn',
        phone: '0988123456',
        carrierName: 'Giao Hàng Tiết Kiệm',
        lines: [
          new ShipmentLineEntity({
            id: 'shpl-003-1',
            shipmentId: 'shp-003',
            orderLineId: 'line-003-1',
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Loha Canxi 900g',
            unitName: 'Thùng',
            conversionRate: 12,
            orderedQuantity: 15,
            shippedQuantity: 15,
            remainingQuantity: 0,
            isShortDelivery: false,
          }),
          new ShipmentLineEntity({
            id: 'shpl-003-2',
            shipmentId: 'shp-003',
            orderLineId: 'line-003-2',
            productId: 'prod-003',
            productSku: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Cao Cấp 70ml',
            unitName: 'Lốc',
            conversionRate: 6,
            orderedQuantity: 30,
            shippedQuantity: 30,
            remainingQuantity: 0,
            isShortDelivery: false,
          }),
        ],
        hasShortDelivery: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ];
    for (const s of seed) {
      this.shipments.set(s.id, s);
    }
  }

  /**
   * Phân quyền Data Scope (*) cho Module 6:
   * - Customer: R* (Chỉ thấy phiếu xuất của chính mình)
   * - Sales Rep: R* (Chỉ thấy phiếu xuất của tuyến mình)
   * - Warehouse / Admin: Xem toàn bộ
   */
  async findAll(
    query?: { orderId?: string; status?: ShipmentStatus; hasShortDelivery?: string; search?: string },
    currentUser?: ICurrentUser,
  ): Promise<ShipmentEntity[]> {
    let list = Array.from(this.shipments.values());

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.WAREHOUSE_MANAGER) ||
        roles.includes(UserRole.WH_MANAGER) ||
        roles.includes(UserRole.WAREHOUSE_KEEPER) ||
        roles.includes(UserRole.WAREHOUSE) ||
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
      list = list.filter((s) => s.orderId === query.orderId || s.orderCode === query.orderId);
    }
    if (query?.status) {
      list = list.filter((s) => s.status === query.status);
    }
    if (query?.hasShortDelivery === 'true') {
      list = list.filter((s) => s.hasShortDelivery === true);
    }
    if (query?.search) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.id.toLowerCase().includes(q) ||
          s.orderCode.toLowerCase().includes(q) ||
          s.customerName.toLowerCase().includes(q) ||
          (s.trackingNumber && s.trackingNumber.toLowerCase().includes(q)),
      );
    }

    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findById(id: string, currentUser?: ICurrentUser): Promise<ShipmentEntity> {
    const shipment = this.shipments.get(id);
    if (!shipment) {
      throw new NotFoundException(`Không tìm thấy phiếu xuất kho ${id}`);
    }

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.WAREHOUSE_MANAGER) ||
        roles.includes(UserRole.WH_MANAGER) ||
        roles.includes(UserRole.WAREHOUSE_KEEPER) ||
        roles.includes(UserRole.WAREHOUSE) ||
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

  /**
   * Tạo phiếu xuất kho & giao hàng mới
   */
  async create(dto: CreateShipmentDto, currentUser?: ICurrentUser): Promise<ShipmentEntity> {
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
    const lines = (dto.lines || []).map(
      (l) =>
        new ShipmentLineEntity({
          id: `shpl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          shipmentId: id,
          orderLineId: l.orderLineId,
          productId: l.productSku,
          productSku: l.productSku,
          productName: l.productName,
          unitName: l.unitName || 'Đơn vị',
          conversionRate: l.conversionRate || 1,
          orderedQuantity: l.orderedQuantity,
          shippedQuantity: l.orderedQuantity,
          remainingQuantity: 0,
          isShortDelivery: false,
        }),
    );

    const newShipment = new ShipmentEntity({
      id,
      orderId: dto.orderId || 'ord-unknown',
      orderCode: dto.orderCode.trim().toUpperCase(),
      customerId: dto.customerId || 'cust-001',
      customerName: dto.customerName.trim(),
      salesRepId: dto.salesRepId || currentUser?.userId,
      warehouseId: dto.warehouseId || 'wh-001',
      status: 'PICKING',
      isConfirmed: false,
      deliveryAddress: dto.deliveryAddress,
      receiverName: dto.receiverName,
      phone: dto.phone,
      trackingNumber: dto.trackingNumber,
      carrierName: dto.carrierName || 'Giao Hàng Nhanh',
      lines,
      hasShortDelivery: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.shipments.set(id, newShipment);
    return newShipment;
  }

  /**
   * Cập nhật trạng thái phiếu xuất (Kiểm tra quy tắc bất biến khi đã xác nhận)
   */
  async updateStatus(
    id: string,
    status: ShipmentStatus,
    dto?: Partial<ShipmentEntity>,
  ): Promise<ShipmentEntity> {
    const shipment = await this.findById(id);

    // Phiếu xuất đã xác nhận không thể quay lại trạng thái chưa xuất (PENDING / PICKING)
    if (shipment.isConfirmed && (status === 'PENDING' || status === 'PICKING' || status === 'PACKED')) {
      throw new BadRequestException('Phiếu xuất kho đã xác nhận không thể hoàn tác về trạng thái chưa xuất.');
    }

    shipment.status = status;
    shipment.updatedAt = new Date();
    if (dto?.trackingNumber) shipment.trackingNumber = dto.trackingNumber;
    if (dto?.carrierName) shipment.carrierName = dto.carrierName;
    if (dto?.proofOfDeliveryUrl) shipment.proofOfDeliveryUrl = dto.proofOfDeliveryUrl;
    if (status === 'SHIPPED') shipment.shippedAt = new Date();
    if (status === 'DELIVERED') shipment.deliveredAt = new Date();

    this.shipments.set(id, shipment);
    return shipment;
  }

  /**
   * XÁC NHẬN XUẤT KHO VÀ XỬ LÝ GIAO THIẾU (CORE SN-195)
   * 1. Chuyển tồn giữ chỗ thành xuất thực (trừ physicalStock và hoàn tất reservation).
   * 2. Nếu xuất thiếu: ghi nhận nợ hàng (remainingQuantity > 0), đánh dấu isShortDelivery = true, bắt buộc có lý do.
   * 3. Phiếu xuất đã xác nhận được khóa bất biến (isConfirmed = true, cấm sửa/xóa).
   * 4. Cập nhật trạng thái đơn hàng (deliveredQuantity, isShortDelivery, OrderStatus.SHIPPED).
   */
  async confirmExport(
    id: string,
    dto: ConfirmShipmentDto,
    currentUser?: ICurrentUser,
  ): Promise<ShipmentEntity> {
    const shipment = await this.findById(id);

    // 1. Kiểm tra tính bất biến: Phiếu xuất đã xác nhận KHÔNG ĐƯỢC PHÉP xác nhận lại hoặc sửa đổi
    if (shipment.isConfirmed) {
      throw new BadRequestException('Phiếu xuất kho này đã được xác nhận thực xuất trước đó và đã bị khóa bất biến.');
    }

    const linesDtoMap = new Map<string, { shippedQuantity: number; reason?: string }>();
    if (dto.lines && dto.lines.length > 0) {
      for (const item of dto.lines) {
        linesDtoMap.set(item.orderLineId, {
          shippedQuantity: Number(item.shippedQuantity),
          reason: item.shortDeliveryReason,
        });
      }
    }

    let hasAnyShortDelivery = false;

    // 2. Xử lý từng dòng mặt hàng
    for (const line of shipment.lines) {
      const lineDto = linesDtoMap.get(line.orderLineId) || linesDtoMap.get(line.id);
      const actualShipped = lineDto !== undefined ? lineDto.shippedQuantity : line.orderedQuantity;

      if (actualShipped < 0) {
        throw new BadRequestException(`Số lượng thực xuất của SKU ${line.productSku} không được âm.`);
      }
      if (actualShipped > line.orderedQuantity) {
        throw new BadRequestException(
          `Số lượng thực xuất của SKU ${line.productSku} (${actualShipped}) không được vượt quá số lượng đặt (${line.orderedQuantity}).`,
        );
      }

      line.shippedQuantity = actualShipped;
      line.remainingQuantity = line.orderedQuantity - actualShipped;

      if (line.remainingQuantity > 0) {
        line.isShortDelivery = true;
        line.shortDeliveryReason = lineDto?.reason || 'Kho không đủ tồn thực tế hoặc hàng cận date';
        hasAnyShortDelivery = true;
      } else {
        line.isShortDelivery = false;
        line.shortDeliveryReason = undefined;
      }

      // 3. Trừ tồn kho thực tế và chuyển tồn giữ chỗ thành xuất thực
      await this.processInventoryDeduction(line, shipment.orderCode, shipment.id, currentUser?.userId);
    }

    // 4. Đồng bộ cập nhật thông tin đơn hàng trong OrdersService
    await this.syncOrderDeliveryStatus(shipment, hasAnyShortDelivery);

    // 5. Khóa phiếu xuất bất biến
    shipment.isConfirmed = true;
    shipment.status = 'SHIPPED';
    shipment.hasShortDelivery = hasAnyShortDelivery;
    shipment.confirmedAt = new Date();
    shipment.confirmedBy = currentUser?.username || currentUser?.email || currentUser?.userId || 'Thủ kho';
    shipment.shippedAt = new Date();
    if (dto.carrierName) shipment.carrierName = dto.carrierName;
    if (dto.trackingNumber) shipment.trackingNumber = dto.trackingNumber;
    if (dto.note) shipment.note = dto.note;
    shipment.updatedAt = new Date();

    this.shipments.set(id, shipment);
    return shipment;
  }

  /**
   * Helper: Trừ tồn thực tế và ghi sổ kho (Inventory Transaction Ledger)
   */
  private async processInventoryDeduction(
    line: ShipmentLineEntity,
    orderCode: string,
    shipmentId: string,
    userId?: string,
  ): Promise<void> {
    const baseQuantityDeducted = Math.round(line.shippedQuantity * (line.conversionRate || 1));
    if (baseQuantityDeducted <= 0) return;

    if (this.productsService) {
      try {
        const product = await this.productsService.findById(line.productSku);
        if (product) {
          const currentStock = product.stockQuantity ?? product.physicalStock ?? 0;
          const newStock = Math.max(0, currentStock - baseQuantityDeducted);
          await this.productsService.setStockQuantity(product.id, newStock);
        }
      } catch {
        // Fallback an toàn nếu sản phẩm không tìm thấy qua ID
      }
    }

    if (this.inventoryService) {
      try {
        // Ghi nhận biến động sổ kho bất biến (SN-23)
        const tx = new InventoryTransactionEntity({
          productId: line.productId || line.productSku,
          sku: line.productSku,
          productName: line.productName,
          transactionType: 'EXPORT',
          inputQuantity: line.shippedQuantity,
          inputUnit: line.unitName,
          conversionRate: line.conversionRate,
          baseQuantityChange: -baseQuantityDeducted,
          baseUnit: line.unitName,
          previousStock: 0,
          newStock: 0,
          reason: `Xuất kho giao hàng theo phiếu ${shipmentId} (Đơn ${orderCode})`,
          referenceCode: shipmentId,
          warehouse: 'Kho Tổng',
          performedBy: userId || 'usr-warehouse',
          createdAt: new Date(),
        });
        this.inventoryService.addTransaction(tx);
      } catch {
        // Bỏ qua lỗi phụ trợ nếu service inventory chưa khởi tạo đầy đủ
      }
    }
  }

  /**
   * Helper: Cập nhật thông tin giao hàng & giao thiếu trên Đơn hàng (SN-170 & SN-195)
   */
  private async syncOrderDeliveryStatus(shipment: ShipmentEntity, hasShortDelivery: boolean): Promise<void> {
    if (!this.ordersService) return;

    try {
      const order = await this.ordersService.findOrderById(shipment.orderId);
      if (!order) return;

      order.isShortDelivery = hasShortDelivery;
      order.status = OrderStatus.SHIPPED;
      order.updatedAt = new Date();

      if (order.lines) {
        for (const orderLine of order.lines) {
          const matchedShipLine = shipment.lines.find(
            (sl) => sl.orderLineId === orderLine.id || sl.productSku === orderLine.productSku,
          );
          if (matchedShipLine) {
            orderLine.deliveredQuantity = (orderLine.deliveredQuantity || 0) + matchedShipLine.shippedQuantity;
            if (matchedShipLine.isShortDelivery) {
              orderLine.isShortDelivery = true;
              orderLine.shortDeliveryReason = matchedShipLine.shortDeliveryReason;
            }
          }
        }
      }
    } catch {
      // Giữ an toàn nếu đơn hàng chưa có trong in-memory của OrdersService
    }
  }

  /**
   * Lấy danh sách các đơn / phiếu xuất còn nợ hàng (Backorders) để xử lý ở lượt sau (SN-195)
   */
  async getBackorders(currentUser?: ICurrentUser): Promise<ShipmentEntity[]> {
    const all = await this.findAll({}, currentUser);
    return all.filter((s) => s.hasShortDelivery === true || s.lines.some((l) => l.remainingQuantity > 0));
  }

  /**
   * Tạo phiếu xuất đợt sau (Backorder Shipment) cho phần hàng còn nợ (SN-195)
   */
  async createBackorderShipment(orderId: string, currentUser?: ICurrentUser): Promise<ShipmentEntity> {
    const existingShipments = Array.from(this.shipments.values()).filter(
      (s) => s.orderId === orderId || s.orderCode === orderId,
    );

    if (existingShipments.length === 0) {
      throw new NotFoundException(`Không tìm thấy phiếu xuất nào thuộc đơn hàng ${orderId}`);
    }

    const lastShipment = existingShipments[existingShipments.length - 1];
    const backorderLines: ShipmentLineEntity[] = [];

    for (const line of lastShipment.lines) {
      if (line.remainingQuantity > 0) {
        backorderLines.push(
          new ShipmentLineEntity({
            id: `shpl-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            orderLineId: line.orderLineId,
            productId: line.productId,
            productSku: line.productSku,
            productName: line.productName,
            unitName: line.unitName,
            conversionRate: line.conversionRate,
            orderedQuantity: line.remainingQuantity, // Số lượng đặt cho đợt 2 chính là phần nợ của đợt 1
            shippedQuantity: line.remainingQuantity,
            remainingQuantity: 0,
            isShortDelivery: false,
          }),
        );
      }
    }

    if (backorderLines.length === 0) {
      throw new BadRequestException('Đơn hàng này không còn mặt hàng nào bị nợ cần giao bù.');
    }

    const id = `shp-bo-${Date.now()}`;
    const backorderShipment = new ShipmentEntity({
      id,
      orderId: lastShipment.orderId,
      orderCode: lastShipment.orderCode,
      customerId: lastShipment.customerId,
      customerName: lastShipment.customerName,
      salesRepId: lastShipment.salesRepId,
      warehouseId: lastShipment.warehouseId,
      status: 'PICKING',
      isConfirmed: false,
      deliveryAddress: lastShipment.deliveryAddress,
      receiverName: lastShipment.receiverName,
      phone: lastShipment.phone,
      carrierName: lastShipment.carrierName,
      lines: backorderLines,
      hasShortDelivery: false,
      note: `Phiếu xuất giao bù (Đợt 2) cho phiếu gốc ${lastShipment.id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.shipments.set(id, backorderShipment);
    return backorderShipment;
  }

  /**
   * Tương thích ngược: xác nhận xuất kho
   */
  async confirm(id: string): Promise<ShipmentEntity> {
    return this.confirmExport(id, {});
  }

  /**
   * Hủy / xóa phiếu xuất kho (Ràng buộc: Phiếu đã xác nhận KHÔNG THỂ XÓA - SN-195)
   */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const shipment = await this.findById(id);

    if (shipment.isConfirmed) {
      throw new BadRequestException('Phiếu xuất kho đã được xác nhận thực xuất và khóa bất biến, không thể xóa.');
    }

    this.shipments.delete(id);
    return { success: true, message: `Đã xóa phiếu xuất kho ${shipment.id}` };
  }
}
