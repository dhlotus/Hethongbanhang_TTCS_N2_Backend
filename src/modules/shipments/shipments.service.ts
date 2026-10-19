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

export interface ShipmentItem {
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
  ) {
    this.seedInitialShipments();
    this.seedInitialTrips();
  }

  async onModuleInit() {
    await this.ensureShipmentTables();
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
          proof_of_delivery_url TEXT,
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

        -- Đảm bảo cột invoice_id và invoice_code tồn tại nếu bảng đã được tạo trước đó
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS invoice_id VARCHAR(100);
        ALTER TABLE shipments ADD COLUMN IF NOT EXISTS invoice_code VARCHAR(100);

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
        id: 'shp-10088',
        orderId: 'ord-003',
        orderCode: 'DH2610-10088',
        customerId: 'cust-dl-0003',
        customerName: 'Công Ty Cổ Phần Thương Mại Quốc Tế An Phát',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-002',
        status: 'SHIPPED',
        deliveryAddress: 'Kho Phân Phối KCN Biên Hòa 2, Đồng Nai',
        receiverName: 'Anh Vũ Hoàng Nam',
        phone: '0901234563',
        trackingNumber: 'TRK-2026-10088',
        carrierName: 'LOHA Fleet Logistics',
        tripCode: 'TRIP-2610-10088',
        shippedAt: new Date(Date.now() - 3600000 * 2),
        createdAt: new Date(Date.now() - 3600000 * 24),
        updatedAt: new Date(),
      },
      {
        id: 'shp-10178',
        orderId: 'ord-009',
        orderCode: 'DH2610-10178',
        customerId: 'cust-dl-0004',
        customerName: 'Siêu Thị Mini & Bách Hóa Tiện Lợi Daily Mart',
        salesRepId: 'usr-sale-02',
        warehouseId: 'wh-001',
        status: 'SHIPPED',
        deliveryAddress: '15 Tố Hữu, Vạn Phúc, Hà Đông, Hà Nội',
        receiverName: 'Chị Mai',
        phone: '0912345678',
        trackingNumber: 'TRK-2026-10178',
        carrierName: 'LOHA Fleet Logistics',
        tripCode: 'TRIP-2610-10178',
        shippedAt: new Date(Date.now() - 3600000),
        createdAt: new Date(Date.now() - 3600000 * 12),
        updatedAt: new Date(),
      },
      {
        id: 'shp-10234',
        orderId: 'ord-012',
        orderCode: 'DH2610-10234',
        customerId: 'cust-dl-0003',
        customerName: 'Công Ty Cổ Phần Thương Mại Quốc Tế An Phát',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-001',
        status: 'SHIPPED',
        deliveryAddress: 'Kho Hà Nội Thanh Xuân, 280 Nguyễn Trãi, Thanh Xuân, Hà Nội',
        receiverName: 'Anh Nam',
        phone: '0901234563',
        trackingNumber: 'TRK-2026-10234',
        carrierName: 'LOHA Fleet Logistics',
        tripCode: 'TRIP-2610-10234',
        shippedAt: new Date(Date.now() - 3600000 * 3),
        createdAt: new Date(Date.now() - 3600000 * 20),
        updatedAt: new Date(),
      },
      {
        id: 'shp-10404',
        orderId: 'ord-024',
        orderCode: 'DH2610-10404',
        customerId: 'cust-dl-0001',
        customerName: 'Công Ty TNHH Thương Mại & Phân Phối Minh Khang',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-002',
        status: 'SHIPPED',
        deliveryAddress: 'Kho Tổng Phú Nhuận, 123 Nguyễn Trọng Tuyển, P.8, Q.Phú Nhuận, TP.HCM',
        receiverName: 'Anh Nguyễn Minh Khang',
        phone: '0901234561',
        trackingNumber: 'TRK-2026-10404',
        carrierName: 'LOHA Fleet Logistics',
        tripCode: 'TRIP-2610-10404',
        shippedAt: new Date(Date.now() - 3600000 * 4),
        createdAt: new Date(Date.now() - 3600000 * 30),
        updatedAt: new Date(),
      },
      {
        id: 'shp-10212',
        orderId: 'ord-011',
        orderCode: 'DH2610-10212',
        customerId: 'cust-dl-0005',
        customerName: 'Đại Lý Thực Phẩm Sạch Thăng Long',
        salesRepId: 'usr-sale-02',
        warehouseId: 'wh-001',
        status: 'PACKED',
        deliveryAddress: '36 Cầu Giấy, P.Quan Hoa, Q.Cầu Giấy, Hà Nội',
        receiverName: 'Anh Tuấn',
        phone: '0901234565',
        trackingNumber: 'TRK-2026-10212',
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
    let shipment = this.shipments.get(id);

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
      tripCode: 'TRIP-2610-10088',
      name: 'Tuyến giao đơn DH2610-10088 - Công Ty Cổ Phần Thương Mại Quốc Tế An Phát',
      routeArea: 'Bình Dương - Đồng Nai',
      warehouseId: 'wh-002',
      warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
      driverName: 'Nguyễn Văn Thắng',
      driverPhone: '0988123456',
      vehicleNumber: '29H-868.99',
      vehicleType: 'Xe tải 2.5T Thaco',
      departureDate: new Date(Date.now() - 3600000 * 2),
      estimatedCompletionTime: new Date(Date.now() + 3600000 * 2),
      status: DeliveryTripStatus.IN_TRANSIT,
      stops: [
        {
          id: 'stop-001',
          tripId: 'trip-001',
          shipmentId: 'shp-10088',
          orderCode: 'DH2610-10088',
          stopOrder: 1,
          customerName: 'Công Ty Cổ Phần Thương Mại Quốc Tế An Phát',
          receiverName: 'Anh Vũ Hoàng Nam',
          receiverPhone: '0901234563',
          deliveryAddress: 'Kho Phân Phối KCN Biên Hòa 2, Đồng Nai',
          packageCount: 15,
          codAmount: 48640000,
          status: 'PENDING',
        },
      ],
      totalStops: 1,
      deliveredStops: 0,
      totalCodAmount: 48640000,
      note: 'Ưu tiên giao trước 15h',
      createdAt: new Date(Date.now() - 3600000 * 2),
      updatedAt: new Date(),
    };

    const trip2: DeliveryTripEntity = {
      id: 'trip-002',
      tripCode: 'TRIP-2610-10178',
      name: 'Tuyến giao đơn DH2610-10178 - Siêu Thị Mini & Bách Hóa Tiện Lợi Daily Mart',
      routeArea: 'Hà Nội - Vạn Phúc',
      warehouseId: 'wh-001',
      warehouseName: 'Kho Miền Bắc (Hà Nội)',
      driverName: 'Trần Quốc Tuấn',
      driverPhone: '0912348899',
      vehicleNumber: '29D-789.12',
      vehicleType: 'Xe van 1.25T Hyundai',
      departureDate: new Date(Date.now() - 3600000),
      estimatedCompletionTime: new Date(Date.now() + 3600000 * 3),
      status: DeliveryTripStatus.IN_TRANSIT,
      stops: [
        {
          id: 'stop-002',
          tripId: 'trip-002',
          shipmentId: 'shp-10178',
          orderCode: 'DH2610-10178',
          stopOrder: 1,
          customerName: 'Siêu Thị Mini & Bách Hóa Tiện Lợi Daily Mart',
          receiverName: 'Chị Mai',
          receiverPhone: '0912345678',
          deliveryAddress: '15 Tố Hữu, Vạn Phúc, Hà Đông, Hà Nội',
          packageCount: 12,
          codAmount: 12190000,
          status: 'PENDING',
        },
      ],
      totalStops: 1,
      deliveredStops: 0,
      totalCodAmount: 12190000,
      note: 'Đường phố cổ cấm tải giờ cao điểm, xe van vào sau 14h',
      createdAt: new Date(Date.now() - 3600000),
      updatedAt: new Date(),
    };

    this.trips.set(trip1.id, trip1);
    this.trips.set(trip2.id, trip2);

    const s1 = this.shipments.get('shp-10088');
    if (s1) {
      s1.tripId = trip1.id;
      s1.tripCode = trip1.tripCode;
    }
    const s2 = this.shipments.get('shp-10178');
    if (s2) {
      s2.tripId = trip2.id;
      s2.tripCode = trip2.tripCode;
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
   * Thống kê tiền hàng đang nằm trên đường & cảnh báo (SN-194 / SN-197)
   */
  async getGoodsInTransitStats(warehouseId?: string) {
    const trips = await this.findAllTrips();
    let totalGoodsValueInTransit = 0;
    let activeTripsCount = 0;
    let overdueTripsCount = 0;
    let totalRemainingStops = 0;
    let totalRetainedUndeliveredValue = 0;
    let completedTripsToday = 0;

    const now = Date.now();
    const todayStr = new Date().toISOString().slice(0, 10);

    for (const trip of trips) {
      if (warehouseId && warehouseId !== 'ALL' && trip.warehouseId !== warehouseId) {
        continue;
      }

      if (trip.status === DeliveryTripStatus.IN_TRANSIT) {
        activeTripsCount++;
        const depTime = trip.departureDate ? new Date(trip.departureDate).getTime() : trip.createdAt.getTime();
        const estTime = depTime + 4 * 3600 * 1000;
        if (now > estTime) {
          overdueTripsCount++;
        }
      } else if (trip.status === DeliveryTripStatus.COMPLETED) {
        completedTripsToday++;
      }

      for (const stop of trip.stops) {
        const amount = stop.codAmount || 0;
        if (stop.status === 'PENDING') {
          totalRemainingStops++;
          if (trip.status === DeliveryTripStatus.IN_TRANSIT) {
            totalGoodsValueInTransit += amount;
          }
        } else if (stop.status === 'FAILED') {
          totalRetainedUndeliveredValue += amount;
        }
      }
    }

    return {
      totalGoodsValueInTransit,
      activeTripsCount,
      overdueTripsCount,
      totalRemainingStops,
      totalRetainedUndeliveredValue,
      completedTripsToday,
    };
  }

  /**
   * Cập nhật trạng thái điểm dừng
   */
  async updateStopStatus(
    tripId: string,
    stopId: string,
    payload: { status: 'DELIVERED' | 'FAILED'; failureReason?: string },
  ): Promise<DeliveryTripEntity> {
    const trip = await this.findTripById(tripId);
    const stop = trip.stops.find((s) => s.id === stopId);
    if (!stop) {
      throw new NotFoundException(`Không tìm thấy điểm giao ${stopId}`);
    }

    stop.status = payload.status;
    if (payload.status === 'DELIVERED') {
      stop.deliveredAt = new Date();
      if (stop.shipmentId) {
        await this.confirmDelivery(stop.shipmentId, {
          receiverName: stop.receiverName || stop.customerName,
          deliveredAt: new Date().toISOString(),
        });
      }
      if (stop.orderCode) {
        await this.syncOrder(stop.orderCode, 'DELIVERED');
      }
    } else if (payload.status === 'FAILED') {
      stop.note = payload.failureReason ? `Giao thất bại: ${payload.failureReason}` : 'Giao không thành công';
    }

    this.trips.set(trip.id, trip);
    return trip;
  }

  /**
   * Xác nhận đối soát xe về kho
   */
  async checkinTripReturn(id: string, payload: any): Promise<DeliveryTripEntity> {
    const trip = await this.findTripById(id);
    trip.status = DeliveryTripStatus.COMPLETED;
    trip.completedAt = new Date();
    trip.updatedAt = new Date();
    this.trips.set(trip.id, trip);
    return trip;
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


