import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
  Inject,
  forwardRef,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { ShipmentEntity, ShipmentStatus } from './entities/shipment.entity';
import { ShipmentLineEntity } from './entities/shipment-line.entity';
import { ConfirmShipmentDto } from './dto/confirm-shipment.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { InventoryService } from '../inventory/inventory.service';
import { ProductsService } from '../products/products.service';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { InventoryTransactionEntity } from '../inventory/entities/inventory-transaction.entity';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
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

export interface ShipmentBatchItem {
  id?: string;
  sku_code: string;
  skuCode?: string;
  product_name?: string;
  productName?: string;
  quantity_requested: number;
  quantityRequested?: number;
  selected_batch_no: string;
  selectedBatchNo?: string;
  fefo_suggested_batch_no?: string;
  fefoSuggestedBatchNo?: string;
  is_overridden: boolean;
  isOverridden?: boolean;
  override_reason?: string | null;
  overrideReason?: string | null;
}

export { ShipmentEntity, ShipmentLineEntity };
export type { ShipmentEntity as ShipmentItemType };

export interface ShipmentItem {
  isConfirmed?: boolean;
  confirmedAt?: Date;
  confirmedBy?: string;
  lines?: ShipmentLineEntity[];
  hasShortDelivery?: boolean;
  note?: string;
  id: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  salesRepId?: string;
  warehouseId?: string;
  warehouseName?: string;
  status: 'PENDING' | 'PICKING' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  deliveryAddress?: string;
  receiverName?: string;
  phone?: string;
  trackingNumber?: string;
  carrierName?: string;
  shippingCarrier?: string;
  proofOfDeliveryUrl?: string;
  deliveryNote?: string;
  failureReason?: string;
  tripId?: string;
  tripCode?: string;
  items?: ShipmentBatchItem[];
  invoiceId?: string;
  invoiceCode?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ShipmentsService implements OnModuleInit {
  private readonly logger = new Logger(ShipmentsService.name);
  private readonly shipments = new Map<string, ShipmentItem>();
  private readonly trips = new Map<string, DeliveryTripEntity>();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService?: OrdersService,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional()
    @Inject(forwardRef(() => InventoryService))
    private readonly inventoryService?: InventoryService,
    @Optional()
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService?: ProductsService,
  ) {
    this.seedInitialShipments();
    this.seedInitialTrips();
  }

  async onModuleInit() {
    await this.ensureShipmentTables();
    await this.loadShipmentsFromDatabase();
  }

