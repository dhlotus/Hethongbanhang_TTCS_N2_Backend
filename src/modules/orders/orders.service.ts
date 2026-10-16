import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DiscountPoliciesService } from '../discount-policies/discount-policies.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import { PriceListItemEntity } from '../price-lists/entities/price-list-item.entity';
import { CustomersService } from '../customers/customers.service';
import { CustomerEntity, CustomerStatus } from '../customers/entities/customer.entity';

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
import { getSeedInitialOrders } from './initial-orders.seed';
import { DatabaseService } from '../../database/database.service';
import { ProductsService } from '../products/products.service';
import { DecideOrderDto } from './dto/decide-order.dto';
import { OrderApprovalAction } from './entities/order-approval-action.enum';
import { OrderApprovalHistoryEntity } from './entities/order-approval-history.entity';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { InventoryService } from '../inventory/inventory.service';
import {
  StockReservationEntity,
  StockReservationStatus,
} from '../inventory/entities/stock-reservation.entity';
import { UserRole } from '../../common/enums/user-role.enum';
import { DEFAULT_WAREHOUSE_ID } from '../warehouses/warehouse.constants';
import { ProductStatus } from '../../common/enums/product-status.enum';
import {
  CustomerPurchaseHistoryResponse,
  LatestOrderItem,
  LatestOrderSummary,
  LOOKBACK_MONTHS,
  SuggestedProductItem,
} from './dto/customer-purchase-history.dto';

export const RESERVATION_EXPIRY_HOURS = 24;

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
 * Async Lock ngắn phòng ngừa race condition khi 2 Sales cùng chốt đơn (SN-39)
 */
class AsyncLock {
  private queue: Promise<void> = Promise.resolve();

  async acquire<T>(fn: () => Promise<T> | T): Promise<T> {
    let release: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.queue;
    this.queue = this.queue.then(() => wait);
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

/**
 * Service Quản lý Đặt hàng B2B (SN-38 & SN-39)
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);
  private readonly orders = new Map<string, OrderEntity>();
  private readonly memoryApprovalHistory = new Map<string, OrderApprovalHistoryEntity[]>();
  private readonly orderLock = new AsyncLock();

  constructor(
    private readonly customersService: CustomersService,
    @Optional() private readonly priceListsService?: PriceListsService,
    @Optional() private readonly discountPoliciesService?: DiscountPoliciesService,
    @Optional()
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService?: ProductsService,
    @Optional()
    @Inject(forwardRef(() => InventoryService))
    private readonly inventoryService?: InventoryService,
    @Optional()
    private readonly databaseService?: DatabaseService,
  ) {
    if (!this.databaseService || !this.databaseService.isConnected()) {
      for (const order of this.seedInitialOrders()) this.orders.set(order.id, order);
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.databaseService || !this.databaseService.isConnected()) {
      if (this.orders.size === 0) {
        for (const order of this.seedInitialOrders()) this.orders.set(order.id, order);
      }
      return;
    }

    try {
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
        const countResult = await client.query(
          'SELECT COUNT(*)::int AS count FROM app_order_records',
        );
        if (Number(countResult.rows[0]?.count ?? 0) < 20) {
          for (const order of this.seedInitialOrders()) {
            await client.query(
              `INSERT INTO app_order_records (id, order_code, payload, created_at, updated_at)
               VALUES ($1, $2, $3::jsonb, $4, $5)
               ON CONFLICT (id) DO UPDATE
               SET payload = EXCLUDED.payload, order_code = EXCLUDED.order_code,
                   created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
              [order.id, order.orderCode, JSON.stringify(order), order.createdAt, order.updatedAt],
            );
          }
        }
        await client.query(
          `UPDATE app_order_storage_state SET seeded = TRUE WHERE state_key = 'orders'`,
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      if (this.databaseService.isConnected()) {
        try {
          const rows = await this.databaseService.query<{ payload: unknown }>(
            'SELECT payload FROM app_order_records',
          );
          for (const row of rows) {
            try {
              const order = this.restoreOrder(row.payload);
              this.orders.set(order.id, order);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }

      if (this.priceListsService) {
        for (const order of this.orders.values()) {
          if (order.priceListId) {
            void this.priceListsService.markPriceListHasOrders(order.priceListId);
          }
        }
      }
    } catch (error) {
      this.logger.warn(`[PostgreSQL] Lỗi khởi tạo bảng đơn hàng, chuyển sang bộ nhớ tạm: ${(error as Error).message}`);
      if (this.orders.size === 0) {
        for (const order of this.seedInitialOrders()) this.orders.set(order.id, order);
      }
    }
  }

  private async ensureApprovalTables(): Promise<void> {
    if (!this.databaseService || !this.databaseService.isConnected()) return;
    await this.ensureApprovalHistoryTable();
    await this.ensureInventoryReservationTable();
    await this.ensureApprovalHistoryImmutability();
  }

  private async ensureApprovalHistoryTable(): Promise<void> {
    if (!this.databaseService || !this.databaseService.isConnected()) return;
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
    if (!this.databaseService || !this.databaseService.isConnected()) return;
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_inventory_reservations (
        id BIGSERIAL PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES app_order_records(id) ON DELETE RESTRICT,
        order_line_id TEXT NOT NULL,
        product_sku TEXT NOT NULL,
        warehouse_id UUID NOT NULL DEFAULT '${DEFAULT_WAREHOUSE_ID}',
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
    if (!this.databaseService || !this.databaseService.isConnected()) return;
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
    this.orders.set(order.id, order);
    if (!this.databaseService || !this.databaseService.isConnected()) {
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
   * Validation Guard kiểm tra số lượng đặt với tồn khả dụng (SN-39 & SN-42):
   * availableStock = physicalStock - reservedStock
   * Nếu availableStock <= 0 hoặc orderQuantity > availableStock: Chặn không cho lưu vào DB, trả về lỗi HTTP 400 Bad Request:
   * "Sản phẩm [Tên SKU] vượt quá tồn khả dụng (Hàng trong kho đã hết / Vượt quá tồn khả dụng...)"
   */
  async validateOrderLinesAvailableStock(
    lines: CreateOrderLineDto[],
    customerId?: string,
    excludeOrderId?: string,
  ): Promise<void> {
    if (!this.productsService || !lines || lines.length === 0) return;

    if (this.databaseService?.isConnected() && this.inventoryService && customerId) {
      await this.validatePersistedOrderStock(lines, customerId, excludeOrderId);
      return;
    }
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
      const computedAvailableStock = Math.max(0, physicalStock - reservedStock);
      const availableStock = typeof product.availableStock === 'number'
        ? Math.min(product.availableStock, computedAvailableStock)
        : computedAvailableStock;

      const conversionRate = line.conversionRate > 0 ? line.conversionRate : 1;
      const orderBaseQuantity = Math.round(line.quantity * conversionRate);

      const unitName = line.unit || product.baseUnit || 'sản phẩm';
      const skuName = product.name || line.productName || line.productSku;

      if (availableStock <= 0) {
        throw new BadRequestException(
          `Sản phẩm ${skuName}: Hàng trong kho đã hết / Vượt quá tồn khả dụng (Còn lại 0 ${unitName})`,
        );
      }

      if (orderBaseQuantity > availableStock) {
        const maxAllowedInUnit =
          conversionRate > 1
            ? Math.floor(availableStock / conversionRate)
            : availableStock;
        throw new BadRequestException(
          `Sản phẩm ${skuName} vượt quá tồn khả dụng (Hàng trong kho đã hết / Vượt quá tồn khả dụng: Còn tối đa ${maxAllowedInUnit} ${unitName})`,
        );
      }
    }
  }

