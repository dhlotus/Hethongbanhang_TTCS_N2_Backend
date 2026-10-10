import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DiscountPoliciesService } from '../discount-policies/discount-policies.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import { PriceListItemEntity } from '../price-lists/entities/price-list-item.entity';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { ProductStatus } from '../../common/enums/product-status.enum';
import {
  CreateOrderDto,
  CreateOrderLineDto,
  DeliveryPointInputDto,
  ReorderDto,
  UpdateOrderStatusDto,
} from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

import { OrderLineEntity } from './entities/order-line.entity';
import { OrderEntity, IOrderDeliveryPoint } from './entities/order.entity';
import { OrderStatus, PaymentStatus } from './entities/order-status.enum';

interface PricedOrderLineDto extends CreateOrderLineDto {
  minPrice?: number;
  requiresApproval?: boolean;
}

interface ResolvedOrderPricing {
  lines: PricedOrderLineDto[];
  priceListId?: string;
}

interface OrderLineCalculation {
  line: OrderLineEntity;
  subtotal: number;
  approvalReason?: string;
}

/**
 * Service Quản lý Đặt hàng B2B (SN-38 & SN-39)
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly orders = new Map<string, OrderEntity>();

  constructor(
    private readonly customersService: CustomersService,
    @Optional() private readonly priceListsService?: PriceListsService,
    @Optional() private readonly discountPoliciesService?: DiscountPoliciesService,
    @Optional()
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService?: ProductsService,
  ) {
    this.seedInitialOrders();
  }

  async onModuleInit(): Promise<void> {
<<<<<<< HEAD
    if (this.databaseService && !this.databaseService.isConnected()) {
      (this as any).databaseService = undefined;
      for (const order of this.seedInitialOrders()) this.orders.set(order.id, order);
    }
    if (!this.databaseService) return;

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_records (
        id TEXT PRIMARY KEY,
        order_code TEXT NOT NULL UNIQUE,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.databaseService.query(
      'CREATE INDEX IF NOT EXISTS idx_app_order_records_created_at ON app_order_records(created_at DESC)',
    );

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_storage_state (
        state_key TEXT PRIMARY KEY,
        seeded BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await this.ensureApprovalTables();
    const client = await this.databaseService.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app_order_storage_state (state_key, seeded)
         VALUES ('orders', FALSE) ON CONFLICT (state_key) DO NOTHING`,
      );
      const stateResult = await client.query(
        `SELECT seeded FROM app_order_storage_state WHERE state_key = 'orders' FOR UPDATE`,
      );
      if (!stateResult.rows[0]?.seeded) {
        const countResult = await client.query(
          'SELECT COUNT(*)::int AS count FROM app_order_records',
        );
        if (Number(countResult.rows[0]?.count ?? 0) === 0) {
          for (const order of this.seedInitialOrders()) {
            await client.query(
              `INSERT INTO app_order_records (id, order_code, payload, created_at, updated_at)
               VALUES ($1, $2, $3::jsonb, $4, $5)
               ON CONFLICT (id) DO NOTHING`,
              [order.id, order.orderCode, JSON.stringify(order), order.createdAt, order.updatedAt],
            );
          }
        }
        await client.query(
          `UPDATE app_order_storage_state SET seeded = TRUE WHERE state_key = 'orders'`,
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureApprovalTables(): Promise<void> {
    if (!this.databaseService) return;
    await this.ensureApprovalHistoryTable();
    await this.ensureInventoryReservationTable();
    await this.ensureApprovalHistoryImmutability();
  }

  private async ensureApprovalHistoryTable(): Promise<void> {
    if (!this.databaseService) return;
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_approval_history (
        id BIGSERIAL PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES app_order_records(id) ON DELETE RESTRICT,
        action VARCHAR(30) NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'RETURN_FOR_UPDATE')),
        comment TEXT,
        approver_id TEXT NOT NULL,
        approver_name TEXT NOT NULL,
        approver_roles TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.databaseService.query(`
      CREATE INDEX IF NOT EXISTS idx_app_order_approval_history_order
      ON app_order_approval_history(order_id, created_at DESC, id DESC)
    `);
  }

  private async ensureInventoryReservationTable(): Promise<void> {
    if (!this.databaseService) return;
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_inventory_reservations (
        id BIGSERIAL PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES app_order_records(id) ON DELETE RESTRICT,
        order_line_id TEXT NOT NULL,
        product_sku TEXT NOT NULL,
        base_quantity NUMERIC(15, 2) NOT NULL CHECK (base_quantity > 0),
        status VARCHAR(20) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'RELEASED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        released_at TIMESTAMPTZ
      )
    `);
    await this.databaseService.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_app_order_active_line_reservation
      ON app_order_inventory_reservations(order_id, order_line_id)
      WHERE status = 'RESERVED'
    `);
    await this.databaseService.query(`
      CREATE INDEX IF NOT EXISTS idx_app_order_active_sku_reservations
      ON app_order_inventory_reservations(product_sku)
      WHERE status = 'RESERVED'
    `);
  }

  private async ensureApprovalHistoryImmutability(): Promise<void> {
    if (!this.databaseService) return;
    await this.databaseService.query(`
      CREATE OR REPLACE FUNCTION app_reject_order_approval_history_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Order approval history is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await this.databaseService.query(`
      DROP TRIGGER IF EXISTS trg_app_order_approval_history_immutable
      ON app_order_approval_history
    `);
    await this.databaseService.query(`
      CREATE TRIGGER trg_app_order_approval_history_immutable
      BEFORE UPDATE OR DELETE ON app_order_approval_history
      FOR EACH ROW EXECUTE FUNCTION app_reject_order_approval_history_mutation()
    `);
  }

  private restoreOrder(payload: unknown): OrderEntity {
    const parsed = (typeof payload === 'string' ? JSON.parse(payload) : payload) as
      | (Partial<OrderEntity> & { createdAt?: string | Date; updatedAt?: string | Date })
      | null;
    if (!parsed) throw new Error('Bản ghi đơn hàng trong PostgreSQL không hợp lệ.');
    return new OrderEntity({
      ...parsed,
      createdAt: parsed.createdAt ? new Date(parsed.createdAt) : new Date(),
      updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : new Date(),
    });
  }

  private async saveOrder(order: OrderEntity): Promise<void> {
    if (!this.databaseService) {
      this.orders.set(order.id, order);
      return;
    }
    await this.databaseService.query(
      `INSERT INTO app_order_records (id, order_code, payload, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         order_code = EXCLUDED.order_code,
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at`,
      [order.id, order.orderCode, JSON.stringify(order), order.createdAt, order.updatedAt],
    );
  }

  /**
   * Tính toán lượng tồn giữ chỗ (reservedStock) của tất cả SKU (SN-39):
   * reservedStock = Tổng số lượng của SKU đó trong các đơn hàng đang ở trạng thái
   * Chỉ các đơn đã được duyệt và đang chờ xuất kho mới giữ chỗ tồn (APPROVED, PROCESSING).
   */
  getReservedStockMap(excludeOrderId?: string): Map<string, number> {
    const map = new Map<string, number>();
    const reservedStatuses = new Set<OrderStatus>([
      OrderStatus.APPROVED,
      OrderStatus.PROCESSING,
    ]);

    for (const order of this.orders.values()) {
      if (excludeOrderId && order.id === excludeOrderId) continue;
      if (!reservedStatuses.has(order.status)) continue;
      if (!order.lines) continue;

      for (const line of order.lines) {
        const baseQty =
          line.baseQuantity ||
          Math.round((line.quantity || 0) * (line.conversionRate || 1));
        if (line.productId) {
          map.set(line.productId, (map.get(line.productId) || 0) + baseQty);
        }
        if (line.productSku) {
          const upperSku = line.productSku.toUpperCase();
          map.set(upperSku, (map.get(upperSku) || 0) + baseQty);
        }
      }
    }
    return map;
  }

  /**
   * Lấy lượng tồn giữ chỗ của một SKU hoặc Product ID cụ thể (SN-39)
   */
  getReservedStock(productIdOrSku: string, excludeOrderId?: string): number {
    if (!productIdOrSku) return 0;
    const map = this.getReservedStockMap(excludeOrderId);
    return (
      map.get(productIdOrSku) ||
      map.get(productIdOrSku.toUpperCase()) ||
      0
    );
  }

  /**
   * Validation Guard kiểm tra số lượng đặt với tồn khả dụng (SN-39):
   * availableStock = physicalStock - reservedStock
   * Nếu orderQuantity > availableStock: Chặn không cho lưu vào DB, trả về lỗi HTTP 400 Bad Request:
   * "Sản phẩm [Tên SKU] vượt quá tồn khả dụng (Còn tối đa [availableStock] [Đơn vị])"
   */
  validateOrderLinesAvailableStock(
    lines: CreateOrderLineDto[],
    excludeOrderId?: string,
  ): void {
    if (!this.productsService || !lines || lines.length === 0) return;

    for (const line of lines) {
      const product = this.productsService.findProductInternal(
        line.productId || line.productSku,
      );
      if (!product) continue;

      const physicalStock = product.stockQuantity ?? 0;
      const reservedStock = this.getReservedStock(
        product.id || product.sku,
        excludeOrderId,
      );
      const availableStock = Math.max(0, physicalStock - reservedStock);

      const conversionRate = line.conversionRate > 0 ? line.conversionRate : 1;
      const orderBaseQuantity = Math.round(line.quantity * conversionRate);

      if (orderBaseQuantity > availableStock) {
        const maxAllowedInUnit =
          conversionRate > 1
            ? Math.floor(availableStock / conversionRate)
            : availableStock;
        const unitName = line.unit || product.baseUnit;
        const skuName = product.name || line.productName || line.productSku;
        throw new BadRequestException(
          `Sản phẩm ${skuName} vượt quá tồn khả dụng (Còn tối đa ${maxAllowedInUnit} ${unitName})`,
        );
      }
=======
    if (this.orders.size === 0) {
      this.seedInitialOrders();
>>>>>>> b64bda3f5dddcea43fad18d950037e35bb747ed0
    }
  }

  /**
   * Tạo mã đơn hàng duy nhất tự động: DH-YYMM-XXXXX
   */
  private generateOrderCode(): string {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const randomSeq = Math.floor(10000 + Math.random() * 90000);
    return `DH${yy}${mm}-${randomSeq}`;
  }

  /**
   * Tính toán toàn bộ tổng tiền hàng, chiết khấu và tổng phải thu (SN-38)
   */
  private calculateOrderTotals(linesDto: PricedOrderLineDto[]): {
    lines: OrderLineEntity[];
    subtotal: number;
    totalDiscount: number;
    grandTotal: number;
    requiresApproval: boolean;
    approvalReasons: string[];
  } {
    const calculations = linesDto.map((item, index) =>
      this.calculateOrderLine(item, index),
    );
    const lines = calculations.map(({ line }) => line);
    const subtotal = calculations.reduce((sum, item) => sum + item.subtotal, 0);
    const grandTotal = lines.reduce((sum, item) => sum + item.lineTotal, 0);
    const totalDiscount = subtotal - grandTotal;
    const approvalReasons = calculations
      .map((item) => item.approvalReason)
      .filter((reason): reason is string => Boolean(reason));

    return {
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      requiresApproval: approvalReasons.length > 0,
      approvalReasons,
    };
  }

  private calculateOrderLine(
    item: PricedOrderLineDto,
    index: number,
  ): OrderLineCalculation {
    const conversionRate = item.conversionRate > 0 ? item.conversionRate : 1;
    const baseQuantity = Math.round(item.quantity * conversionRate);
    const listPrice = item.listPrice !== undefined ? item.listPrice : item.unitPrice || 0;
    const unitPrice = item.unitPrice !== undefined ? item.unitPrice : listPrice;
    const lineTotal = Math.round(item.quantity * unitPrice);
    const listTotal = Math.round(item.quantity * listPrice);

    return {
      line: new OrderLineEntity({
        id: `line-${Date.now()}-${index + 1}`,
        productId: item.productId,
        productSku: item.productSku,
        productName: item.productName,
        unit: item.unit,
        baseUnit: item.baseUnit,
        conversionRate,
        quantity: item.quantity,
        baseQuantity,
        unitPrice,
        listPrice,
        discountPercent: item.discountPercent || 0,
        lineTotal,
        stockAvailable: item.stockAvailable,
        minPrice: item.minPrice,
        requiresApproval: item.requiresApproval,
      }),
      subtotal: listTotal,
      approvalReason: item.requiresApproval
        ? `Giá bán SKU ${item.productSku} thấp hơn giá sàn ${item.minPrice?.toLocaleString('vi-VN')} đ`
        : undefined,
    };
  }

  /**
   * Áp giá theo nhóm đại lý và tính lại chiết khấu mỗi khi thay đổi số lượng.
   */
  private resolveOrderPricing(
    lines: CreateOrderLineDto[],
    customerGroup: string,
    requestedPriceListId?: string,
  ): ResolvedOrderPricing {
    if (!this.priceListsService) return { lines };

    let selectedPriceListId: string | undefined;
    const pricedLines = lines.map((line) => {
      const resolved = this.resolveOrderLinePricing(
        line,
        customerGroup,
        requestedPriceListId,
      );
      if (selectedPriceListId && selectedPriceListId !== resolved.priceListId) {
        throw new BadRequestException(
          'Các SKU trong đơn không thuộc cùng một bảng giá đang hiệu lực',
        );
      }
      selectedPriceListId = resolved.priceListId;
      return resolved.line;
    });

    return { lines: pricedLines, priceListId: selectedPriceListId };
  }

  /**
   * Áp giá hiệu lực, chiết khấu theo sản lượng và kiểm tra giá sàn cho một dòng hàng.
   */
  private resolveOrderLinePricing(
    line: CreateOrderLineDto,
    customerGroup: string,
    requestedPriceListId?: string,
  ): { line: PricedOrderLineDto; priceListId: string } {
    const { item, priceListId } = this.findEffectivePriceItem(
      line,
      customerGroup,
      requestedPriceListId,
    );
    const conversionRate = line.conversionRate > 0 ? line.conversionRate : 1;
    if (item.baseUnit && item.baseUnit.toLowerCase() !== line.baseUnit.toLowerCase()) {
      throw new BadRequestException(
        `Đơn vị cơ sở của SKU ${line.productSku} không khớp với bảng giá`,
      );
    }

    const calculatedPrice = this.calculateLinePrices(line, item, conversionRate);

    return {
      priceListId,
      line: {
        ...line,
        ...calculatedPrice,
      },
    };
  }

  private findEffectivePriceItem(
    line: CreateOrderLineDto,
    customerGroup: string,
    requestedPriceListId?: string,
  ): { item: PriceListItemEntity; priceListId: string } {
    const { priceList, item } = this.priceListsService!.findEffectivePrice(
      customerGroup,
      line.productId,
      line.productSku,
    );
    if (requestedPriceListId && requestedPriceListId !== priceList.id) {
      throw new BadRequestException(
        'Bảng giá được chọn không phải bảng giá đang hiệu lực của đại lý',
      );
    }
    return { item, priceListId: priceList.id };
  }

  private calculateLinePrices(
    line: CreateOrderLineDto,
    item: PriceListItemEntity,
    conversionRate: number,
  ): Pick<PricedOrderLineDto, 'listPrice' | 'unitPrice' | 'discountPercent' | 'minPrice' | 'requiresApproval'> {
    const listPrice = Math.round(item.price * conversionRate);
    const baseQuantity = Math.round(line.quantity * conversionRate);
    const tierDiscount =
      this.discountPoliciesService?.calculateBestDiscount(
        line.productId,
        '',
        baseQuantity,
        line.productSku,
      ) || 0;
    const automaticUnitPrice = Math.round(
      (listPrice * (100 - tierDiscount)) / 100,
    );
    if (line.isPriceManuallyEdited && line.unitPrice === undefined) {
      throw new BadRequestException(
        `Vui lòng nhập giá bán thủ công cho SKU ${line.productSku}`,
      );
    }

    const unitPrice = line.isPriceManuallyEdited
      ? line.unitPrice!
      : automaticUnitPrice;
    const minPrice = Math.round(item.minPrice * conversionRate);
    const discountPercent =
      listPrice > 0
        ? Number((((listPrice - unitPrice) / listPrice) * 100).toFixed(2))
        : 0;

    return { listPrice, unitPrice, discountPercent, minPrice, requiresApproval: unitPrice < minPrice };
  }

  /**
   * Khởi tạo dữ liệu mẫu thực tế cho đơn hàng
   */
  private seedInitialOrders(): void {
    const initialOrders: OrderEntity[] = [
      new OrderEntity({
        id: 'ord-001',
        orderCode: 'DH2610-10023',
        customerId: 'cust-001',
        customerCode: 'DL-HCM-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        customerGroup: 'AGENT_LEVEL_1',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        deliveryPoint: {
          id: 'dp-001-1',
          name: 'Kho Tổng Phú Nhuận',
          address: '123 Nguyễn Trọng Tuyển, Phường 8, Quận Phú Nhuận, TP.HCM',
          receiverName: 'Anh Nguyễn Minh Khang',
          phone: '0901234567',
          roadNote: 'Đường 2 chiều, xe tải 2.5T vào thoải mái, giao giờ hành chính 8h00 - 17h00',
        },
        deliveryDate: '2026-10-12',
        lines: [
          new OrderLineEntity({
            id: 'line-001-1',
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
            unit: 'Thùng (12 lon)',
            baseUnit: 'Lon',
            conversionRate: 12,
            quantity: 5,
            baseQuantity: 60,
            listPrice: 5400000,
            unitPrice: 5130000,
            discountPercent: 5,
            lineTotal: 25650000,
          }),
          new OrderLineEntity({
            id: 'line-001-2',
            productId: 'prod-002',
            productSku: 'LH-NUT-180ML',
            productName: 'Sữa Hạt Óc Chó Yến Mạch LOHA 180ml',
            unit: 'Thùng (48 hộp)',
            baseUnit: 'Hộp',
            conversionRate: 48,
            quantity: 10,
            baseQuantity: 480,
            listPrice: 620000,
            unitPrice: 589000,
            discountPercent: 5,
            lineTotal: 5890000,
          }),
        ],
        subtotal: 33200000,
        totalDiscount: 1660000,
        grandTotal: 31540000,
        note: 'Giao buổi sáng, gọi trước 30 phút để chuẩn bị thủ kho bốc dỡ',
        status: OrderStatus.APPROVED,
        paymentStatus: PaymentStatus.UNPAID,
        createdAt: new Date('2026-10-06T08:30:00Z'),
        updatedAt: new Date('2026-10-06T09:15:00Z'),
      }),
      new OrderEntity({
        id: 'ord-002',
        orderCode: 'DH2610-10045',
        customerId: 'cust-002',
        customerCode: 'DL-HCM-002',
        customerName: 'Đại Lý Bách Hóa Thực Phẩm Bảo Châu',
        customerGroup: 'AGENT_LEVEL_2',
        salesRepId: 'usr-sale-02',
        salesRepName: 'Nguyễn Thị Hằng',
        deliveryPoint: {
          id: 'dp-002-1',
          name: 'Kho Phân Phối Thủ Đức',
          address: '456 Lê Văn Việt, Phường Tăng Nhơn Phú A, TP. Thủ Đức, TP.HCM',
          receiverName: 'Chị Trần Bảo Châu',
          phone: '0912345678',
          roadNote: 'Hẻm xe tải 8m, vào cổng sắt màu xanh, gọi điện trước khi đến 15 phút',
        },
        deliveryDate: '2026-10-15',
        lines: [
          new OrderLineEntity({
            id: 'line-002-1',
            productId: 'prod-003',
            productSku: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Nhân Sâm Thượng Hạng LOHA 70ml',
            unit: 'Hộp (6 hũ)',
            baseUnit: 'Hũ',
            conversionRate: 6,
            quantity: 20,
            baseQuantity: 120,
            listPrice: 420000,
            unitPrice: 420000,
            discountPercent: 0,
            lineTotal: 8400000,
          }),
        ],
        subtotal: 8400000,
        totalDiscount: 0,
        grandTotal: 8400000,
        note: 'Hàng dễ vỡ, bốc dỡ cẩn thận',
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.UNPAID,
        createdAt: new Date('2026-10-07T10:00:00Z'),
        updatedAt: new Date('2026-10-07T10:00:00Z'),
      }),
      new OrderEntity({
        id: 'ord-003',
        orderCode: 'DH2610-10088',
        customerId: 'cust-003',
        customerCode: 'DL-HCM-003',
        customerName: 'Siêu Thị Mini Phương Nam Mart',
        customerGroup: 'RETAIL',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        deliveryPoint: {
          id: 'dp-003-1',
          name: 'Điểm Bán Tân Bình (Mặt Tiền)',
          address: '789 Hoàng Văn Thụ, Phường 4, Quận Tân Bình, TP.HCM',
          receiverName: 'Chị Đỗ Thu Phương',
          phone: '0923456789',
          roadNote: 'Giao vào bãi đỗ xe phía sau siêu thị mini, có thang máy vận chuyển hàng',
        },
        deliveryDate: '2026-10-14',
        lines: [
          new OrderLineEntity({
            id: 'line-003-1',
            productId: 'prod-004',
            productSku: 'LH-CEREAL-500G',
            productName: 'Ngũ Cốc Dinh Dưỡng Hạt Granola LOHA 500g',
            unit: 'Gói',
            baseUnit: 'Gói',
            conversionRate: 1,
            quantity: 30,
            baseQuantity: 30,
            listPrice: 145000,
            unitPrice: 145000,
            discountPercent: 0,
            lineTotal: 4350000,
          }),
        ],
        subtotal: 4350000,
        totalDiscount: 0,
        grandTotal: 4350000,
        note: 'Đơn nháp lưu lại kiểm tra thêm tồn kho',
        status: OrderStatus.DRAFT,
        paymentStatus: PaymentStatus.UNPAID,
        createdAt: new Date('2026-10-07T14:20:00Z'),
        updatedAt: new Date('2026-10-07T14:20:00Z'),
      }),
      new OrderEntity({
        id: 'ord-004',
        orderCode: 'DH2610-10015',
        customerId: 'cust-001',
        customerCode: 'DL-HCM-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        customerGroup: 'AGENT_LEVEL_1',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        deliveryPoint: {
          id: 'dp-001-1',
          name: 'Kho Tổng Phú Nhuận',
          address: '123 Nguyễn Trọng Tuyển, Phường 8, Quận Phú Nhuận, TP.HCM',
          receiverName: 'Anh Nguyễn Minh Khang',
          phone: '0901234567',
          roadNote: 'Đường 2 chiều, xe tải 2.5T vào thoải mái',
        },
        deliveryDate: '2026-10-08',
        lines: [
          new OrderLineEntity({
            id: 'line-004-1',
            productId: 'prod-003',
            productSku: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Nhân Sâm Thượng Hạng LOHA 70ml',
            unit: 'Hộp (6 hũ)',
            baseUnit: 'Hũ',
            conversionRate: 6,
            quantity: 10,
            baseQuantity: 60,
            listPrice: 420000,
            unitPrice: 399000,
            discountPercent: 5,
            lineTotal: 3990000,
            deliveredQuantity: 8, // Giao thiếu 2 hộp (SN-170)
            deliveredBaseQuantity: 48,
            isShortDelivery: true,
            shortDeliveryReason:
              'Kho tổng tạm thiếu 2 hộp lô sản xuất mới nhất, đã xác nhận với đại lý sẽ giao bù vào đợt giao kế tiếp',
          }),
          new OrderLineEntity({
            id: 'line-004-2',
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
            unit: 'Thùng (12 lon)',
            baseUnit: 'Lon',
            conversionRate: 12,
            quantity: 5,
            baseQuantity: 60,
            listPrice: 5400000,
            unitPrice: 5130000,
            discountPercent: 5,
            lineTotal: 25650000,
            deliveredQuantity: 5, // Giao đủ 5 thùng (SN-170)
            deliveredBaseQuantity: 60,
            isShortDelivery: false,
          }),
        ],
        subtotal: 31200000,
        totalDiscount: 1560000,
        grandTotal: 29640000,
        note: 'Biên bản bàn giao số BB-2610-08 ghi nhận thiếu 2 hộp Nước Yến, đại lý đã ký xác nhận',
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PARTIAL,
        isShortDelivery: true,
        createdAt: new Date('2026-10-04T09:00:00Z'),
        updatedAt: new Date('2026-10-08T16:30:00Z'),
      }),
      new OrderEntity({
        id: 'ord-005',
        orderCode: 'DH2609-09880',
        customerId: 'cust-001',
        customerCode: 'DL-HCM-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        customerGroup: 'AGENT_LEVEL_1',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        deliveryPoint: {
          id: 'dp-001-1',
          name: 'Kho Tổng Phú Nhuận',
          address: '123 Nguyễn Trọng Tuyển, Phường 8, Quận Phú Nhuận, TP.HCM',
          receiverName: 'Anh Nguyễn Minh Khang',
          phone: '0901234567',
        },
        deliveryDate: '2026-09-25',
        lines: [
          new OrderLineEntity({
            id: 'line-005-1',
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
            unit: 'Thùng (12 lon)',
            baseUnit: 'Lon',
            conversionRate: 12,
            quantity: 4,
            baseQuantity: 48,
            listPrice: 5200000, // Giá cũ tháng trước
            unitPrice: 4940000,
            discountPercent: 5,
            lineTotal: 19760000,
            deliveredQuantity: 4,
          }),
          new OrderLineEntity({
            id: 'line-005-2',
            productId: 'prod-011',
            productSku: 'LH-OLD-COFFEE-CAN',
            productName:
              'Cà Phê Sữa Đậm Đà Loha Lon 240ml (Mẫu Cũ - Ngừng Kinh Doanh)',
            unit: 'Thùng (24 lon)',
            baseUnit: 'Lon',
            conversionRate: 24,
            quantity: 6,
            baseQuantity: 144,
            listPrice: 336000,
            unitPrice: 336000,
            discountPercent: 0,
            lineTotal: 2016000,
            deliveredQuantity: 6,
          }),
        ],
        subtotal: 22816000,
        totalDiscount: 1040000,
        grandTotal: 21776000,
        note: 'Đơn hàng định kỳ tháng 9/2026 - Đã giao hoàn tất',
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
        createdAt: new Date('2026-09-20T08:00:00Z'),
        updatedAt: new Date('2026-09-25T11:00:00Z'),
      }),
    ];

    for (const ord of initialOrders) {
      this.orders.set(ord.id, ord);
    }
  }

  /**
   * Tạo đơn hàng mới cho Đại lý (SN-38 & SN-39)
   */
  async createOrder(
    dto: CreateOrderDto,
    salesRep?: { id?: string; name?: string },
  ): Promise<OrderEntity> {
    const customer = await this.customersService.getCustomerById(dto.customerId);

    // Xác thực điểm giao hàng (SN-31: Đơn hàng chọn điểm giao trong danh sách của đúng đại lý đó)
    let assignedDeliveryPoint: IOrderDeliveryPoint | undefined;
    if (dto.deliveryPoint?.id) {
      const matchPoint = customer.deliveryPoints.find((p) => p.id === dto.deliveryPoint?.id);
      if (!matchPoint) {
        throw new BadRequestException(
          `Điểm giao hàng đã chọn không thuộc danh sách điểm giao của đại lý ${customer.name}`,
        );
      }
      assignedDeliveryPoint = {
        id: matchPoint.id,
        name: matchPoint.name,
        address: matchPoint.address,
        receiverName: matchPoint.receiverName,
        phone: matchPoint.phone,
        roadNote: matchPoint.roadNote,
      };
    } else if (dto.deliveryPoint?.address) {
      assignedDeliveryPoint = {
        name: dto.deliveryPoint.name || 'Điểm giao tự chỉ định',
        address: dto.deliveryPoint.address,
        receiverName: dto.deliveryPoint.receiverName || customer.name,
        phone: dto.deliveryPoint.phone || customer.phone,
        roadNote: dto.deliveryPoint.roadNote,
      };
    } else {
      // Mặc định lấy điểm giao hàng isDefault của đại lý
      const defaultPoint = customer.deliveryPoints.find((p) => p.isDefault) || customer.deliveryPoints[0];
      if (defaultPoint) {
        assignedDeliveryPoint = {
          id: defaultPoint.id,
          name: defaultPoint.name,
          address: defaultPoint.address,
          receiverName: defaultPoint.receiverName,
          phone: defaultPoint.phone,
          roadNote: defaultPoint.roadNote,
        };
      }
    }

    // Tính toán chi tiết dòng hàng
    const pricing = this.resolveOrderPricing(
      dto.lines || [],
      customer.customerGroup,
      dto.priceListId,
    );
    const {
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      requiresApproval,
      approvalReasons,
    } = this.calculateOrderTotals(pricing.lines);

    const orderId = `ord-${Date.now()}`;
    const orderCode = this.generateOrderCode();
    const requestedStatus = dto.status || OrderStatus.PENDING;
    // Approval is only allowed through the guarded status endpoint.
    const orderStatus =
      requestedStatus === OrderStatus.APPROVED
        ? OrderStatus.PENDING
        : requestedStatus;

    const newOrder = new OrderEntity({
      id: orderId,
      orderCode,
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      customerGroup: customer.customerGroup,
      salesRepId: salesRep?.id || customer.salesRepId,
      salesRepName: salesRep?.name || customer.salesRepName,
      deliveryPoint: assignedDeliveryPoint,
      deliveryDate: dto.deliveryDate,
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      note: dto.note,
      status: orderStatus,
      paymentStatus: PaymentStatus.UNPAID,
      priceListId: pricing.priceListId || dto.priceListId,
      requiresApproval,
      approvalReasons,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.orders.set(orderId, newOrder);
    return newOrder;
  }

  /**
   * Lấy danh sách đơn hàng có phân trang & bộ lọc (SN-38)
   */
  async findAllOrders(query: QueryOrdersDto): Promise<{
    data: OrderEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    let list = Array.from(this.orders.values());

    // Sắp xếp đơn mới nhất lên đầu
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (query.status && (query.status as string) !== 'ALL') {
      list = list.filter((o) => o.status === query.status);
    }

    if (query.customerId) {
      list = list.filter(
        (o) =>
          o.customerId === query.customerId ||
          (query.customerId === 'cust-dl-0001' && o.customerId === 'cust-001') ||
          (query.customerId === 'cust-001' && o.customerId === 'cust-dl-0001'),
      );
    }

    if (query.salesRepId) {
      list = list.filter((o) => o.salesRepId === query.salesRepId);
    }

    if (query.search) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.orderCode.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerCode.toLowerCase().includes(q) ||
          o.deliveryPoint?.receiverName.toLowerCase().includes(q) ||
          o.deliveryPoint?.phone.includes(q),
      );
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, query.limit || 10);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const data = list.slice(start, start + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Lấy chi tiết đơn hàng theo ID
   */
  async findOrderById(id: string): Promise<OrderEntity> {
    const order = this.orders.get(id);
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng ${id}`);
    }
    return order;
  }

  /**
   * Cập nhật thông tin đơn hàng (đặc biệt là đơn nháp DRAFT để tiếp tục gõ)
   */
  async updateOrder(id: string, dto: UpdateOrderDto): Promise<OrderEntity> {
    const order = await this.findOrderById(id);

    if (dto.status !== undefined) {
      throw new BadRequestException(
        'Vui lòng cập nhật trạng thái qua chức năng duyệt đơn',
      );
    }

    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể chỉnh sửa đơn hàng ở trạng thái Nháp hoặc Chờ duyệt');
    }

    if (dto.customerId && dto.customerId !== order.customerId) {
      const customer = await this.customersService.getCustomerById(dto.customerId);
      order.customerId = customer.id;
      order.customerCode = customer.code;
      order.customerName = customer.name;
      order.customerGroup = customer.customerGroup;
    }

    if (dto.deliveryPoint) {
      order.deliveryPoint = {
        id: dto.deliveryPoint.id,
        name: dto.deliveryPoint.name || order.deliveryPoint?.name || 'Điểm giao hàng',
        address: dto.deliveryPoint.address,
        receiverName: dto.deliveryPoint.receiverName || order.deliveryPoint?.receiverName || '',
        phone: dto.deliveryPoint.phone || order.deliveryPoint?.phone || '',
        roadNote: dto.deliveryPoint.roadNote,
      };
    }

    if (dto.deliveryDate !== undefined) order.deliveryDate = dto.deliveryDate;
    if (dto.note !== undefined) order.note = dto.note;
    if (dto.lines && dto.lines.length > 0) {
      const pricing = this.resolveOrderPricing(
        dto.lines,
        order.customerGroup || '',
        dto.priceListId,
      );
      const {
        lines,
        subtotal,
        totalDiscount,
        grandTotal,
        requiresApproval,
        approvalReasons,
      } = this.calculateOrderTotals(pricing.lines);
      order.lines = lines;
      order.subtotal = subtotal;
      order.totalDiscount = totalDiscount;
      order.grandTotal = grandTotal;
      order.requiresApproval = requiresApproval;
      order.approvalReasons = approvalReasons;
      order.priceListId = pricing.priceListId || order.priceListId;
    }

    order.updatedAt = new Date();
    return order;
  }

  /**
   * Cập nhật trạng thái đơn hàng (Duyệt, Hủy, Xuất kho...)
   */
  async updateOrderStatus(
    id: string,
    dto: UpdateOrderStatusDto,
  ): Promise<OrderEntity> {
    const order = await this.findOrderById(id);
    // Xử lý nghiệp vụ Hủy đơn hàng (SN-45)
    if (dto.status === OrderStatus.CANCELLED) {
      if (!dto.reason || dto.reason.trim() === '') {
        throw new BadRequestException('Bắt buộc nhập lý do khi hủy đơn hàng');
      }

      const uncancelableStatuses = [
        OrderStatus.SHIPPED,
        OrderStatus.DELIVERED,
        OrderStatus.CLOSED,
        OrderStatus.CANCELLED,
      ];

      if (uncancelableStatuses.includes(order.status)) {
        throw new BadRequestException(
          'Đơn hàng đã xuất kho hoặc đã đóng/hủy, không thể hủy. Vui lòng sử dụng quy trình Trả Hàng (Return).',
        );
      }

      order.cancelReason = dto.reason;
    }

    if (
      dto.status === OrderStatus.APPROVED ||
      dto.status === OrderStatus.REJECTED ||
      dto.status === OrderStatus.RETURNED_FOR_UPDATE
    ) {
      throw new BadRequestException('Dùng chức năng xét duyệt để quyết định đơn chờ duyệt.');
    }
    if (order.status === OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Đơn chờ duyệt chỉ được xử lý qua chức năng xét duyệt.');
    }
    if (this.databaseService && dto.status === OrderStatus.SHIPPED) {
      const reservations = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM app_order_inventory_reservations
         WHERE order_id = $1 AND status = 'RESERVED'`,
        [order.id],
      );
      if (Number(reservations[0]?.count ?? 0) > 0) {
        throw new BadRequestException(
          `Đơn ${order.orderCode} vẫn còn hàng đang giữ. Hãy xuất kho theo mã đơn này trước khi chuyển sang Đã xuất kho.`,
        );
      }
    }
    order.status = dto.status;
    order.updatedAt = new Date();
    return order;
  }

  /**
   * Xóa đơn hàng (chỉ cho phép xóa đơn Nháp hoặc Đã hủy)
   */
  async deleteOrder(id: string): Promise<{ success: boolean; message: string }> {
    const order = await this.findOrderById(id);
    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Chỉ có thể xóa đơn hàng ở trạng thái Nháp hoặc Đã hủy');
    }
    this.orders.delete(id);
    return { success: true, message: 'Đã xóa đơn hàng thành công' };
  }

  /**
   * Lấy danh sách đơn hàng của riêng một Đại lý (SN-170: Chỉ thấy đơn của chính mình)
   */
  async findOrdersByCustomer(
    customerId: string,
    query: QueryOrdersDto,
  ): Promise<{
    data: OrderEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    return this.findAllOrders({
      ...query,
      customerId,
    });
  }

  /**
   * Xem trước dữ liệu đặt lại đơn cũ (SN-174):
   * - Quét phát hiện sản phẩm đã ngừng kinh doanh (ProductStatus.INACTIVE) và tự động loại bỏ
   * - Áp lại đơn giá và chiết khấu hiện hành theo bảng giá hiện thời của đại lý
   */
  async getReorderPreview(
    orderId: string,
    customerId?: string,
  ): Promise<{
    orderId: string;
    orderCode: string;
    customerId: string;
    customerName: string;
    customerGroup: string;
    deliveryPoint?: IOrderDeliveryPoint;
    availableItems: Array<{
      lineId: string;
      productId: string;
      productSku: string;
      productName: string;
      unit: string;
      baseUnit: string;
      conversionRate: number;
      quantity: number;
      oldUnitPrice: number;
      currentUnitPrice: number;
      currentListPrice: number;
      currentDiscountPercent: number;
      isPriceChanged: boolean;
    }>;
    discontinuedItems: Array<{
      lineId?: string;
      productSku: string;
      productName: string;
      reason: string;
    }>;
    warningMessage?: string;
  }> {
    const order = await this.findOrderById(orderId);

    if (customerId && order.customerId !== customerId) {
      throw new BadRequestException('Bạn không có quyền thao tác trên đơn hàng của đại lý khác');
    }

    const customerGroup = order.customerGroup || 'AGENT_LEVEL_1';
    const availableItems: Array<{
      lineId: string;
      productId: string;
      productSku: string;
      productName: string;
      unit: string;
      baseUnit: string;
      conversionRate: number;
      quantity: number;
      oldUnitPrice: number;
      currentUnitPrice: number;
      currentListPrice: number;
      currentDiscountPercent: number;
      isPriceChanged: boolean;
    }> = [];
    const discontinuedItems: Array<{
      lineId?: string;
      productSku: string;
      productName: string;
      reason: string;
    }> = [];

    for (const line of order.lines) {
      let isInactive = false;

      // 1. Kiểm tra trạng thái sản phẩm qua ProductsService
      if (this.productsService) {
        try {
          const product = await this.productsService.findById(line.productSku || line.productId);
          if (product && product.status === ProductStatus.INACTIVE) {
            isInactive = true;
          }
        } catch {
          // Bỏ qua lỗi tìm kiếm nếu không có
        }
      }

      if (isInactive) {
        discontinuedItems.push({
          lineId: line.id,
          productSku: line.productSku,
          productName: line.productName,
          reason: 'Mặt hàng đã ngừng kinh doanh và được loại khỏi đơn mới',
        });
        continue;
      }

      // 2. Tra cứu bảng giá hiện hành của đại lý
      let currentListPrice = line.listPrice;
      let currentUnitPrice = line.unitPrice;
      let currentDiscountPercent = line.discountPercent;

      if (this.priceListsService) {
        try {
          const { item } = this.priceListsService.findEffectivePrice(
            customerGroup,
            line.productId,
            line.productSku,
          );
          if (item) {
            const conversionRate = line.conversionRate > 0 ? line.conversionRate : 1;
            currentListPrice = Math.round(item.price * conversionRate);
            const baseQuantity = Math.round(line.quantity * conversionRate);
            const tierDiscount =
              this.discountPoliciesService?.calculateBestDiscount(
                line.productId,
                '',
                baseQuantity,
                line.productSku,
              ) || 0;
            currentUnitPrice = Math.round((currentListPrice * (100 - tierDiscount)) / 100);
            currentDiscountPercent =
              currentListPrice > 0
                ? Number((((currentListPrice - currentUnitPrice) / currentListPrice) * 100).toFixed(2))
                : 0;
          }
        } catch {
          // Fallback giữ nguyên đơn giá nếu bảng giá không có
        }
      }

      availableItems.push({
        lineId: line.id,
        productId: line.productId,
        productSku: line.productSku,
        productName: line.productName,
        unit: line.unit,
        baseUnit: line.baseUnit,
        conversionRate: line.conversionRate,
        quantity: line.quantity,
        oldUnitPrice: line.unitPrice,
        currentUnitPrice,
        currentListPrice,
        currentDiscountPercent,
        isPriceChanged: currentUnitPrice !== line.unitPrice,
      });
    }

    const warningMessage =
      discontinuedItems.length > 0
        ? `Hệ thống đã tự động loại bỏ ${discontinuedItems.length} mặt hàng ngừng kinh doanh khỏi đơn mới.`
        : undefined;

    return {
      orderId: order.id,
      orderCode: order.orderCode,
      customerId: order.customerId,
      customerName: order.customerName,
      customerGroup,
      deliveryPoint: order.deliveryPoint,
      availableItems,
      discontinuedItems,
      warningMessage,
    };
  }

  /**
   * Đặt lại một đơn đã mua trước đây (SN-174):
   * - Hỗ trợ đặt lại toàn bộ hoặc một phần dòng hàng
   * - Mặt hàng ngừng kinh doanh được loại bỏ tự động kèm thông báo
   * - Giá được áp lại hoàn toàn theo bảng giá hiện hành
   */
  async reorder(
    orderId: string,
    dto: ReorderDto,
    customerId?: string,
  ): Promise<{
    newOrder: OrderEntity;
    discontinuedItems: Array<{
      productSku: string;
      productName: string;
      reason: string;
    }>;
    message: string;
  }> {
    const preview = await this.getReorderPreview(orderId, customerId);

    // Lọc các mặt hàng được chọn
    let targetItems = preview.availableItems;
    if (dto.selectedLineIds !== undefined) {
      targetItems = targetItems.filter((item) =>
        dto.selectedLineIds?.includes(item.lineId),
      );
    }

    if (targetItems.length === 0) {
      throw new BadRequestException(
        'Không có mặt hàng khả dụng nào được chọn để đặt lại đơn hàng',
      );
    }

    // Điều chỉnh số lượng nếu dto có truyền
    const quantityMap = new Map<string, number>();
    if (dto.items && dto.items.length > 0) {
      for (const it of dto.items) {
        quantityMap.set(it.productSku.toUpperCase(), it.quantity);
      }
    }

    const orderLinesDto: CreateOrderLineDto[] = targetItems.map((item) => {
      const customQty = quantityMap.get(item.productSku.toUpperCase());
      const finalQty = customQty && customQty > 0 ? customQty : item.quantity;
      return {
        productId: item.productId,
        productSku: item.productSku,
        productName: item.productName,
        unit: item.unit,
        baseUnit: item.baseUnit,
        conversionRate: item.conversionRate,
        quantity: finalQty,
        unitPrice: item.currentUnitPrice,
        listPrice: item.currentListPrice,
        discountPercent: item.currentDiscountPercent,
      };
    });

    const deliveryPointInput: DeliveryPointInputDto | undefined = dto.deliveryPoint
      ? dto.deliveryPoint
      : preview.deliveryPoint
      ? {
          id: preview.deliveryPoint.id,
          name: preview.deliveryPoint.name,
          address: preview.deliveryPoint.address,
          receiverName: preview.deliveryPoint.receiverName,
          phone: preview.deliveryPoint.phone,
          roadNote: preview.deliveryPoint.roadNote,
        }
      : undefined;

    const createPayload: CreateOrderDto = {
      customerId: preview.customerId,
      deliveryPoint: deliveryPointInput,
      deliveryDate: dto.deliveryDate,
      lines: orderLinesDto,
      note: dto.note
        ? `${dto.note} ${
            preview.discontinuedItems.length > 0
              ? `(Đã loại bỏ ${preview.discontinuedItems.length} mặt hàng ngừng kinh doanh)`
              : ''
          }`.trim()
        : `[Đặt lại từ đơn ${preview.orderCode}] ${
            preview.discontinuedItems.length > 0
              ? `(Đã loại bỏ ${preview.discontinuedItems.length} mặt hàng ngừng kinh doanh)`
              : ''
          }`.trim(),
      status: OrderStatus.PENDING,
    };

    const newOrder = await this.createOrder(createPayload);

    return {
      newOrder,
      discontinuedItems: preview.discontinuedItems,
      message: `Đã đặt lại thành công đơn hàng mới ${newOrder.orderCode}.${
        preview.discontinuedItems.length > 0
          ? ` Đã loại bỏ ${preview.discontinuedItems.length} mặt hàng ngừng kinh doanh.`
          : ''
      }`,
    };
  }
}