  async loadShipmentsFromDatabase(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      const rows = await this.databaseService.query<any>(
        `SELECT s.*, w.name as warehouse_name
         FROM shipments s
         LEFT JOIN warehouses w ON s.warehouse_id = w.id::text OR s.warehouse_id = w.code
         ORDER BY s.created_at DESC;`,
      );
      if (rows) {
        // Đồng bộ xóa: Loại bỏ các phiếu đã bị xóa khỏi database khỏi bộ nhớ
        const dbIds = new Set(rows.map((r: any) => r.id));
        for (const [id] of this.shipments.entries()) {
          if (id.startsWith('shp-1') && !dbIds.has(id)) {
            this.shipments.delete(id);
          }
        }

        for (const r of rows) {
          const existing = this.shipments.get(r.id);
          let items = existing?.items;
          if (!items || items.length === 0) {
            try {
              const itemRows = await this.databaseService.query<any>(
                `SELECT * FROM shipment_items WHERE shipment_id = $1 ORDER BY created_at ASC;`,
                [r.id],
              );
              items = (itemRows || []).map((it: any) => ({
                id: it.id,
                sku_code: it.sku_code,
                skuCode: it.sku_code,
                product_name: it.product_name,
                productName: it.product_name,
                quantity_requested: Number(it.quantity_requested) || 0,
                quantityRequested: Number(it.quantity_requested) || 0,
                selected_batch_no: it.selected_batch_no,
                selectedBatchNo: it.selected_batch_no,
                fefo_suggested_batch_no: it.fefo_suggested_batch_no,
                fefoSuggestedBatchNo: it.fefo_suggested_batch_no,
                is_overridden: it.is_overridden,
                isOverridden: it.is_overridden,
                override_reason: it.override_reason,
                overrideReason: it.override_reason,
              }));
            } catch {
              items = [];
            }
          }

          const shipment: ShipmentItem = {
            id: r.id,
            orderId: r.order_id,
            orderCode: r.order_code,
            customerId: r.customer_id,
            customerName: r.customer_name,
            salesRepId: r.sales_rep_id,
            warehouseId: r.warehouse_id,
            warehouseName: r.warehouse_name,
            status: r.status,
            isConfirmed: r.is_confirmed !== undefined && r.is_confirmed !== null ? Boolean(r.is_confirmed) : Boolean(existing?.isConfirmed),
            confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : existing?.confirmedAt,
            confirmedBy: r.confirmed_by || existing?.confirmedBy,
            hasShortDelivery: r.has_short_delivery !== undefined && r.has_short_delivery !== null
              ? Boolean(r.has_short_delivery)
              : Boolean(existing?.hasShortDelivery || (existing?.lines && existing.lines.some((l) => (l.remainingQuantity || 0) > 0 || l.isShortDelivery))),
            lines: existing?.lines || [],
            deliveryAddress: r.delivery_address,
            receiverName: r.receiver_name,
            phone: r.phone,
            carrierName: r.carrier_name,
            shippingCarrier: r.carrier_name,
            trackingNumber: r.tracking_number,
            proofOfDeliveryUrl: r.proof_of_delivery_url,
            deliveryNote: r.delivery_note,
            failureReason: r.failure_reason,
            tripId: r.trip_id,
            tripCode: r.trip_code,
            invoiceId: r.invoice_id,
            invoiceCode: r.invoice_code,
            shippedAt: r.shipped_at ? new Date(r.shipped_at) : undefined,
            deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
            createdAt: r.created_at ? new Date(r.created_at) : new Date(),
            updatedAt: r.updated_at ? new Date(r.updated_at) : new Date(),
            items,
          };
          this.shipments.set(shipment.id, shipment);
        }
        this.logger.log(`[Shipments] Đã nạp ${rows.length} phiếu xuất kho từ cơ sở dữ liệu PostgreSQL.`);
      }
    } catch (err) {
      this.logger.warn(`Lỗi nạp phiếu xuất từ database: ${err}`);
    }
  }

  async ensureShipmentTables(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS shipments (
          id VARCHAR(100) PRIMARY KEY,
          order_id VARCHAR(100) NOT NULL,
          order_code VARCHAR(100),
          customer_id VARCHAR(100),
          customer_name VARCHAR(255),
          sales_rep_id VARCHAR(100),
          warehouse_id VARCHAR(100),
          status VARCHAR(50) DEFAULT 'PICKING',
          delivery_address TEXT,
          receiver_name VARCHAR(255),
          phone VARCHAR(50),
          carrier_name VARCHAR(100),
          tracking_number VARCHAR(100),
          proofOfDeliveryUrl TEXT,
          delivery_note TEXT,
          failure_reason TEXT,
          trip_id VARCHAR(100),
          trip_code VARCHAR(100),
          created_by VARCHAR(100),
          invoice_id VARCHAR(100),
          invoice_code VARCHAR(100),
          shipped_at TIMESTAMPTZ,
          delivered_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        -- Đảm bảo các cột mở rộng SN-195 và invoice tồn tại nếu bảng đã được tạo trước đó
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(100);
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS invoice_code VARCHAR(100);
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN DEFAULT FALSE;
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS has_short_delivery BOOLEAN DEFAULT FALSE;
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR(100);
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS note TEXT;

        CREATE TABLE IF NOT EXISTS shipment_items (
          id BIGSERIAL PRIMARY KEY,
          shipment_id VARCHAR(100) NOT NULL,
          sku_code VARCHAR(100) NOT NULL,
          product_name VARCHAR(255),
          quantity_requested NUMERIC(15, 2) NOT NULL DEFAULT 1,
          selected_batch_no VARCHAR(100) NOT NULL,
          fefo_suggested_batch_no VARCHAR(100),
          is_overridden BOOLEAN DEFAULT FALSE,
          override_reason TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_shipment_items_shipment_id ON shipment_items(shipment_id);
      `);
    } catch (err) {
      this.logger.warn(`Lỗi tạo bảng shipments/shipment_items: ${err}`);
    }
  }

  private seedInitialShipments() {
    const seed: ShipmentItem[] = [
            {
        id: 'shp-001',
        orderId: 'ord-001',
        orderCode: 'DH2610-10023',
        customerId: '55555555-0000-0000-0000-000000000001',
        customerName: 'Đại Lý Cửa Hàng Minh Khang',
        salesRepId: 'usr-sale-01',
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseName: 'Kho Miền Bắc (KHO-MB-01)',
        status: 'SHIPPED',
        isConfirmed: true,
        confirmedAt: new Date(Date.now() - 86400000 * 2),
        confirmedBy: 'thukho',
        deliveryAddress: '123 Đường Giải Phóng, Hai Bà Trưng, Hà Nội',
        receiverName: 'Anh Nguyễn Minh Khang',
        phone: '0901234561',
        trackingNumber: 'TRK-2026-90001',
        carrierName: 'Giao Hàng Nhanh',
        lines: [
          new ShipmentLineEntity({
            id: 'shpl-001',
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
        shippedAt: new Date(),
        createdAt: new Date(Date.now() - 86400000 * 2),
        updatedAt: new Date(),
      },
      {
        id: 'shp-002',
        orderId: 'ord-002',
        orderCode: 'DH2610-10045',
        customerId: '55555555-0000-0000-0000-000000000002',
        customerName: 'Đại Lý Thực Phẩm Sạch Hưng Yên',
        salesRepId: 'usr-sale-01',
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseName: 'Kho Miền Bắc (KHO-MB-01)',
        status: 'DELIVERED',
        isConfirmed: true,
        confirmedAt: new Date(Date.now() - 86400000),
        confirmedBy: 'thukho',
        deliveryAddress: '456 Lê Văn Sỹ, P.14, Q.3, TP.HCM',
        receiverName: 'Chị Lê Thanh Hương',
        phone: '0901234562',
        trackingNumber: 'TRK-2026-90002',
        carrierName: 'Viettel Post',
        lines: [
          new ShipmentLineEntity({
            id: 'shpl-002',
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
      },
      {
        id: 'shp-003',
        orderId: 'ord-003',
        orderCode: 'DH2609-09878',
        customerId: 'cust-001',
        customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
        salesRepId: 'usr-sale-01',
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseName: 'Kho Miền Bắc (KHO-MB-01)',
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
      {
        id: 'shp-dh-2026-0001',
        orderId: '77777777-0000-0000-0000-000000000001',
        orderCode: 'DH-2026-0001',
        customerId: '55555555-0000-0000-0000-000000000001',
        customerName: 'Đại Lý Cửa Hàng Minh Khang',
        salesRepId: 'usr-sale-01',
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseName: 'Kho Miền Bắc (KHO-MB-01)',
        status: 'DELIVERED',
        deliveryAddress: '123 Đường Giải Phóng, Hai Bà Trưng, Hà Nội',
        receiverName: 'Anh Nguyễn Minh Khang',
        phone: '0901234561',
        trackingNumber: 'PGH-2026-0001',
        carrierName: 'Đội xe nội bộ Loha',
        items: [
          {
            sku_code: 'LH-COLA-CAN',
            product_name: 'Nước ngọt có gas Loha Cola (Thùng 24 lon)',
            quantity_requested: 100,
            selected_batch_no: 'LO-2026-001',
            is_overridden: false,
          },
        ],
        deliveredAt: new Date(Date.now() - 86400000 * 2),
        createdAt: new Date(Date.now() - 86400000 * 3),
        updatedAt: new Date(Date.now() - 86400000 * 2),
      },
      {
        id: 'shp-dh-2026-0002',
        orderId: 'ord-002',
        orderCode: 'DH2610-10045',
        customerId: '55555555-0000-0000-0000-000000000003',
        customerName: 'Đại Lý Bách Hóa Toàn Cầu',
        salesRepId: 'usr-sale-01',
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseName: 'Kho Miền Bắc (KHO-MB-01)',
        status: 'DELIVERED',
        deliveryAddress: '456 Lê Văn Sỹ, P.14, Q.3, TP.HCM',
        receiverName: 'Chị Lê Thanh Hương',
        phone: '0901234562',
        trackingNumber: 'PGH-2026-0002',
        carrierName: 'Giao Hàng Nhanh',
        items: [
          {
            sku_code: 'LH-MILK-900G',
            product_name: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            quantity_requested: 20,
            selected_batch_no: 'LO-2026-002',
            is_overridden: false,
          },
        ],
        deliveredAt: new Date(Date.now() - 86400000),
        createdAt: new Date(Date.now() - 86400000 * 2),
        updatedAt: new Date(Date.now() - 86400000),
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
    query?: {
      orderId?: string;
      orderCode?: string;
      status?: ShipmentItem['status'] | string;
      search?: string;
      page?: string | number;
      limit?: string | number;
      hasShortDelivery?: string | boolean;
    },
    currentUser?: ICurrentUser,
  ): Promise<any> {
    if (this.databaseService?.isConnected()) {
      await this.loadShipmentsFromDatabase();
    }
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
    const isBackorderQuery =
      query?.hasShortDelivery === 'true' ||
      (query as any)?.hasShortDelivery === true ||
      query?.status === 'BACKORDERS' ||
      query?.status === 'SHORT_DELIVERY';

    if (isBackorderQuery) {
      list = list.filter(
        (s: any) =>
          s.hasShortDelivery === true ||
          (s.lines && s.lines.some((l: any) => l.isShortDelivery || (l.remainingQuantity || 0) > 0)),
      );
    } else if (query?.status && query.status !== 'ALL') {
      list = list.filter((s) => s.status === query.status);
    }

    // Backend Search Filter
    if (query?.search && String(query.search).trim()) {
      const q = String(query.search).toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.id?.toLowerCase().includes(q) ||
          s.orderCode?.toLowerCase().includes(q) ||
          s.customerName?.toLowerCase().includes(q) ||
          s.receiverName?.toLowerCase().includes(q) ||
          s.phone?.includes(q) ||
          s.carrierName?.toLowerCase().includes(q) ||
          s.trackingNumber?.toLowerCase().includes(q) ||
          s.tripCode?.toLowerCase().includes(q) ||
          s.deliveryAddress?.toLowerCase().includes(q),
      );
    }

    // Sắp xếp mới nhất lên đầu
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Nếu có tham số page hoặc limit thì trả về phân trang
    if (query?.page !== undefined || query?.limit !== undefined) {
      const total = list.length;
      const page = Math.max(1, parseInt(String(query.page || 1), 10) || 1);
      const limit = Math.max(1, parseInt(String(query.limit || 10), 10) || 10);
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const startIndex = (page - 1) * limit;
      const data = list.slice(startIndex, startIndex + limit);

      return {
        data,
        total,
        page,
        limit,
        totalPages,
      };
    }

    return list;
  }

  async findById(id: string, currentUser?: ICurrentUser): Promise<ShipmentItem> {
    const existingMemoryShipment = this.shipments.get(id);
    let shipment = existingMemoryShipment;

    // Nếu có DB, tìm trong DB và load kèm danh sách items
    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<any>(
          `SELECT s.*, w.name as warehouse_name
           FROM shipments s
           LEFT JOIN warehouses w ON s.warehouse_id = w.id::text OR s.warehouse_id = w.code
           WHERE s.id = $1;`,
          [id],
        );
        if (rows && rows.length > 0) {
          const r = rows[0];
          const itemRows = await this.databaseService.query<any>(
            `SELECT * FROM shipment_items WHERE shipment_id = $1 ORDER BY created_at ASC;`,
            [id],
          );

          shipment = {
            id: r.id,
            orderId: r.order_id,
            orderCode: r.order_code,
            customerId: r.customer_id,
            customerName: r.customer_name,
            salesRepId: r.sales_rep_id,
            warehouseId: r.warehouse_id,
            warehouseName: r.warehouse_name,
            status: r.status,
            isConfirmed: r.is_confirmed !== undefined ? Boolean(r.is_confirmed) : Boolean(existingMemoryShipment?.isConfirmed),
            confirmedAt: r.confirmed_at ? new Date(r.confirmed_at) : existingMemoryShipment?.confirmedAt,
            confirmedBy: r.confirmed_by || existingMemoryShipment?.confirmedBy,
            deliveryAddress: r.delivery_address,
            receiverName: r.receiver_name,
            phone: r.phone,
            carrierName: r.carrier_name,
            shippingCarrier: r.carrier_name,
            trackingNumber: r.tracking_number,
            proofOfDeliveryUrl: r.proof_of_delivery_url,
            deliveryNote: r.delivery_note,
            failureReason: r.failure_reason,
            tripId: r.trip_id,
            tripCode: r.trip_code,
            invoiceId: r.invoice_id,
            invoiceCode: r.invoice_code,
            lines: existingMemoryShipment?.lines || [],
            hasShortDelivery: r.has_short_delivery !== undefined ? Boolean(r.has_short_delivery) : Boolean(existingMemoryShipment?.hasShortDelivery),
            shippedAt: r.shipped_at ? new Date(r.shipped_at) : undefined,
            deliveredAt: r.delivered_at ? new Date(r.delivered_at) : undefined,
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
            items: (itemRows || []).map((it: any) => ({
              id: it.id,
              sku_code: it.sku_code,
              skuCode: it.sku_code,
              product_name: it.product_name,
              productName: it.product_name,
              quantity_requested: Number(it.quantity_requested) || 0,
              quantityRequested: Number(it.quantity_requested) || 0,
              selected_batch_no: it.selected_batch_no,
              selectedBatchNo: it.selected_batch_no,
              fefo_suggested_batch_no: it.fefo_suggested_batch_no,
              fefoSuggestedBatchNo: it.fefo_suggested_batch_no,
              is_overridden: it.is_overridden,
              isOverridden: it.is_overridden,
              override_reason: it.override_reason,
              overrideReason: it.override_reason,
            })),
          };
          this.shipments.set(id, shipment);
        }
      } catch (err) {
        this.logger.error(`Lỗi tìm shipment ${id} trong DB: ${err}`);
      }
    }

    // Đảm bảo shipment có items nếu đã có lines (tương thích cả SN-188 và SN-195)
    if (shipment) {
      if ((!shipment.items || shipment.items.length === 0) && shipment.lines && shipment.lines.length > 0) {
        shipment.items = shipment.lines.map((l: any) => ({
          id: l.id,
          sku_code: l.productSku,
          skuCode: l.productSku,
          product_name: l.productName,
          productName: l.productName,
          quantity_requested: Number(l.shippedQuantity ?? l.orderedQuantity ?? 1),
          quantityRequested: Number(l.shippedQuantity ?? l.orderedQuantity ?? 1),
          selected_batch_no: 'LÔ-TIÊU-CHUẨN',
          selectedBatchNo: 'LÔ-TIÊU-CHUẨN',
          fefo_suggested_batch_no: 'LÔ-TIÊU-CHUẨN',
          fefoSuggestedBatchNo: 'LÔ-TIÊU-CHUẨN',
          is_overridden: false,
          isOverridden: false,
          override_reason: l.shortDeliveryReason || '',
          overrideReason: l.shortDeliveryReason || '',
        }));
      }
    }

    if (!shipment) {
      throw new NotFoundException(`Không tìm thấy phiếu xuất kho ${id}`);
    }

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER') ||
        roles.includes(UserRole.WAREHOUSE_MANAGER) ||
        roles.includes(UserRole.WAREHOUSE_KEEPER) ||
        roles.includes(UserRole.WAREHOUSE) ||
        roles.includes(UserRole.WH_MANAGER);

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
   * SN-188: Tạo phiếu xuất kho kèm chi tiết lô xuất FEFO và kiểm soát ghi đè thủ công
   * POST /api/inventory/shipments hoặc POST /api/shipments
   */
  async create(dto: any, user?: ICurrentUser): Promise<ShipmentItem> {
    const orderCode = (dto.order_id || dto.orderId || dto.orderCode || '').trim();
    if (!orderCode) {
      throw new BadRequestException('Mã đơn hàng không được để trống');
    }

    // Nghiệp vụ ERP chuẩn: Kiểm tra xem đơn hàng này đã được tạo phiếu xuất kho đang hoạt động chưa
    const targetOrderKey = orderCode.toUpperCase();
    const existingInMem = Array.from(this.shipments.values()).find(
      (s) =>
        (s.orderCode?.toUpperCase() === targetOrderKey ||
          s.orderId?.toUpperCase() === targetOrderKey ||
          (dto.order_id && s.orderId?.toUpperCase() === String(dto.order_id).toUpperCase()) ||
          (dto.orderCode && s.orderCode?.toUpperCase() === String(dto.orderCode).toUpperCase())) &&
        s.status !== 'CANCELLED',
    );
    if (existingInMem) {
      throw new BadRequestException(
        `Đơn hàng "${orderCode}" đã được lập phiếu xuất kho (Mã phiếu: ${existingInMem.id}). Không thể tạo thêm phiếu xuất trùng lặp!`,
      );
    }

    if (this.databaseService?.isConnected()) {
      try {
        const existingInDb = await this.databaseService.query<any>(
          `SELECT id, order_code, status FROM shipments 
           WHERE (UPPER(order_code) = UPPER($1) OR UPPER(order_id) = UPPER($1) OR (UPPER(order_id) = UPPER($2) AND $2 != '')) 
             AND status != 'CANCELLED' 
           LIMIT 1;`,
          [orderCode, dto.order_id || ''],
        );
        if (existingInDb && existingInDb.length > 0) {
          throw new BadRequestException(
            `Đơn hàng "${orderCode}" đã được lập phiếu xuất kho (Mã phiếu: ${existingInDb[0].id}). Không thể tạo thêm phiếu xuất trùng lặp!`,
          );
        }
      } catch (checkErr) {
        if (checkErr instanceof BadRequestException) throw checkErr;
        this.logger.warn(`Lỗi kiểm tra trùng lặp phiếu xuất: ${checkErr}`);
      }
    }
    const customerName = (dto.customer_name || dto.customerName || 'Đại lý').trim();
    const warehouseId = dto.warehouse_id || dto.warehouseId || '11111111-0000-0000-0000-000000000001';
    const receiverName = dto.receiver_name || dto.receiverName;
    const phone = dto.receiver_phone || dto.phone;
    const deliveryAddress = dto.delivery_address || dto.deliveryAddress;
    const carrierName = dto.shipping_carrier || dto.carrierName || 'Đội xe nội bộ LOHA';
    const trackingNumber =
      dto.tracking_number ||
      dto.trackingNumber ||
      `TRK-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    if (phone) {
      const cleanPhone = phone.trim();
      if (!/^0[0-9]{9}$/.test(cleanPhone)) {
        throw new BadRequestException('Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0');
      }
    }

    const items: ShipmentBatchItem[] = (dto.items || []).map((it: any) => ({
      sku_code: it.sku_code || it.skuCode || it.sku,
      product_name: it.product_name || it.productName || it.name,
      quantity_requested: Number(it.quantity_requested || it.quantityRequested || it.quantity) || 1,
      selected_batch_no: it.selected_batch_no || it.selectedBatchNo || it.batch_no || it.batchNumber,
      is_overridden: Boolean(it.is_overridden ?? it.isOverridden),
      override_reason: it.override_reason || it.overrideReason || null,
      fefo_suggested_batch_no: it.fefo_suggested_batch_no || it.fefoSuggestedBatchNo,
    }));

    // Kiểm tra từng item xuất kho
    for (const item of items) {
      if (!item.sku_code) {
        throw new BadRequestException('Mã sản phẩm (sku_code) không được để trống');
      }
      if (!item.selected_batch_no) {
        throw new BadRequestException(`Chưa chọn lô xuất kho cho sản phẩm ${item.sku_code}`);
      }

      if (this.databaseService?.isConnected()) {
        // 1. Lấy thông tin lô hàng được chọn
        const batchRows = await this.databaseService.query<any>(
          `SELECT b.*, p.sku as product_sku, p.name as product_name
           FROM inventory_batches b
           LEFT JOIN products p ON b.product_id = p.id
           WHERE (b.batch_number = $1 OR b.batch_no = $1)
             AND (b.warehouse_id::text = $2::text OR b.warehouse_id IS NULL OR $2 = 'all')
           LIMIT 1;`,
          [item.selected_batch_no, warehouseId],
        );

        if (!batchRows || batchRows.length === 0) {
          throw new BadRequestException(`Không tìm thấy lô hàng "${item.selected_batch_no}" tại kho xuất`);
        }

        const batch = batchRows[0];
        item.product_name = item.product_name || batch.product_name;
        const availableQty = Math.max(0, Number(batch.quantity || 0) - Number(batch.allocated_quantity || 0));

        if (availableQty < item.quantity_requested) {
          throw new BadRequestException(
            `Lô hàng "${item.selected_batch_no}" chỉ còn ${availableQty} tồn khả dụng, không đủ xuất ${item.quantity_requested}`,
          );
        }

        // 2. Tìm lô chuẩn FEFO của SKU này tại kho
        const fefoRows = await this.databaseService.query<any>(
          `SELECT b.* 
           FROM inventory_batches b
           LEFT JOIN products p ON b.product_id = p.id
           WHERE (p.sku = $1 OR b.sku_code = $1)
             AND (b.warehouse_id::text = $2::text OR b.warehouse_id IS NULL OR $2 = 'all')
             AND (b.quantity - COALESCE(b.allocated_quantity, 0)) >= $3
             AND b.status = 'ACTIVE'
             AND b.expiry_date >= CURRENT_DATE
           ORDER BY b.expiry_date ASC, b.created_at ASC
           LIMIT 1;`,
          [item.sku_code, warehouseId, item.quantity_requested],
        );

        let fefoBatchNo = fefoRows?.[0]?.batch_number || fefoRows?.[0]?.batch_no;
        if (!fefoBatchNo && fefoRows?.length === 0) {
          // Fallback tìm lô cận date bất kỳ còn tồn > 0
          const fallbackFefo = await this.databaseService.query<any>(
            `SELECT b.* 
             FROM inventory_batches b
             LEFT JOIN products p ON b.product_id = p.id
             WHERE (p.sku = $1 OR b.sku_code = $1)
               AND (b.warehouse_id::text = $2::text OR b.warehouse_id IS NULL OR $2 = 'all')
               AND (b.quantity - COALESCE(b.allocated_quantity, 0)) > 0
               AND b.status = 'ACTIVE'
               AND b.expiry_date >= CURRENT_DATE
             ORDER BY b.expiry_date ASC, b.created_at ASC
             LIMIT 1;`,
            [item.sku_code, warehouseId],
          );
          fefoBatchNo = fallbackFefo?.[0]?.batch_number || fallbackFefo?.[0]?.batch_no;
        }

        item.fefo_suggested_batch_no = fefoBatchNo || item.selected_batch_no;

        // 3. Kiểm tra ghi đè lô FEFO:
        if (fefoBatchNo && item.selected_batch_no !== fefoBatchNo) {
          item.is_overridden = true;
          if (!item.override_reason || !item.override_reason.trim()) {
            throw new BadRequestException(
              `Sản phẩm "${item.sku_code}" đang xuất lô "${item.selected_batch_no}" khác với lô gợi ý FEFO cận date nhất ("${fefoBatchNo}"). Bắt buộc phải xác nhận ghi đè và nhập lý do ghi đè!`,
            );
          }
        }
      }
    }

    const id = `shp-${Date.now()}`;
    const newShipment: ShipmentItem = {
      id,
      orderId: dto.order_id || dto.orderId || orderCode,
      orderCode,
      customerId: dto.customer_id || dto.customerId || 'cust-001',
      customerName,
      salesRepId: dto.salesRepId || dto.sales_rep_id,
      warehouseId,
      status: dto.status && dto.status !== 'PENDING' ? dto.status : 'PICKING',
      deliveryAddress,
      receiverName,
      phone,
      trackingNumber,
      carrierName,
      shippingCarrier: carrierName,
      items,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Lưu vào database nếu có kết nối
    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `INSERT INTO shipments (
            id, order_id, order_code, customer_id, customer_name, sales_rep_id,
            warehouse_id, status, delivery_address, receiver_name, phone,
            carrier_name, tracking_number, created_by, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
          [
            newShipment.id,
            newShipment.orderId,
            newShipment.orderCode,
            newShipment.customerId,
            newShipment.customerName,
            newShipment.salesRepId || null,
            newShipment.warehouseId || null,
            newShipment.status,
            newShipment.deliveryAddress || null,
            newShipment.receiverName || null,
            newShipment.phone || null,
            newShipment.carrierName || null,
            newShipment.trackingNumber || null,
            user?.userId || user?.username || 'system',
          ],
        );

        // Lưu từng item vào bảng shipment_items và trừ tồn kho lô
        for (const it of items) {
          await this.databaseService.query(
            `INSERT INTO shipment_items (
              shipment_id, sku_code, product_name, quantity_requested,
              selected_batch_no, fefo_suggested_batch_no, is_overridden, override_reason
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
            [
              newShipment.id,
              it.sku_code,
              it.product_name || null,
              it.quantity_requested,
              it.selected_batch_no,
              it.fefo_suggested_batch_no || null,
              it.is_overridden,
              it.override_reason || null,
            ],
          );

          // Trừ tồn kho lô hàng
          await this.databaseService.query(
            `UPDATE inventory_batches 
             SET quantity = GREATEST(0, quantity - $1),
                 quantity_available = GREATEST(0, quantity_available - $1),
                 updated_at = CURRENT_TIMESTAMP
             WHERE (batch_number = $2 OR batch_no = $2)
               AND (warehouse_id::text = $3::text OR warehouse_id IS NULL OR $3 = 'all');`,
            [it.quantity_requested, it.selected_batch_no, warehouseId],
          );

          // Trừ tồn kho tổng trong inventories
          try {
            await this.databaseService.query(
              `UPDATE inventories
               SET on_hand = GREATEST(0, on_hand - $1),
                   updated_at = CURRENT_TIMESTAMP
               WHERE product_id IN (SELECT id FROM products WHERE sku = $2)
                 AND warehouse_id::text = $3::text;`,
              [it.quantity_requested, it.sku_code, warehouseId],
            );
          } catch {
            // inventories update fallback
          }
        }
      } catch (dbErr) {
        this.logger.error(`Lỗi ghi shipment vào database: ${dbErr}`);
      }
    }

    this.shipments.set(id, newShipment);

    // Đồng bộ trạng thái đơn hàng
    if (newShipment.orderCode || newShipment.orderId) {
      await this.syncOrder(newShipment.orderCode || newShipment.orderId, newShipment.status);
    }

    // SN-188: Gửi thông báo đa tầng (Notifications)
    if (this.notificationsService) {
      try {
        const creatorId = user?.userId || (user as any)?.id || '';
        const creatorName = (user as any)?.fullName || user?.username || 'Thủ kho';
        const creatorUsername = user?.username || '';

        const overriddenItems = items.filter((it) => it.is_overridden && it.override_reason);
        if (overriddenItems.length > 0) {
          // Sự kiện 2: Cảnh báo ghi đè lô (FEFO Override)
          for (const ov of overriddenItems) {
            await this.notificationsService.notifyShipmentBatchOverridden({
              shipmentId: newShipment.id,
              orderCode: newShipment.orderCode,
              keeperName: creatorName,
              sku: ov.sku_code,
              suggestedBatch: ov.fefo_suggested_batch_no || 'Lô FEFO',
              actualBatch: ov.selected_batch_no,
              reason: ov.override_reason || 'Không rõ',
              creatorId,
              creatorUsername,
            });
          }
        } else {
          // Sự kiện 1: Phiếu xuất tạo chuẩn FEFO
          const batchNos = items.map((it) => it.selected_batch_no);
          await this.notificationsService.notifyShipmentFefoCreated({
            shipmentId: newShipment.id,
            orderCode: newShipment.orderCode,
            batchNumbers: batchNos,
            warehouseId: newShipment.warehouseId,
            creatorId,
            creatorName,
            creatorUsername,
          });
        }
      } catch (notifErr) {
        this.logger.error(`Lỗi gửi thông báo phiếu xuất kho: ${notifErr}`);
      }
    }

    return newShipment;
  }

  async updateStatus(id: string, status: ShipmentItem['status'], dto?: Partial<ShipmentItem>): Promise<ShipmentItem> {
    const shipment = await this.findById(id);

    // Kiểm tra tính bất biến: Phiếu xuất đã xác nhận KHÔNG THỂ thay đổi trạng thái về PENDING / PICKING (SN-195)
    if (shipment.isConfirmed && (status === 'PENDING' || status === 'PICKING')) {
      throw new BadRequestException('Phiếu xuất kho đã được xác nhận thực xuất và khóa bất biến, không thể hoàn tác.');
    }

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


  /**
   * XÁC NHẬN XUẤT KHO VÀ XỬ LÝ GIAO THIẾU (SN-195)
   * Nghiệp vụ:
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
    const shipmentLines = shipment.lines || [];

    // 2. Validate và tính toán giao thiếu
    for (const line of shipmentLines) {
      const match = linesDtoMap.get(line.orderLineId);
      const actualShipped = match !== undefined ? match.shippedQuantity : line.orderedQuantity;

      if (actualShipped < 0) {
        throw new BadRequestException(`Số lượng xuất của mặt hàng "${line.productName}" không được âm.`);
      }

      if (actualShipped > line.orderedQuantity) {
        throw new BadRequestException(
          `Số lượng thực xuất (${actualShipped}) không được lớn hơn số lượng khách đặt (${line.orderedQuantity}) cho mặt hàng "${line.productName}".`,
        );
      }

      line.shippedQuantity = actualShipped;
      line.remainingQuantity = line.orderedQuantity - actualShipped;

      if (actualShipped < line.orderedQuantity) {
        line.isShortDelivery = true;
        line.shortDeliveryReason = match?.reason?.trim() || 'Tạm hết hàng tại kho (nợ lượt sau giao bù)';
        hasAnyShortDelivery = true;
      } else {
        line.isShortDelivery = false;
        delete line.shortDeliveryReason;
      }

      // 3. Trừ tồn kho thực tế và ghi sổ kho ledger (SN-195)
      await this.processInventoryDeduction(line, shipment.orderCode, shipment.id, currentUser?.userId);
    }

    // 4. Cập nhật đơn hàng liên quan
    await this.syncOrderDeliveryStatus(shipment as any, hasAnyShortDelivery);

    // 5. Khóa phiếu bất biến & cập nhật trạng thái
    shipment.status = 'SHIPPED';
    shipment.isConfirmed = true;
    shipment.hasShortDelivery = hasAnyShortDelivery;
    shipment.confirmedAt = new Date();
    shipment.confirmedBy = currentUser?.username || currentUser?.email || currentUser?.userId || 'Thủ kho';
    shipment.shippedAt = new Date();
    if (dto.carrierName) shipment.carrierName = dto.carrierName;
    if (dto.trackingNumber) shipment.trackingNumber = dto.trackingNumber;
    if (dto.note) shipment.note = dto.note;
    shipment.updatedAt = new Date();

    this.shipments.set(id, shipment);
    return shipment as ShipmentEntity;
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
          const currentStock = product.stockQuantity ?? (product as any).physicalStock ?? 0;
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
          referenceType: 'SALES_ORDER',
          referenceCode: orderCode,
          note: `Xuất kho theo phiếu ${shipmentId} (SN-195)`,
          performedBy: userId || 'thukho',
        });
        this.inventoryService.addTransaction(tx);
      } catch {
        // Fallback an toàn nếu không tìm thấy service
      }
    }
  }

  /**
   * Helper: Cập nhật thông tin giao hàng & giao thiếu trên Đơn hàng (SN-170 & SN-195)
   */
  private async syncOrderDeliveryStatus(shipment: any, hasShortDelivery: boolean): Promise<void> {
    if (!this.ordersService) return;

    try {
      const order = await this.ordersService.findOrderById(shipment.orderId);
      if (!order) return;

      order.isShortDelivery = hasShortDelivery;
      order.status = OrderStatus.SHIPPED;
      order.updatedAt = new Date();

      if (order.lines && shipment.lines) {
        for (const orderLine of order.lines) {
          const matchedShipLine = shipment.lines.find(
            (sl: any) => sl.orderLineId === orderLine.id || sl.productSku === orderLine.productSku,
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
    const list: ShipmentEntity[] = Array.isArray(all) ? all : (all.data || []);
    return list.filter((s: any) => s.hasShortDelivery === true || (s.lines && s.lines.some((l: any) => l.remainingQuantity > 0)));
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

    for (const line of (lastShipment.lines || [])) {
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
    const backorderShipment: any = {
      id,
      orderId: lastShipment.orderId,
      orderCode: lastShipment.orderCode,
      customerId: lastShipment.customerId,
      customerName: lastShipment.customerName,
      salesRepId: lastShipment.salesRepId,
      warehouseId: lastShipment.warehouseId,
      warehouseName: lastShipment.warehouseName,
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
    };

    this.shipments.set(id, backorderShipment);
    return backorderShipment;
  }

  async confirm(id: string): Promise<any> {
    return this.confirmExport(id, {});
  }

  async oldConfirm(id: string): Promise<ShipmentItem> {
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
    if (shipment.lines && shipment.lines.some((l) => (l.remainingQuantity || 0) > 0 || l.isShortDelivery)) {
      shipment.hasShortDelivery = true;
    }
    shipment.updatedAt = new Date();
    this.shipments.set(id, shipment);

    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `UPDATE shipments 
           SET status = 'DELIVERED', 
               receiver_name = $1, 
               delivered_at = $2, 
               proof_of_delivery_url = $3, 
               delivery_note = $4, 
               has_short_delivery = $5,
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = $6;`,
          [
            payload.receiverName.trim(),
            shipment.deliveredAt,
            shipment.proofOfDeliveryUrl || null,
            shipment.deliveryNote || null,
            Boolean(shipment.hasShortDelivery),
            id,
          ],
        );
      } catch (dbErr) {
        this.logger.warn(`Lỗi cập nhật confirmDelivery vào database: ${dbErr}`);
      }
    }

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

    // Ràng buộc bất biến: Phiếu đã xác nhận KHÔNG THỂ XÓA (SN-195)
    if (shipment.isConfirmed) {
      throw new BadRequestException('Phiếu xuất kho đã được xác nhận thực xuất và khóa bất biến, không thể xóa.');
    }

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