  private async validatePersistedOrderStock(
    lines: CreateOrderLineDto[],
    customerId: string,
    excludeOrderId?: string,
  ): Promise<void> {
    if (!this.databaseService || !this.inventoryService) {
      throw new InternalServerErrorException('Dịch vụ tồn kho chưa được cấu hình.');
    }
    let warehouseId = DEFAULT_WAREHOUSE_ID;
    try {
      const warehouseRows = await this.databaseService.query<{ warehouse_id: string }>(
        'SELECT warehouse_id FROM app_agency_default_warehouses WHERE agency_key = $1',
        [customerId],
      );
      if (warehouseRows[0]?.warehouse_id) {
        warehouseId = warehouseRows[0].warehouse_id;
      }
    } catch {
      // Fallback DEFAULT_WAREHOUSE_ID
    }
    const stockRows = await this.inventoryService.getStockOverview(warehouseId);
    const availableBySku = new Map(
      stockRows.map((row) => [row.sku.trim().toUpperCase(), row.stockQuantity]),
    );
    if (excludeOrderId) {
      const reservations = await this.databaseService.query<{ product_sku: string; quantity: string }>(
        `SELECT product_sku, SUM(base_quantity)::text AS quantity
         FROM app_order_inventory_reservations
         WHERE order_id = $1 AND warehouse_id = $2::uuid AND status = 'RESERVED'
         GROUP BY product_sku`,
        [excludeOrderId, warehouseId],
      );
      for (const reservation of reservations) {
        const sku = reservation.product_sku.toUpperCase();
        availableBySku.set(sku, (availableBySku.get(sku) ?? 0) + Number(reservation.quantity));
      }
    }
    const requiredBySku = new Map<string, number>();
    for (const line of lines) {
      const sku = line.productSku.trim().toUpperCase();
      const required = Math.round(line.quantity * line.conversionRate);
      requiredBySku.set(sku, (requiredBySku.get(sku) ?? 0) + required);
    }
    for (const [sku, required] of requiredBySku) {
      const available = availableBySku.get(sku) ?? 0;
      if (required > available) {
        throw new BadRequestException(
          `Sản phẩm ${sku} vượt quá tồn khả dụng tại kho của đại lý (còn ${available}, cần ${required}).`,
        );
      }
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
        ? `SKU ${item.productSku}: giá bán ${unitPrice.toLocaleString('vi-VN')} đ thấp hơn giá sàn ${item.minPrice?.toLocaleString('vi-VN')} đ`
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
    customerId?: string,
  ): ResolvedOrderPricing {
    if (!this.priceListsService) return { lines };

    let selectedPriceListId: string | undefined;
    const pricedLines = lines.map((line) => {
      const resolved = this.resolveOrderLinePricing(
        line,
        customerGroup,
        requestedPriceListId,
        customerId,
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
    customerId?: string,
  ): { line: PricedOrderLineDto; priceListId: string } {
    const { item, priceListId } = this.findEffectivePriceItem(
      line,
      customerGroup,
      requestedPriceListId,
    );
    const conversionRate = line.conversionRate > 0 ? line.conversionRate : 1;
    if (item.baseUnit && line.baseUnit && item.baseUnit.toLowerCase() !== line.baseUnit.toLowerCase()) {
      // Tự động chuẩn hóa theo đơn vị cơ sở của Bảng giá hiện hành
      line.baseUnit = item.baseUnit;
    } else if (item.baseUnit && !line.baseUnit) {
      line.baseUnit = item.baseUnit;
    }

    const calculatedPrice = this.calculateLinePrices(line, item, conversionRate, customerId);

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
    customerId?: string,
  ): Pick<PricedOrderLineDto, 'listPrice' | 'unitPrice' | 'discountPercent' | 'minPrice' | 'requiresApproval'> {
    const listPrice = Math.round(item.price * conversionRate);
    const baseQuantity = Math.max(1, Math.round(line.quantity * conversionRate));

    // Gọi Pricing & Discount Engine dùng chung (Single Source of Truth)
    const pricingCalc = this.discountPoliciesService?.calculateFinalPriceAndDiscount({
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      categoryId: (line as any).categoryId || '',
      quantity: baseQuantity,
      listPrice,
      customerId,
      agencyId: customerId,
    });

    const automaticUnitPrice = pricingCalc
      ? pricingCalc.unitPrice
      : listPrice;

    if (line.isPriceManuallyEdited && line.unitPrice === undefined) {
      throw new BadRequestException(
        `Vui lòng nhập giá bán thủ công cho SKU ${line.productSku}`,
      );
    }

    const unitPrice = line.isPriceManuallyEdited
      ? Math.max(0, line.unitPrice!)
      : Math.max(0, automaticUnitPrice);
    const minPrice = Math.round(item.minPrice * conversionRate);
    const discountPercent = line.isPriceManuallyEdited
      ? (listPrice > 0
          ? Number(Math.min(100, Math.max(0, (((listPrice - unitPrice) / listPrice) * 100))).toFixed(2))
          : 0)
      : (pricingCalc ? pricingCalc.discountPercent : 0);

    return { listPrice, unitPrice, discountPercent, minPrice, requiresApproval: unitPrice < minPrice };
  }

  /**
   * Khởi tạo dữ liệu mẫu thực tế cho đơn hàng
   */
  private seedInitialOrders(): OrderEntity[] {
    const initialOrders = getSeedInitialOrders();
    for (const ord of initialOrders) {
      this.orders.set(ord.id, ord);
    }
    return initialOrders;
  }

  /**
   * Tạo đơn hàng mới cho Đại lý (SN-38 & SN-39)
   */
  async createOrder(
    dto: CreateOrderDto,
    salesRep?: { id?: string; name?: string },
  ): Promise<OrderEntity> {
    return this.orderLock.acquire(async () => {
      // Chuẩn hóa DTO nếu gửi từ Portal dạng items & deliveryAddress
      if ((!dto.lines || dto.lines.length === 0) && dto.items && dto.items.length > 0) {
        dto.lines = dto.items.map((item) => {
          const product = this.productsService?.findProductInternal(item.productId);
          const unit = item.unit || product?.baseUnit || 'Cái';
          return {
            productId: item.productId,
            productSku: product?.sku || item.productId,
            productName: product?.name || 'Sản phẩm',
            unit,
            baseUnit: product?.baseUnit || unit,
            conversionRate: 1,
            quantity: Number(item.quantity),
            unitPrice: Number(item.price ?? product?.price ?? 0),
            listPrice: Number(product?.price ?? item.price ?? 0),
            discountPercent: Number(item.discountPercent ?? 0),
            isPriceManuallyEdited: false,
            stockAvailable: product?.availableStock ?? product?.stockQuantity,
          };
        });
      }

      if (!dto.deliveryPoint && dto.deliveryAddress) {
        dto.deliveryPoint = {
          name: 'Địa chỉ giao hàng',
          address: dto.deliveryAddress,
        };
      }

      const requestedStatus = dto.status || OrderStatus.PENDING;
      if (requestedStatus !== OrderStatus.DRAFT && (!dto.lines || dto.lines.length === 0)) {
        throw new BadRequestException('Đơn hàng phải có ít nhất một sản phẩm');
      }

      // 0. API Validation Guard (SN-39 & SN-42): Kiểm tra số lượng đặt với tồn khả dụng
      if (dto.lines && dto.lines.length > 0) {
        await this.validateOrderLinesAvailableStock(dto.lines, dto.customerId);
      }

      const customer = await this.customersService.getCustomerById(dto.customerId);

    // Kiểm tra trạng thái đại lý (SN-36: Đại lý bị khóa không tạo được đơn mới, kể cả trên cổng đặt hàng)
    if (customer.status === CustomerStatus.LOCKED) {
      throw new BadRequestException(
        `Đại lý "${customer.name}" đang bị KHÓA GIAO DỊCH (Lý do khóa: ${customer.lockReason || 'Không xác định'}). Không thể tạo đơn hàng mới, kể cả trên cổng đặt hàng!`,
      );
    }

    // 1. Kiểm tra điều kiện công nợ của đại lý (Task SN-41)
    const debtStatus = await this.customersService.getCustomerDebtStatus(dto.customerId);

    // Trường hợp 1: Chặn hoàn toàn (Hard Block) nếu nợ quá hạn vượt quá số ngày cho phép
    if (!debtStatus.canCreateOrder) {
      throw new BadRequestException(
        debtStatus.blockReason ||
          'Đại lý có khoản nợ quá hạn vượt quá thời hạn cho phép. Không thể tạo đơn hàng mới.',
      );
    }

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
      customer.id,
    );
    const {
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      requiresApproval,
      approvalReasons,
    } = this.calculateOrderTotals(pricing.lines);

    // 2. Kiểm tra hạn mức công nợ (Task SN-41 - Approval Flow)
    // Trường hợp 2: Nếu (Tổng tiền đơn hàng mới + Công nợ hiện tại) > Hạn mức công nợ
    const currentDebt = customer.currentDebt || 0;
    const creditLimit = customer.creditLimit || 0;
    const projectedDebt = currentDebt + grandTotal;
    const isCreditLimitExceeded = creditLimit > 0 && projectedDebt > creditLimit;
    const creditLimitExceededAmount = isCreditLimitExceeded
      ? projectedDebt - creditLimit
      : 0;

    const requiresOrderApproval = requiresApproval || isCreditLimitExceeded;
    let orderStatus = requestedStatus === OrderStatus.APPROVED
      ? OrderStatus.PENDING
      : requestedStatus;
    let orderNote = dto.note;
    const orderApprovalReasons = [...approvalReasons];

    if (isCreditLimitExceeded) {
      orderApprovalReasons.push(
        `Vượt hạn mức công nợ ${creditLimitExceededAmount.toLocaleString('vi-VN')} đ (công nợ dự kiến ${projectedDebt.toLocaleString('vi-VN')} đ / hạn mức ${creditLimit.toLocaleString('vi-VN')} đ)`,
      );
      if (requestedStatus !== OrderStatus.DRAFT) {
        orderStatus = OrderStatus.PENDING_APPROVAL;
      }
      const warningNote = `[SN-41 CẢNH BÁO: Đơn hàng làm tổng công nợ đạt ${projectedDebt.toLocaleString('vi-VN')} đ, vượt hạn mức ${creditLimit.toLocaleString('vi-VN')} đ (vượt ${creditLimitExceededAmount.toLocaleString('vi-VN')} đ). Chờ Quản lý/Kế toán phê duyệt]`;
      orderNote = orderNote ? `${orderNote}\n${warningNote}` : warningNote;
    }
    const orderId = `ord-${randomUUID()}`;
    const orderCode = this.generateOrderCode();

    const newOrder = new OrderEntity({
      id: orderId,
      orderCode,
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      customerGroup: customer.customerGroup,
      salesRepId: dto.salesRepId || salesRep?.id || customer.salesRepId,
      salesRepName: dto.salesRepName || salesRep?.name || customer.salesRepName,
      region: customer.region || (assignedDeliveryPoint?.address?.includes('Hà Nội') ? 'Miền Bắc' : 'Miền Nam'),
      deliveryPoint: assignedDeliveryPoint,
      deliveryDate: dto.deliveryDate,
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      note: orderNote,
      status: orderStatus,
      paymentStatus: PaymentStatus.UNPAID,
      priceListId: pricing.priceListId || dto.priceListId,
      requiresApproval: requiresOrderApproval,
      approvalReasons: orderApprovalReasons,
      isCreditLimitExceeded,
      creditLimitExceededAmount,
      createdSource: dto.createdSource || (salesRep ? 'SALES_REP' : 'AGENCY_PORTAL'),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await this.saveOrder(newOrder);

    // Cập nhật công nợ thực tế sau khi tạo đơn (nếu không phải là đơn DRAFT)
    if (newOrder.status !== OrderStatus.DRAFT && newOrder.grandTotal > 0 && customer.id) {
      try {
        await this.customersService.adjustCustomerDebt(customer.id, newOrder.grandTotal);
      } catch (debtErr) {
        this.logger.warn(`Không thể cập nhật công nợ sau đơn hàng: ${debtErr}`);
      }
    }

    // Đánh dấu Bảng giá đã phát sinh đơn hàng (Ràng buộc đơn hàng hasOrders = true)
    if (newOrder.priceListId && this.priceListsService) {
      await this.priceListsService.markPriceListHasOrders(newOrder.priceListId);
    }

    // Cập nhật tính toán tồn khả dụng cho các sản phẩm trong đơn (SN-180 & SN-42)
    if (!this.databaseService?.isConnected() && this.productsService && newOrder.lines) {
      for (const line of newOrder.lines) {
        const product = this.productsService.findProductInternal(
          line.productId || line.productSku,
        );
        if (product) {
          if (newOrder.status === OrderStatus.APPROVED) {
            const conversionRate = line.conversionRate > 0 ? line.conversionRate : 1;
            const deductQuantity = line.baseQuantity || Math.round((Number(line.quantity) || 0) * conversionRate);
            this.productsService.deductAvailableStock(product.id || product.sku, deductQuantity);
          } else {
            this.productsService.populateProductStock(product);
          }
        }
      }
    }

    return newOrder;
    });
  }

  /**
   * Lấy danh sách đơn hàng có phân trang & bộ lọc (SN-38, SN-39 & SN-46)
   * - Hỗ trợ lọc theo trạng thái, đại lý, nhân viên, khu vực, khoảng thời gian
   * - Hiển thị tổng tiền của tập kết quả đang lọc (totalAmount)
   * - Phân quyền: Nhân viên kinh doanh (SALES_REP) chỉ thấy đơn của đại lý mình phụ trách
   */
  async findAllOrders(
    query: QueryOrdersDto,
    currentUser?: { id?: string; role?: string; username?: string; roles?: string[] },
  ): Promise<{
    data: OrderEntity[];
    total: number;
    totalAmount: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    let list = this.databaseService?.isConnected()
      ? (await this.databaseService.query<{ [key: string]: unknown; payload: unknown }>(
          'SELECT payload FROM app_order_records ORDER BY created_at DESC',
        )).map((row) => this.restoreOrder(row.payload))
      : Array.from(this.orders.values());

    // Sắp xếp đơn mới nhất lên đầu
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // 1. Phân quyền theo vai trò (SN-46):
    // Nhân viên kinh doanh (SALES_REP) chỉ thấy đơn do mình phụ trách
    const userRole = currentUser?.role || (currentUser?.roles && currentUser.roles[0]);
    const isOnlySalesRep = userRole === 'SALES_REP';

    if (isOnlySalesRep && (currentUser?.id || currentUser?.username)) {
      const repId = currentUser.id;
      const repName = currentUser.username?.toLowerCase();
      list = list.filter((o) => {
        const matchId = repId && o.salesRepId === repId;
        const matchName = repName && o.salesRepName?.toLowerCase().includes(repName);
        return matchId || matchName;
      });
    }

    // 2. Lọc theo trạng thái đơn hàng
    if (query.status && (query.status as string) !== 'ALL') {
      const st = (query.status as string).toUpperCase().trim();
      list = list.filter((o) => o.status && o.status.toUpperCase().trim() === st);
    }

    // 3. Lọc theo đại lý (customerId)
    if (query.customerId && query.customerId !== 'ALL') {
      const qCust = query.customerId;
      const qCustNorm = qCust.replace('cust-dl-', 'cust-');
      list = list.filter(
        (o) =>
          o.customerId === qCust ||
          o.customerCode === qCust ||
          (o.customerId && o.customerId.replace('cust-dl-', 'cust-') === qCustNorm),
      );
    }

    // 4. Lọc theo nhân viên kinh doanh (salesRepId / assignedUser)
    const salesRepFilter = query.salesRepId || query.assignedUser;
    if (salesRepFilter && salesRepFilter !== 'ALL') {
      const repQuery = salesRepFilter.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.salesRepId === salesRepFilter ||
          (o.salesRepName && o.salesRepName.toLowerCase().includes(repQuery)),
      );
    }

    // 5. Lọc theo khu vực (region: Miền Bắc, Miền Trung, Miền Nam...)
    if (query.region && query.region !== 'ALL') {
      const reg = query.region.toLowerCase().trim();
      list = list.filter((o) => {
        const inOrder = o.region && o.region.toLowerCase().includes(reg);
        const inDelivery = o.deliveryPoint?.address?.toLowerCase().includes(reg);
        return inOrder || inDelivery;
      });
    }

    // 6. Lọc theo khoảng thời gian (fromDate, toDate, dateType)
    // Chuẩn hóa ngày dạng YYYY-MM-DD độc lập với múi giờ
    const toDateKey = (val: string | Date | undefined): string => {
      if (!val) return '';
      if (typeof val === 'string') {
        const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
      }
      const d = new Date(val);
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const fromKey = query.fromDate?.trim();
    const toKey = query.toDate?.trim();
    const dateType = query.dateType?.toUpperCase() || 'CREATED'; // CREATED (mặc định: Ngày tạo/đặt đơn) | DELIVERY (Ngày giao)

    if (fromKey || toKey) {
      list = list.filter((o) => {
        const cKey = toDateKey(o.createdAt);
        const dKey = toDateKey(o.deliveryDate);
        const targetKey = dateType === 'DELIVERY' ? dKey : cKey;

        if (fromKey && toKey) {
          return Boolean(targetKey && targetKey >= fromKey && targetKey <= toKey);
        } else if (fromKey) {
          return Boolean(targetKey && targetKey >= fromKey);
        } else if (toKey) {
          return Boolean(targetKey && targetKey <= toKey);
        }
        return true;
      });
    }

    // 7. Tìm kiếm tự do (mã đơn, mã đại lý, tên đại lý, sđt, người nhận, nhân viên)
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (o) =>
          (o.orderCode && o.orderCode.toLowerCase().includes(q)) ||
          (o.customerName && o.customerName.toLowerCase().includes(q)) ||
          (o.customerCode && o.customerCode.toLowerCase().includes(q)) ||
          (o.salesRepName && o.salesRepName.toLowerCase().includes(q)) ||
          (o.deliveryPoint?.receiverName &&
            o.deliveryPoint.receiverName.toLowerCase().includes(q)) ||
          (o.deliveryPoint?.phone && o.deliveryPoint.phone.includes(q)),
      );
    }

    // 8. Tính tổng tiền của tập kết quả đang lọc (Yêu cầu cốt lõi SN-46)
    const totalAmount = list.reduce((sum, o) => sum + (o.grandTotal || 0), 0);

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Number(query.limit) || 10);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const data = list.slice(start, start + limit);

    return {
      data,
      total,
      totalAmount,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Bổ sung cảnh báo nếu đại lý của đơn hàng dở đang bị khóa giao dịch (SN-36)
   */
  private async checkAndAttachLockWarning(order: OrderEntity): Promise<OrderEntity> {
    try {
      const customer = await this.customersService.getCustomerById(order.customerId);
      if (customer.status === CustomerStatus.LOCKED) {
        order.isCustomerLocked = true;
        order.warningMessage = `CẢNH BÁO (SN-36): Đại lý "${customer.name}" đang bị KHÓA GIAO DỊCH (Lý do: ${customer.lockReason || 'Không xác định'}). Đơn đang dở vẫn xử lý tiếp được nhưng cần cảnh báo trước khi duyệt/xuất kho.`;
      } else {
        order.isCustomerLocked = false;
        order.warningMessage = undefined;
      }
    } catch {
      // Bỏ qua nếu không tìm thấy đại lý
    }
    return order;
  }

  /**
   * Lấy chi tiết đơn hàng theo ID
   */
  async findOrderById(id: string): Promise<OrderEntity> {
    const rows = this.databaseService?.isConnected()
      ? await this.databaseService.query<{ [key: string]: unknown; payload: unknown }>(
          'SELECT payload FROM app_order_records WHERE id = $1 OR order_code = $1 LIMIT 1',
          [id],
        )
      : [];
    const order = this.databaseService?.isConnected()
      ? (rows[0] ? this.restoreOrder(rows[0].payload) : undefined)
      : (this.orders.get(id) || Array.from(this.orders.values()).find((o) => o.id === id || o.orderCode === id));
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng ${id}`);
    }
    return this.checkAndAttachLockWarning(order);
  }

  async getApprovalHistory(orderId: string): Promise<OrderApprovalHistoryEntity[]> {
    const order = await this.findOrderById(orderId);
    if (!this.databaseService || !this.databaseService.isConnected()) return this.memoryApprovalHistory.get(orderId) ?? [];
    const rows = await this.databaseService.query<{
      [key: string]: unknown;
      id: number;
      order_id: string;
      action: OrderApprovalAction;
      comment: string | null;
      approver_id: string;
      approver_name: string;
      approver_roles: string[];
      created_at: Date;
    }>(
      `SELECT id, order_id, action, comment, approver_id, approver_name,
              approver_roles, created_at
       FROM app_order_approval_history
       WHERE order_id = $1
       ORDER BY created_at DESC, id DESC`,
      [order.id],
    );
    return rows.map((row) => this.toApprovalHistoryEntity(row));
  }

  private toApprovalHistoryEntity(row: {
    id: number;
    order_id: string;
    action: OrderApprovalAction;
    comment: string | null;
    approver_id: string;
    approver_name: string;
    approver_roles: string[];
    created_at: Date;
  }): OrderApprovalHistoryEntity {
    return new OrderApprovalHistoryEntity({
      id: row.id,
      orderId: row.order_id,
      action: row.action,
      comment: row.comment,
      approverId: row.approver_id,
      approverName: row.approver_name,
      approverRoles: row.approver_roles,
      createdAt: new Date(row.created_at),
    });
  }

  /**
   * Duyệt đơn & kích hoạt giữ chỗ tồn kho (SN-180 AC1 & AC3)
   */
  async approveOrder(
    orderId: string,
    manager: ICurrentUser | string,
  ): Promise<OrderEntity> {
    const reviewer: ICurrentUser = typeof manager === 'string'
      ? {
          userId: manager,
          username: manager,
          email: `${manager}@loha.vn`,
          roles: [UserRole.SALES_MANAGER],
        }
      : manager;

    return this.decideOrder(
      orderId,
      {
        action: OrderApprovalAction.APPROVE,
        comment: 'Đã duyệt đơn và giữ chỗ tồn kho thành công',
      },
      reviewer,
    );
  }

  /**
   * Hủy đơn & tự động nhả tồn giữ chỗ (SN-180 AC2 & AC3, SN-49 / SN-46)
   */
  async cancelOrder(
    orderId: string,
    reason?: string,
    user?: ICurrentUser | string,
  ): Promise<OrderEntity> {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('Bắt buộc phải nhập lý do hủy đơn hàng.');
    }

    const canceller: ICurrentUser = typeof user === 'string'
      ? {
          userId: user,
          username: user,
          email: `${user}@loha.vn`,
          roles: [UserRole.SALES_MANAGER],
        }
      : user || {
          userId: 'system',
          username: 'Hệ thống',
          email: 'system@loha.vn',
          roles: [UserRole.ADMIN],
        };

    if (!this.databaseService?.isConnected()) {
      return this.cancelOrderInMemory(orderId, reason, canceller);
    }

    const client = await this.databaseService.getClient();
    try {
      await client.query('BEGIN');
      const order = await this.loadLockedOrder(client, orderId);

      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException('Đơn hàng đã ở trạng thái Đã hủy.');
      }

      // Nhả toàn bộ giữ chỗ tồn kho của đơn hàng này
      await client.query(
        `UPDATE stock_reservations
         SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE order_id = $1 AND status IN ('ACTIVE', 'RESERVED')`,
        [order.id],
      );
      await client.query(
        `UPDATE app_order_inventory_reservations
         SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE order_id = $1 AND status = 'RESERVED'`,
        [order.id],
      );

      order.status = OrderStatus.CANCELLED;
      order.cancelReason = reason.trim();
      order.updatedAt = new Date();

      await client.query(
        `UPDATE app_order_records SET payload = $2::jsonb, updated_at = $3 WHERE id = $1`,
        [order.id, JSON.stringify(order), order.updatedAt],
      );

      await client.query(
        `INSERT INTO app_order_approval_history
         (order_id, action, comment, approver_id, approver_name, approver_roles)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          order.id,
          OrderApprovalAction.REJECT,
          `Hủy đơn hàng: ${reason.trim()}`,
          canceller.userId,
          canceller.username || canceller.email || canceller.userId,
          canceller.roles || [UserRole.SALES_MANAGER],
        ],
      );

      // Đồng bộ bộ nhớ trong OrdersService và InventoryService
      this.orders.set(order.id, order);
      this.inventoryService?.releaseMemoryReservationsByOrderId(order.id);

      // Cập nhật hồi phục tồn khả dụng trong productsService
      if (this.productsService && order.lines) {
        for (const line of order.lines) {
          this.productsService.restoreAvailableStock(
            line.productId || line.productSku,
            line.baseQuantity || line.quantity,
          );
        }
      }

      // Hoàn trả công nợ khi hủy đơn
      if (order.grandTotal > 0 && order.customerId) {
        await client.query(
          `UPDATE customers SET current_debt = GREATEST(0, COALESCE(current_debt, 0) - $1), updated_at = NOW() WHERE id = $2 OR code = $2`,
          [order.grandTotal, order.customerId],
        );
        try {
          await this.customersService.adjustCustomerDebt(order.customerId, -order.grandTotal);
        } catch {}
      }

      await client.query('COMMIT');
      return order;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async cancelOrderInMemory(
    orderId: string,
    reason: string,
    canceller: ICurrentUser,
  ): Promise<OrderEntity> {
    const order = await this.findOrderById(orderId);

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException('Đơn hàng đã ở trạng thái Đã hủy.');
    }

    // Nhả tồn giữ chỗ in-memory
    this.inventoryService?.releaseMemoryReservationsByOrderId(order.id);

    order.status = OrderStatus.CANCELLED;
    order.cancelReason = reason.trim();
    order.updatedAt = new Date();
    await this.saveOrder(order);

    // Hồi phục tồn khả dụng trong productsService
    if (this.productsService && order.lines) {
      for (const line of order.lines) {
        this.productsService.restoreAvailableStock(
          line.productId || line.productSku,
          line.baseQuantity || line.quantity,
        );
      }
    }

    // Hoàn trả công nợ khi hủy đơn in-memory
    if (order.grandTotal > 0 && order.customerId) {
      try {
        await this.customersService.adjustCustomerDebt(order.customerId, -order.grandTotal);
      } catch (err) {
        this.logger.warn(`Lỗi hoàn trả nợ: ${err}`);
      }
    }

    const history = this.memoryApprovalHistory.get(orderId) ?? [];
    history.push(
      new OrderApprovalHistoryEntity({
        id: Date.now(),
        orderId,
        action: OrderApprovalAction.REJECT,
        comment: `Hủy đơn hàng: ${reason.trim()}`,
        approverId: canceller.userId,
        approverName: canceller.username || canceller.email || canceller.userId,
        approverRoles: canceller.roles || [UserRole.SALES_MANAGER],
        createdAt: new Date(),
      }),
    );
    this.memoryApprovalHistory.set(orderId, history);

    return order;
  }

  /**
   * Tự động quét và nhả tồn giữ chỗ cho các đơn hàng quá hạn 24h (SN-180 AC2)
   */
  async releaseExpiredReservations(): Promise<{
    releasedReservations: number;
    cancelledOrders: number;
  }> {
    if (!this.databaseService?.isConnected()) {
      return this.releaseExpiredReservationsInMemory();
    }

    const client = await this.databaseService.getClient();
    try {
      await client.query('BEGIN');

      const expiredRows = await client.query<{ order_id: string }>(
        `SELECT DISTINCT order_id FROM stock_reservations
         WHERE status IN ('ACTIVE', 'RESERVED') AND expired_at < CURRENT_TIMESTAMP`,
      );

      if (expiredRows.rows.length === 0) {
        await client.query('COMMIT');
        return { releasedReservations: 0, cancelledOrders: 0 };
      }

      const orderIds = expiredRows.rows.map((r) => r.order_id);

      const updateRes = await client.query(
        `UPDATE stock_reservations
         SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE status IN ('ACTIVE', 'RESERVED') AND expired_at < CURRENT_TIMESTAMP`,
      );
      await client.query(
        `UPDATE app_order_inventory_reservations
         SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE order_id = ANY($1::text[]) AND status = 'RESERVED'`,
        [orderIds],
      );

      let cancelledOrdersCount = 0;
      for (const orderId of orderIds) {
        try {
          const order = await this.loadLockedOrder(client, orderId);
          if (
            order.status === OrderStatus.APPROVED ||
            order.status === OrderStatus.PENDING ||
            order.status === OrderStatus.PENDING_APPROVAL
          ) {
            order.status = OrderStatus.CANCELLED;
            order.cancelReason = 'Đơn hàng quá hạn giữ chỗ 24h tự động hủy và nhả tồn kho';
            order.updatedAt = new Date();

            await client.query(
              `UPDATE app_order_records SET payload = $2::jsonb, updated_at = $3 WHERE id = $1`,
              [order.id, JSON.stringify(order), order.updatedAt],
            );

            await client.query(
              `INSERT INTO app_order_approval_history
               (order_id, action, comment, approver_id, approver_name, approver_roles)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                order.id,
                OrderApprovalAction.REJECT,
                'Tự động hủy đơn do quá hạn giữ chỗ 24h',
                'system-scheduler',
                'Hệ thống tự động',
                ['ADMIN'],
              ],
            );
            cancelledOrdersCount++;
          }
        } catch {
          // Bỏ qua lỗi từng đơn lẻ để hoàn tất các đơn khác
        }
      }

      await client.query('COMMIT');
      return {
        releasedReservations: updateRes.rowCount || orderIds.length,
        cancelledOrders: cancelledOrdersCount,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseExpiredReservationsInMemory(): Promise<{
    releasedReservations: number;
    cancelledOrders: number;
  }> {
    const memoryResult = this.inventoryService?.releaseExpiredMemoryReservations() || {
      releasedReservations: 0,
      cancelledOrderIds: [],
    };

    let cancelledOrdersCount = 0;
    for (const orderId of memoryResult.cancelledOrderIds) {
      const order = this.orders.get(orderId);
      if (
        order &&
        (order.status === OrderStatus.APPROVED ||
          order.status === OrderStatus.PENDING ||
          order.status === OrderStatus.PENDING_APPROVAL)
      ) {
        order.status = OrderStatus.CANCELLED;
        order.cancelReason = 'Đơn hàng quá hạn giữ chỗ 24h tự động hủy và nhả tồn kho';
        order.updatedAt = new Date();
        this.orders.set(orderId, order);
        cancelledOrdersCount++;
      }
    }

    return {
      releasedReservations: memoryResult.releasedReservations,
      cancelledOrders: cancelledOrdersCount,
    };
  }
  async decideOrder(
    orderId: string,
    dto: DecideOrderDto,
    reviewer: ICurrentUser,
  ): Promise<OrderEntity> {
    if (dto.action !== OrderApprovalAction.APPROVE && !dto.comment?.trim()) {
      throw new BadRequestException('Từ chối hoặc trả lại đơn cần có ý kiến.');
    }
    if (!this.databaseService || !this.databaseService.isConnected()) {
      return this.decideOrderInMemory(orderId, dto, reviewer);
    }

    if (dto.action === OrderApprovalAction.APPROVE) {
      if (!this.inventoryService) {
        throw new InternalServerErrorException('Dịch vụ tồn kho chưa được cấu hình.');
      }
      await this.inventoryService.ensureStockBalanceTable();
      await this.inventoryService.ensureStockReservationsTable?.();
    }

    const client = await this.databaseService.getClient();
    try {
      await client.query('BEGIN');
      const order = await this.loadLockedOrder(client, orderId);
      this.ensureOrderCanBeDecided(order, dto.action);
      if (dto.action === OrderApprovalAction.APPROVE) {
        await this.reserveOrderInventory(client, order);
      }
      this.applyApprovalDecision(order, dto.action);
      await this.saveDecision(client, order, dto, reviewer);
      this.orders.set(order.id, order);
      if (this.productsService && order.lines) {
        for (const line of order.lines) {
          const product = this.productsService.findProductInternal(
            line.productId || line.productSku,
          );
          if (product) {
            this.productsService.populateProductStock(product);
          }
        }
      }
      await client.query('COMMIT');
      return order;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadLockedOrder(client: PoolClient, orderId: string): Promise<OrderEntity> {
    const result = await client.query<{ payload: unknown }>(
      'SELECT payload FROM app_order_records WHERE id = $1 OR order_code = $1 LIMIT 1 FOR UPDATE',
      [orderId],
    );
    if (!result.rows[0]) throw new NotFoundException(`Không tìm thấy đơn hàng ${orderId}`);
    return this.restoreOrder(result.rows[0].payload);
  }

  private ensureOrderCanBeDecided(order: OrderEntity, action: OrderApprovalAction): void {
    const canApprove = [OrderStatus.PENDING, OrderStatus.PENDING_APPROVAL].includes(order.status);
    const canRejectOrReturn = canApprove;
    if (!canApprove || (action !== OrderApprovalAction.APPROVE && !canRejectOrReturn)) {
      throw new BadRequestException('Đơn hàng không còn ở trạng thái có thể xét duyệt.');
    }
  }

  private applyApprovalDecision(order: OrderEntity, action: OrderApprovalAction): void {
    const statusByAction: Record<OrderApprovalAction, OrderStatus> = {
      [OrderApprovalAction.APPROVE]: OrderStatus.APPROVED,
      [OrderApprovalAction.REJECT]: OrderStatus.REJECTED,
      [OrderApprovalAction.RETURN_FOR_UPDATE]: OrderStatus.RETURNED_FOR_UPDATE,
    };
    order.status = statusByAction[action];
    if (action === OrderApprovalAction.APPROVE && !order.approvedAt) {
      order.approvedAt = new Date();
    }
    order.updatedAt = new Date();
  }

  private async saveDecision(
    client: PoolClient,
    order: OrderEntity,
    dto: DecideOrderDto,
    reviewer: ICurrentUser,
  ): Promise<void> {
    await client.query(
      `UPDATE app_order_records SET payload = $2::jsonb, updated_at = $3 WHERE id = $1`,
      [order.id, JSON.stringify(order), order.updatedAt],
    );
    await client.query(
      `INSERT INTO app_order_approval_history
       (order_id, action, comment, approver_id, approver_name, approver_roles)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        order.id,
        dto.action,
        dto.comment?.trim() || null,
        reviewer.userId,
        reviewer.username || reviewer.email || reviewer.userId,
        reviewer.roles,
      ],
    );
  }

  private async reserveOrderInventory(client: PoolClient, order: OrderEntity): Promise<void> {
    if (!this.productsService || !this.inventoryService) {
      throw new InternalServerErrorException('Dịch vụ tồn kho chưa được cấu hình.');
    }
    const linesBySku = this.groupOrderLinesBySku(order.lines);
    let warehouseId = DEFAULT_WAREHOUSE_ID;
    try {
      const warehouseRows = await client.query<{ warehouse_id: string }>(
        'SELECT warehouse_id FROM app_agency_default_warehouses WHERE agency_key = $1',
        [order.customerId],
      );
      if (warehouseRows.rows[0]?.warehouse_id) {
        warehouseId = warehouseRows.rows[0].warehouse_id;
      }
    } catch {
      // Fallback DEFAULT_WAREHOUSE_ID
    }
    for (const [sku, lines] of [...linesBySku.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sku]);
      const product = await this.productsService.findById(sku);
      const physicalQuantity = await this.inventoryService.getStockBalanceForUpdate(client, product, warehouseId);
      const reservationResult = await client.query<{ reserved: string }>(
        `SELECT COALESCE(SUM(base_quantity), 0)::text AS reserved
         FROM app_order_inventory_reservations
         WHERE product_sku = $1 AND warehouse_id = $2::uuid AND status = 'RESERVED'`,
        [sku, warehouseId],
      );
      const required = lines.reduce((sum, line) => sum + line.baseQuantity, 0);
      const available = physicalQuantity - Number(reservationResult.rows[0]?.reserved ?? 0);
      if (required > available) {
        throw new BadRequestException(
          `Sản phẩm ${product?.name || sku} không đủ tồn khả dụng để duyệt đơn: tồn khả dụng còn ${available}, đơn yêu cầu ${required}.`,
        );
      }
    }

    const expiredAt = new Date(Date.now() + RESERVATION_EXPIRY_HOURS * 60 * 60 * 1000);
    order.reservedUntil = expiredAt;
    order.approvedAt = new Date();

    for (const line of order.lines) {
      const resId = `res-${order.id}-${line.id}`;
      await client.query(
        `INSERT INTO stock_reservations
         (id, order_id, product_id, warehouse_id, quantity, status, expired_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET quantity = EXCLUDED.quantity, status = 'ACTIVE', expired_at = EXCLUDED.expired_at`,
        [resId, order.id, line.productSku.trim().toUpperCase(), warehouseId, line.baseQuantity, expiredAt],
      );

      await client.query(
        `INSERT INTO app_order_inventory_reservations
         (order_id, order_line_id, product_sku, warehouse_id, base_quantity)
         VALUES ($1, $2, $3, $4::uuid, $5)`,
        [order.id, line.id, line.productSku.trim().toUpperCase(), warehouseId, line.baseQuantity],
      );
    }
  }

  private groupOrderLinesBySku(lines: OrderLineEntity[]): Map<string, OrderLineEntity[]> {
    const grouped = new Map<string, OrderLineEntity[]>();
    for (const line of lines) {
      const sku = line.productSku.trim().toUpperCase();
      const skuLines = grouped.get(sku) ?? [];
      skuLines.push(line);
      grouped.set(sku, skuLines);
    }
    return grouped;
  }

  private async decideOrderInMemory(
    orderId: string,
    dto: DecideOrderDto,
    reviewer: ICurrentUser,
  ): Promise<OrderEntity> {
    const order = await this.findOrderById(orderId);
    this.ensureOrderCanBeDecided(order, dto.action);

    if (dto.action === OrderApprovalAction.APPROVE) {
      const linesBySku = this.groupOrderLinesBySku(order.lines);
      for (const [sku, lines] of linesBySku.entries()) {
        const product = this.productsService
          ? await this.productsService.findById(sku).catch(() => null)
          : null;
        const physicalQuantity = product ? (product.stockQuantity ?? 0) : 1000;
        const currentReserved = this.getReservedStock(sku, order.id);
        const available = physicalQuantity - currentReserved;
        const required = lines.reduce((sum, line) => sum + line.baseQuantity, 0);
        if (required > available) {
          throw new BadRequestException(
            `Sản phẩm ${product?.name || sku} không đủ tồn khả dụng để duyệt đơn: tồn khả dụng còn ${available}, đơn yêu cầu ${required}.`,
          );
        }
      }

      const expiredAt = new Date(Date.now() + RESERVATION_EXPIRY_HOURS * 60 * 60 * 1000);
      order.reservedUntil = expiredAt;
      order.approvedAt = new Date();
      order.approverId = reviewer.userId;

      for (const line of order.lines) {
        this.inventoryService?.addMemoryReservation(
          new StockReservationEntity({
            id: `res-${order.id}-${line.id}`,
            orderId: order.id,
            orderCode: order.orderCode,
            productId: line.productSku.trim().toUpperCase(),
            warehouseId: 'wh-main',
            quantity: line.baseQuantity,
            status: StockReservationStatus.ACTIVE,
            expiredAt,
            createdAt: new Date(),
          }),
        );
      }
    }

    this.applyApprovalDecision(order, dto.action);
    await this.saveOrder(order);

    if (dto.action === OrderApprovalAction.REJECT && order.grandTotal > 0 && order.customerId) {
      try {
        await this.customersService.adjustCustomerDebt(order.customerId, -order.grandTotal);
      } catch (err) {
        this.logger.warn(`Lỗi hoàn trả nợ khi từ chối đơn: ${err}`);
      }
    }
    const history = this.memoryApprovalHistory.get(orderId) ?? [];
    history.push(
      new OrderApprovalHistoryEntity({
        id: Date.now(),
        orderId,
        action: dto.action,
        comment: dto.comment?.trim() || null,
        approverId: reviewer.userId,
        approverName: reviewer.username || reviewer.email || reviewer.userId,
        approverRoles: reviewer.roles,
        createdAt: new Date(),
      }),
    );
    this.memoryApprovalHistory.set(orderId, history);
    return order;
  }

  /**
   * Cập nhật thông tin đơn hàng (đặc biệt là đơn nháp DRAFT để tiếp tục gõ)
   */
  async updateOrder(id: string, dto: UpdateOrderDto): Promise<OrderEntity> {
    return this.orderLock.acquire(async () => {
      const order = await this.findOrderById(id);

      if (dto.status !== undefined) {
        const canUpdateDraft =
          order.status === OrderStatus.DRAFT &&
          (dto.status === OrderStatus.DRAFT || dto.status === OrderStatus.PENDING);
        const canResubmitReturnedOrder =
          order.status === OrderStatus.RETURNED_FOR_UPDATE &&
          (dto.status === OrderStatus.DRAFT || dto.status === OrderStatus.PENDING);
        if (canUpdateDraft) {
          order.status = dto.status;
        } else if (canResubmitReturnedOrder) {
          // Keep returned orders pending until recalculated approval requirements are known.
          if (dto.status === OrderStatus.DRAFT) order.status = OrderStatus.DRAFT;
        } else {
          throw new BadRequestException(
            'Vui lòng cập nhật trạng thái qua chức năng duyệt đơn',
          );
        }
      }

      if (
        order.status !== OrderStatus.DRAFT &&
        order.status !== OrderStatus.PENDING &&
        order.status !== OrderStatus.RETURNED_FOR_UPDATE
      ) {
        throw new BadRequestException('Chỉ có thể chỉnh sửa đơn hàng ở trạng thái Nháp hoặc Chờ duyệt');
      }

      if (dto.customerId && dto.customerId !== order.customerId) {
        const customer = await this.customersService.getCustomerById(dto.customerId);

        if (customer.status === CustomerStatus.LOCKED) {
          throw new BadRequestException(
            `Đại lý "${customer.name}" đang bị KHÓA GIAO DỊCH (Lý do: ${customer.lockReason || 'Không có'}). Không thể đổi đơn hàng sang đại lý bị khóa!`,
          );
        }

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
        // API Validation Guard (SN-39): Kiểm tra số lượng đặt với tồn khả dụng (trừ đi đơn hiện tại)
        await this.validateOrderLinesAvailableStock(dto.lines, order.customerId, id);

        const pricing = this.resolveOrderPricing(
          dto.lines,
          order.customerGroup || '',
          dto.priceListId,
          order.customerId,
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

      await this.refreshApprovalState(order);
      if (order.status === OrderStatus.RETURNED_FOR_UPDATE) {
        order.status = order.requiresApproval ? OrderStatus.PENDING_APPROVAL : OrderStatus.PENDING;
      }
      order.updatedAt = new Date();
      await this.saveOrder(order);
      return this.checkAndAttachLockWarning(order);
    });
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
        OrderStatus.DISPATCHED,
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
    if (this.databaseService?.isConnected() && (dto.status === OrderStatus.DISPATCHED || dto.status === OrderStatus.SHIPPED)) {
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
    const previousStatus = order.status;
    order.status = dto.status;
    order.updatedAt = new Date();

    // Cập nhật các mốc thời gian thực tế theo quy trình SN-199
    if (dto.status === OrderStatus.PROCESSING) {
      if (!order.processingAt) order.processingAt = new Date();
    } else if (dto.status === OrderStatus.DISPATCHED) {
      if (!order.processingAt) order.processingAt = order.processingAt || new Date();
      if (!order.dispatchedAt) order.dispatchedAt = new Date();
      for (const line of order.lines) {
        if (line.dispatchedQuantity === undefined) {
          line.dispatchedQuantity = line.quantity;
        }
      }
    } else if (dto.status === OrderStatus.SHIPPED) {
      if (!order.processingAt) order.processingAt = order.processingAt || new Date();
      if (!order.dispatchedAt) order.dispatchedAt = order.dispatchedAt || new Date();
      if (!order.shippedAt) order.shippedAt = new Date();
      for (const line of order.lines) {
        if (line.dispatchedQuantity === undefined) {
          line.dispatchedQuantity = line.quantity;
        }
      }
    } else if (dto.status === OrderStatus.DELIVERED) {
      if (!order.processingAt) order.processingAt = order.processingAt || new Date();
      if (!order.dispatchedAt) order.dispatchedAt = order.dispatchedAt || new Date();
      if (!order.shippedAt) order.shippedAt = order.shippedAt || new Date();
      if (!order.deliveredAt) order.deliveredAt = new Date();
    }

    // Cập nhật thông tin giao vận & tài xế nếu có
    if (dto.carrierName) order.carrierName = dto.carrierName;
    if (dto.driverName) order.driverName = dto.driverName;
    if (dto.driverPhone) order.driverPhone = dto.driverPhone;
    if (dto.licensePlate) order.licensePlate = dto.licensePlate;
    if (dto.estimatedDeliveryWindow) order.estimatedDeliveryWindow = dto.estimatedDeliveryWindow;

    // Cập nhật số lượng thực tế giao nhận trên từng dòng nếu có dữ liệu xác nhận
    if (dto.lines && dto.lines.length > 0) {
      let hasShort = false;
      for (const lineDto of dto.lines) {
        const line = order.lines.find(
          (l) => (lineDto.lineId && l.id === lineDto.lineId) || (lineDto.productId && l.productId === lineDto.productId),
        );
        if (line) {
          if (lineDto.dispatchedQuantity !== undefined) {
            line.dispatchedQuantity = lineDto.dispatchedQuantity;
          }
          if (lineDto.deliveredQuantity !== undefined) {
            line.deliveredQuantity = lineDto.deliveredQuantity;
            line.isShortDelivery = lineDto.deliveredQuantity < line.quantity;
            if (line.isShortDelivery) {
              hasShort = true;
              line.shortDeliveryReason = lineDto.shortDeliveryReason || 'Giao thiếu hàng khi nhận tại kho';
            } else {
              line.shortDeliveryReason = undefined;
            }
          }
        }
      }
      order.isShortDelivery = hasShort || order.lines.some((l) => l.isShortDelivery);
    }
    if (this.databaseService?.isConnected() && dto.status === OrderStatus.CANCELLED) {
      await this.databaseService.query(
        `UPDATE app_order_inventory_reservations
         SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE order_id = $1 AND status = 'RESERVED'`,
        [order.id],
      );
    }

    // Hoàn trả công nợ khi hủy đơn
    if (
      dto.status === OrderStatus.CANCELLED &&
      previousStatus !== OrderStatus.CANCELLED &&
      order.grandTotal > 0 &&
      order.customerId
    ) {
      try {
        await this.customersService.adjustCustomerDebt(order.customerId, -order.grandTotal);
      } catch (debtErr) {
        this.logger.warn(`Lỗi hoàn trả nợ khi cập nhật trạng thái hủy đơn: ${debtErr}`);
      }
    }

    await this.saveOrder(order);
    return order;
  }

  private async refreshApprovalState(order: OrderEntity): Promise<void> {
    const debtStatus = await this.customersService.getCustomerDebtStatus(order.customerId);
    const projectedDebt = debtStatus.currentDebt + order.grandTotal;
    const isCreditLimitExceeded =
      debtStatus.creditLimit > 0 && projectedDebt > debtStatus.creditLimit;
    const creditLimitExceededAmount = isCreditLimitExceeded
      ? projectedDebt - debtStatus.creditLimit
      : 0;
    const priceFloorReasons = order.lines
      .filter((line) => line.requiresApproval)
      .map((line) =>
        `SKU ${line.productSku}: giá bán ${line.unitPrice.toLocaleString('vi-VN')} đ thấp hơn giá sàn ${line.minPrice?.toLocaleString('vi-VN')} đ`,
      );
    if (isCreditLimitExceeded) {
      priceFloorReasons.push(
        `Vượt hạn mức công nợ ${creditLimitExceededAmount.toLocaleString('vi-VN')} đ (công nợ dự kiến ${projectedDebt.toLocaleString('vi-VN')} đ / hạn mức ${debtStatus.creditLimit.toLocaleString('vi-VN')} đ)`,
      );
    }
    order.isCreditLimitExceeded = isCreditLimitExceeded;
    order.creditLimitExceededAmount = creditLimitExceededAmount;
    order.approvalReasons = priceFloorReasons;
    order.requiresApproval = priceFloorReasons.length > 0;
  }

  /**
   * Xóa đơn hàng (chỉ cho phép xóa đơn Nháp hoặc Đã hủy)
   */



  async deleteOrder(id: string): Promise<{ success: boolean; message: string }> {
    const order = await this.findOrderById(id);
    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Chỉ có thể xóa đơn hàng ở trạng thái Nháp hoặc Đã hủy');
    }
    if (this.databaseService?.isConnected()) {
      await this.databaseService.query('DELETE FROM app_order_records WHERE id = $1', [id]);
    } else {
      this.orders.delete(id);
    }
    return { success: true, message: 'Đã xóa đơn hàng thành công' };
  }

  /**
   * Sao chép một đơn cũ thành đơn mới (SN-48)
   * - Sao chép toàn bộ dòng hàng của đơn đã chọn
   * - Giá và chiết khấu được áp lại theo bảng giá hiện hành, không kế thừa giá cũ
   * - Bản sao luôn bắt đầu ở trạng thái Nháp (DRAFT)
   */
  async cloneOrder(
    id: string,
    salesRep?: { id?: string; name?: string },
  ): Promise<OrderEntity> {
    const sourceOrder = await this.findOrderById(id);

    // Sao chép toàn bộ dòng hàng, nhưng KHÔNG truyền unitPrice / listPrice / discountPercent
    // để createOrder tự động tính lại theo bảng giá và chính sách chiết khấu hiện hành
    const linesDto: CreateOrderLineDto[] = sourceOrder.lines.map((line) => ({
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      unit: line.unit,
      baseUnit: line.baseUnit || line.unit,
      conversionRate: line.conversionRate,
      quantity: line.quantity,
    }));

    const createDto: CreateOrderDto = {
      customerId: sourceOrder.customerId,
      deliveryPoint: sourceOrder.deliveryPoint
        ? {
            id: sourceOrder.deliveryPoint.id,
            address: sourceOrder.deliveryPoint.address,
            name: sourceOrder.deliveryPoint.name,
            receiverName: sourceOrder.deliveryPoint.receiverName,
            phone: sourceOrder.deliveryPoint.phone,
            roadNote: sourceOrder.deliveryPoint.roadNote,
          }
        : undefined,
      deliveryDate: sourceOrder.deliveryDate,
      lines: linesDto,
      note: sourceOrder.note
        ? `[Bản sao từ ${sourceOrder.orderCode}] ${sourceOrder.note}`
        : `Bản sao từ ${sourceOrder.orderCode}`,
      status: OrderStatus.DRAFT,
    };

    return this.createOrder(
      createDto,
      salesRep || { id: sourceOrder.salesRepId, name: sourceOrder.salesRepName },
    );
  }


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

    const orderCustNorm = order.customerId?.replace('cust-dl-', 'cust-');
    const paramCustNorm = customerId?.replace('cust-dl-', 'cust-');
    if (customerId && order.customerId !== customerId && orderCustNorm !== paramCustNorm) {
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
      let inactiveReason = 'Mặt hàng đã ngừng kinh doanh và được loại khỏi đơn mới';

      // 1. Kiểm tra trạng thái sản phẩm qua ProductsService
      if (this.productsService) {
        try {
          const product = await this.productsService.findById(line.productSku || line.productId);
          if (product && product.status === ProductStatus.INACTIVE) {
            isInactive = true;
            inactiveReason = 'Mặt hàng đã chuyển trạng thái ngừng kinh doanh';
          }
        } catch (err) {
          if (err instanceof NotFoundException) {
            isInactive = true;
            inactiveReason = 'Sản phẩm đã ngừng kinh doanh hoặc không còn tồn tại trong hệ thống';
          }
        }
      }

      if (isInactive) {
        discontinuedItems.push({
          lineId: line.id,
          productSku: line.productSku,
          productName: line.productName,
          reason: inactiveReason,
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

  /**
   * Phân quyền truy cập thông tin đại lý:
   * - SALES_REP: Chỉ được xem lịch sử mua hàng của đại lý mình phụ trách (AC4)
   * - ADMIN & SALES_MANAGER: Toàn quyền truy cập mọi đại lý
   */
  private verifyCustomerAccess(
    customer: CustomerEntity,
    currentUser?: ICurrentUser,
  ): void {
    if (!currentUser) return;

    const roles: UserRole[] = currentUser.roles || [];
    const isSalesRep = roles.includes(UserRole.SALES_REP);
    const isManagerOrAdmin =
      roles.includes(UserRole.ADMIN) ||
      roles.includes(UserRole.SALES_MANAGER) ||
      (roles as string[]).includes('BUSINESS_MANAGER');

    if (isSalesRep && !isManagerOrAdmin) {
      const repId = currentUser.userId;
      const customerRepId = customer.salesRepId || customer.salesRep?.id;

      const isAssigned =
        customerRepId === repId ||
        (repId === 'usr-sale-01' && (customerRepId === 'usr-sales-002' || customerRepId === 'usr-sale-01')) ||
        (repId === 'usr-sales-002' && (customerRepId === 'usr-sale-01' || customerRepId === 'usr-sales-002')) ||
        (repId === 'usr-sale-02' && customerRepId === 'usr-sale-02');

      if (!isAssigned) {
        throw new ForbiddenException('Bạn không có quyền xem thông tin của đại lý này');
      }
    }
  }

  /**
   * Lấy gợi ý mặt hàng dựa trên lịch sử mua hàng 3 tháng gần nhất (SN-43 AC1)
   */
  async getPurchaseHistorySuggestions(
    customerId: string,
    currentUser?: ICurrentUser,
  ): Promise<CustomerPurchaseHistoryResponse> {
    const customer = await this.customersService.getCustomerById(customerId);
    this.verifyCustomerAccess(customer, currentUser);

    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setMonth(cutoffDate.getMonth() - LOOKBACK_MONTHS);

    const validStatuses = new Set<OrderStatus>([
      OrderStatus.PENDING,
      OrderStatus.PENDING_APPROVAL,
      OrderStatus.PENDING_INVENTORY_APPROVAL,
      OrderStatus.APPROVED,
      OrderStatus.PROCESSING,
      OrderStatus.DISPATCHED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ]);

    const customerOrders = Array.from(this.orders.values()).filter((order) => {
      const matchesCustomer =
        order.customerId === customer.id ||
        order.customerCode === customer.code ||
        order.customerId === customerId ||
        order.customerCode === customerId;
      return matchesCustomer && validStatuses.has(order.status);
    });

    customerOrders.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const latestOrder = customerOrders.length > 0 ? this.mapToLatestOrderSummary(customerOrders[0]) : null;

    const recentOrders = customerOrders.filter((order) => {
      const orderDate = new Date(order.createdAt);
      return orderDate >= cutoffDate;
    });

    const groupedItems = new Map<
      string,
      {
        productId: string;
        sku: string;
        productName: string;
        unit: string;
        baseUnit: string;
        conversionRate: number;
        price: number;
        totalQuantity: number;
        orderCount: number;
        lastPurchasedAt: Date;
        lastPurchasedQuantity: number;
      }
    >();

    for (const order of recentOrders) {
      if (!order.lines) continue;
      const orderDate = new Date(order.createdAt);

      for (const line of order.lines) {
        const itemKey = line.productSku?.toUpperCase() || line.productId;
        if (!itemKey) continue;

        const existing = groupedItems.get(itemKey);
        if (!existing) {
          groupedItems.set(itemKey, {
            productId: line.productId,
            sku: line.productSku || line.productId,
            productName: line.productName,
            unit: line.unit || line.baseUnit || 'Đơn vị',
            baseUnit: line.baseUnit || line.unit || 'Đơn vị',
            conversionRate: line.conversionRate || 1,
            price: line.unitPrice || line.listPrice || 0,
            totalQuantity: line.quantity,
            orderCount: 1,
            lastPurchasedAt: orderDate,
            lastPurchasedQuantity: line.quantity,
          });
        } else {
          existing.totalQuantity += line.quantity;
          existing.orderCount += 1;
          if (orderDate > existing.lastPurchasedAt) {
            existing.lastPurchasedAt = orderDate;
            existing.lastPurchasedQuantity = line.quantity;
            existing.price = line.unitPrice || line.listPrice || existing.price;
          }
        }
      }
    }

    const suggestions: SuggestedProductItem[] = Array.from(groupedItems.values())
      .map((item) => ({
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        unit: item.unit,
        baseUnit: item.baseUnit,
        conversionRate: item.conversionRate,
        price: item.price,
        totalQuantity: item.totalQuantity,
        orderCount: item.orderCount,
        averageQuantity: Math.max(1, Math.round(item.totalQuantity / item.orderCount)),
        lastPurchasedAt: item.lastPurchasedAt.toISOString(),
        lastPurchasedQuantity: item.lastPurchasedQuantity,
      }))
      .sort((a, b) => {
        if (b.orderCount !== a.orderCount) {
          return b.orderCount - a.orderCount;
        }
        return new Date(b.lastPurchasedAt).getTime() - new Date(a.lastPurchasedAt).getTime();
      });

    return {
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      lookbackMonths: LOOKBACK_MONTHS,
      totalOrdersInPeriod: recentOrders.length,
      suggestions,
      latestOrder,
    };
  }

  /**
   * Lấy chi tiết đơn hàng thành công gần nhất của đại lý (SN-43 AC2)
   */
  async getLatestCustomerOrder(
    customerId: string,
    currentUser?: ICurrentUser,
  ): Promise<LatestOrderSummary | null> {
    const customer = await this.customersService.getCustomerById(customerId);
    this.verifyCustomerAccess(customer, currentUser);

    const validStatuses = new Set<OrderStatus>([
      OrderStatus.PENDING,
      OrderStatus.PENDING_APPROVAL,
      OrderStatus.PENDING_INVENTORY_APPROVAL,
      OrderStatus.APPROVED,
      OrderStatus.PROCESSING,
      OrderStatus.DISPATCHED,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ]);

    const customerOrders = Array.from(this.orders.values())
      .filter((order) => {
        const matchesCustomer =
          order.customerId === customer.id ||
          order.customerCode === customer.code ||
          order.customerId === customerId ||
          order.customerCode === customerId;
        return matchesCustomer && validStatuses.has(order.status);
      })
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    if (customerOrders.length === 0) {
      return null;
    }

    return this.mapToLatestOrderSummary(customerOrders[0]);
  }

  private mapToLatestOrderSummary(order: OrderEntity): LatestOrderSummary {
    const items: LatestOrderItem[] = (order.lines || []).map((line) => ({
      productId: line.productId,
      sku: line.productSku || line.productId,
      productName: line.productName,
      unit: line.unit || line.baseUnit || 'Đơn vị',
      baseUnit: line.baseUnit || line.unit || 'Đơn vị',
      conversionRate: line.conversionRate || 1,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      listPrice: line.listPrice || line.unitPrice,
      discountPercent: line.discountPercent || 0,
      lineTotal: line.lineTotal,
    }));

    return {
      orderId: order.id,
      orderCode: order.orderCode,
      customerId: order.customerId,
      customerName: order.customerName,
      deliveryDate: order.deliveryDate,
      status: order.status,
      subtotal: order.subtotal,
      totalDiscount: order.totalDiscount,
      grandTotal: order.grandTotal,
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : String(order.createdAt),
      note: order.note,
      items,
    };
  }
}
