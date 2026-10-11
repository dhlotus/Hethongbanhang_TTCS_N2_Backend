import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { StockReservationEntity, StockReservationStatus } from './entities/stock-reservation.entity';
import { DatabaseService } from '../../database/database.service';
import type { PoolClient } from 'pg';
import type { ProductEntity } from '../products/entities/product.entity';
import type { LowStockAlert, StockBalance } from './entities/stock-balance.entity';
import { InventoryAuditEntity, InventoryAuditItemEntity } from './entities/inventory-audit.entity';
import { InventoryAuditStatus } from './entities/inventory-audit-status.enum';
import { CreateInventoryAuditDto, UpdateAuditItemsDto, CompleteAuditDto, QueryAuditsDto } from './dto';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { DEFAULT_WAREHOUSE_ID } from '../warehouses/warehouse.constants';

const DEFAULT_WAREHOUSE_NAME = 'Kho Tổng Miền Nam';

export interface StockAdjustmentResult {
  success: boolean;
  message: string;
  sku: string;
  productName: string;
  inputQuantity: number;
  inputUnit: string;
  unitName?: string;
  conversionRate: number;
  conversionFactor?: number;
  baseQuantityChange: number;
  baseUnit: string;
  previousQuantity: number;
  newQuantity: number;
  quantityChange: number;
  reason: string;
  referenceCode: string;
  adjustedBy: string;
  timestamp: string;
}

@Injectable()
export class InventoryService implements OnModuleInit {
  /**
   * Fix #4: Sổ kho tập trung theo Map<productId, giao dịch[]>.
   * - Lookup O(1) theo productId thay vì O(n) full-scan mảng phẳng.
   * - Tránh race write vào cùng một vùng nhớ khi nhiều request song song
   *   cho các SKU khác nhau (mỗi SKU có bucket riêng).
   */
  private ledger = new Map<string, InventoryTransactionEntity[]>();
  private audits = new Map<string, InventoryAuditEntity>();

  /**
   * Fix #2: Per-product Promise mutex lock.
   * - Khi request A đang trong critical section (kiểm tra tồn + cập nhật) của SKU X,
   *   request B sẽ await Promise trước khi được phép vào.
   * - Đảm bảo hai bước "kiểm tra tồn" & "cập nhật tồn" là NGUYÊN TỬ với nhau.
   * - Không ảnh hưởng throughput cho các SKU khác (lock độc lập theo productId).
   */
  private locks = new Map<string, Promise<void>>();
  private stockBalanceSchemaPromise: Promise<void> | null = null;
  /** Fallback in-memory: Map<SKU viết hoa, mức tồn tối thiểu> (dùng khi không có PostgreSQL) */
  private minStockLevels = new Map<string, number>();
  private readonly databaseService: DatabaseService;

  private memoryStockReservations = new Map<string, StockReservationEntity>();
  private stockReservationSchemaPromise: Promise<void> | null = null;

  constructor(
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    @Optional()
    databaseService?: DatabaseService,
  ) {
    this.databaseService = databaseService || new DatabaseService();
  }

  async onModuleInit(): Promise<void> {
    if (this.ledger.size === 0) {
      this.seedInitialTransactions();
    }
    if (this.audits.size === 0) {
      this.seedInitialAudits();
    }
    if (this.databaseService?.isConnected()) {
      await this.ensureStockBalanceTable();
      await this.ensureStockReservationsTable();
      await this.seedStockBalances();
    }
  }

  async ensureStockReservationsTable(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    if (!this.stockReservationSchemaPromise) {
      this.stockReservationSchemaPromise = this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS stock_reservations (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          warehouse_id TEXT NOT NULL DEFAULT 'wh-main',
          quantity NUMERIC(15, 2) NOT NULL CHECK (quantity > 0),
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED', 'FULFILLED', 'RESERVED')),
          expired_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          released_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_stock_reservations_order ON stock_reservations(order_id);
        CREATE INDEX IF NOT EXISTS idx_stock_reservations_status_expired ON stock_reservations(status, expired_at) WHERE status = 'ACTIVE' OR status = 'RESERVED';
        CREATE INDEX IF NOT EXISTS idx_stock_reservations_product ON stock_reservations(product_id) WHERE status = 'ACTIVE' OR status = 'RESERVED';
      `).then(() => undefined).catch((error: unknown) => {
        this.stockReservationSchemaPromise = null;
        throw error;
      });
    }
    await this.stockReservationSchemaPromise;
  }

  async ensureStockBalanceTable(): Promise<void> {
    if (!this.stockBalanceSchemaPromise) {
      this.stockBalanceSchemaPromise = this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS app_inventory_stock_balances (
          product_sku TEXT NOT NULL,
          warehouse_id UUID NOT NULL DEFAULT '${DEFAULT_WAREHOUSE_ID}',
          physical_quantity NUMERIC(15, 2) NOT NULL CHECK (physical_quantity >= 0),
          min_stock_level NUMERIC(15, 2) DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (product_sku, warehouse_id)
        )
      `).then(() => this.databaseService.query(`
        ALTER TABLE app_inventory_stock_balances
        ADD COLUMN IF NOT EXISTS min_stock_level NUMERIC(15, 2) DEFAULT 0
      `)).then(() => undefined).catch((error: unknown) => {
        this.stockBalanceSchemaPromise = null;
        throw error;
      });
    }
    await this.stockBalanceSchemaPromise;
  }

  private async seedStockBalances(): Promise<void> {
    const products = await this.productsService.findAll();
    if (products.length === 0) return;
    await this.databaseService.query(
      `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity)
       SELECT UPPER(sku), $3::uuid, quantity
       FROM UNNEST($1::text[], $2::numeric[]) AS seed(sku, quantity)
       ON CONFLICT (product_sku, warehouse_id) DO NOTHING`,
      [products.map((product) => product.sku), products.map((product) => product.stockQuantity), DEFAULT_WAREHOUSE_ID],
    );
  }

  private async getStockBalances(products: ProductEntity[], warehouseId: string): Promise<Map<string, number>> {
    await this.ensureStockBalanceTable();
    if (products.length === 0) return new Map();
    await this.databaseService.query(
      `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity)
       SELECT UPPER(sku), $3::uuid, quantity
       FROM UNNEST($1::text[], $2::numeric[]) AS seed(sku, quantity)
       ON CONFLICT (product_sku, warehouse_id) DO NOTHING`,
      [products.map((product) => product.sku), products.map((product) => warehouseId === DEFAULT_WAREHOUSE_ID ? product.stockQuantity : 0), warehouseId],
    );
    const rows = await this.databaseService.query<{ product_sku: string; physical_quantity: string }>(
      `SELECT product_sku, physical_quantity::text
       FROM app_inventory_stock_balances
       WHERE product_sku = ANY($1::text[]) AND warehouse_id = $2::uuid`,
      [products.map((product) => product.sku.toUpperCase()), warehouseId],
    );
    return new Map(rows.map((row) => [row.product_sku, Number(row.physical_quantity)]));
  }

  async getStockBalanceForUpdate(
    client: PoolClient,
    product: ProductEntity,
    warehouseId: string = DEFAULT_WAREHOUSE_ID,
  ): Promise<number> {
    await this.ensureStockBalanceTable();
    const sku = product.sku.trim().toUpperCase();
    await client.query(
      `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity)
       VALUES ($1, $2::uuid, $3) ON CONFLICT (product_sku, warehouse_id) DO NOTHING`,
      [sku, warehouseId, warehouseId === DEFAULT_WAREHOUSE_ID ? product.stockQuantity : 0],
    );
    const result = await client.query<{ physical_quantity: string }>(
      `SELECT physical_quantity::text FROM app_inventory_stock_balances
       WHERE product_sku = $1 AND warehouse_id = $2::uuid FOR UPDATE`,
      [sku, warehouseId],
    );
    return Number(result.rows[0]?.physical_quantity ?? 0);
  }

  async updateStockBalance(
    client: PoolClient,
    sku: string,
    physicalQuantity: number,
    warehouseId: string = DEFAULT_WAREHOUSE_ID,
  ): Promise<void> {
    await client.query(
      `UPDATE app_inventory_stock_balances
       SET physical_quantity = $2, updated_at = CURRENT_TIMESTAMP
       WHERE product_sku = $1 AND warehouse_id = $3::uuid`,
      [sku.trim().toUpperCase(), physicalQuantity, warehouseId],
    );
  }

  /**
   * Helper: ghi một giao dịch vào sổ ledger (theo productId bucket)
   */
  private writeLedger(tx: InventoryTransactionEntity): void {
    const bucket = this.ledger.get(tx.productId) ?? [];
    bucket.unshift(tx); // mới nhất lên đầu
    this.ledger.set(tx.productId, bucket);
  }

  /**
   * Helper: acquire per-product mutex lock, trả về hàm release.
   * Đây là pattern "mutex chain" thuần Promise — không cần thư viện ngoài.
   */
  private async acquireLock(productId: string): Promise<() => void> {
    // Chờ lock hiện tại (nếu có) resolve trước
    const previous = this.locks.get(productId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Thay thế lock bằng promise mới — request tiếp theo sẽ chờ `next`
    this.locks.set(productId, previous.then(() => next));
    await previous;
    return release;
  }

  /**
   * Khởi tạo một số giao dịch sổ kho mẫu lưu vết quy đổi (SN-23)
   */
  private seedInitialTransactions(): void {
    const now = Date.now();

    const seedTx1 = new InventoryTransactionEntity({
      id: 'tx-seed-001',
      productId: 'prod-001',
      sku: 'LH-MILK-900G',
      productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
      transactionType: 'IMPORT',
      inputQuantity: 10,
      inputUnit: 'Thùng',
      conversionRate: 24, // Snapshot: 1 Thùng = 24 Lon
      baseQuantityChange: 240, // 10 * 24 = 240 Lon
      baseUnit: 'Lon',
      previousStock: 100,
      newStock: 340,
      reason: 'Nhập lô hàng mới từ Nhà máy Dược Loha',
      referenceCode: 'PNK-2026-0891',
      warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
      performedBy: 'usr-wh-keeper',
      createdAt: new Date(now - 86400000 * 2),
    });

    const seedTx2 = new InventoryTransactionEntity({
      id: 'tx-seed-002',
      productId: 'prod-002',
      sku: 'LH-NUT-180ML',
      productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
      transactionType: 'IMPORT',
      inputQuantity: 25,
      inputUnit: 'Thùng',
      conversionRate: 48, // Snapshot: 1 Thùng = 48 Hộp
      baseQuantityChange: 1200, // 25 * 48 = 1200 Hộp
      baseUnit: 'Hộp',
      previousStock: 0,
      newStock: 1200,
      reason: 'Nhập kho thành phẩm theo lệnh sản xuất #LSX-1102',
      referenceCode: 'PNK-2026-0892',
      warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
      performedBy: 'usr-wh-keeper',
      createdAt: new Date(now - 86400000),
    });

    this.writeLedger(seedTx1);
    this.writeLedger(seedTx2);
  }

  /**
   * Xem tồn kho khả dụng của danh mục sản phẩm kèm 3 cột (Thực tế, Đang giữ chỗ, Khả dụng) và đơn vị quy đổi (SN-180)
   */
  async getStockOverview(warehouseId: string = DEFAULT_WAREHOUSE_ID): Promise<StockBalance[]> {
    const products = await this.productsService.findAll();
    let physicalBalances = new Map<string, number>();
    const reservations = new Map<string, number>();
    const reservationsListBySku = new Map<
      string,
      Array<{
        id: string;
        orderId: string;
        orderCode?: string;
        customerName?: string;
        orderStatus?: string;
        quantity: number;
        expiredAt: string;
        createdAt: string;
      }>
    >();
    let minLevels = new Map<string, number>();
    let warehouseName = DEFAULT_WAREHOUSE_NAME;

    if (this.databaseService?.isConnected()) {
      await this.ensureStockReservationsTable();
      physicalBalances = await this.getStockBalances(products, warehouseId);
      minLevels = await this.getMinStockLevelsFromDb(products, warehouseId);
      try {
        const warehouseRows = await this.databaseService.query<{ name: string }>(
          'SELECT name FROM warehouses WHERE id = $1::uuid',
          [warehouseId],
        );
        if (warehouseRows[0]?.name) warehouseName = warehouseRows[0].name;
      } catch {
        // Ignore
      }

      try {
        const resRows = await this.databaseService.query<{
          id: string;
          order_id: string;
          product_id: string;
          quantity: string;
          expired_at: string;
          created_at: string;
          order_code?: string;
          customer_name?: string;
          order_status?: string;
        }>(
          `SELECT r.id, r.order_id, r.product_id, r.quantity::text,
                  r.expired_at::text, r.created_at::text,
                  COALESCE(o.order_code, o.id, r.order_id) as order_code,
                  COALESCE(o.payload->>'customerName', '') as customer_name,
                  COALESCE(o.payload->>'status', 'APPROVED') as order_status
           FROM stock_reservations r
           LEFT JOIN app_order_records o ON (o.id = r.order_id OR o.order_code = r.order_id)
           WHERE r.status IN ('ACTIVE', 'RESERVED') AND r.expired_at > CURRENT_TIMESTAMP`,
        );

        const addReservationToSku = (key: string, item: {
          id: string;
          orderId: string;
          orderCode?: string;
          customerName?: string;
          orderStatus?: string;
          quantity: number;
          expiredAt: string;
          createdAt: string;
        }) => {
          const upper = key.toUpperCase();
          const targetKeys = [upper];
          if (upper === 'LH-MILK-900G') targetKeys.push('LH-MILK-POWDER-900G');
          if (upper === 'LH-MILK-POWDER-900G') targetKeys.push('LH-MILK-900G');

          for (const k of targetKeys) {
            reservations.set(k, (reservations.get(k) || 0) + item.quantity);
            const list = reservationsListBySku.get(k) || [];
            if (!list.some((existing) => existing.id === item.id)) {
              list.push(item);
            }
            reservationsListBySku.set(k, list);
          }
        };

        for (const row of resRows) {
          const qty = Number(row.quantity) || 0;
          addReservationToSku(row.product_id, {
            id: row.id,
            orderId: row.order_id,
            orderCode: row.order_code || row.order_id,
            customerName: row.customer_name,
            orderStatus: row.order_status || 'APPROVED',
            quantity: qty,
            expiredAt: row.expired_at,
            createdAt: row.created_at,
          });
        }

        // Bổ sung các đơn hàng APPROVED/PROCESSING từ app_order_records nếu chưa có trong stock_reservations
        const activeOrderRows = await this.databaseService.query<{
          id: string;
          order_code: string;
          order_status: string;
          customer_name: string;
          lines: Array<{
            id?: string;
            productId?: string;
            productSku?: string;
            quantity?: number;
            baseQuantity?: number;
          }>;
          reserved_until?: string;
          created_at: string;
        }>(
          `SELECT id, order_code,
                  COALESCE(payload->>'status', 'APPROVED') as order_status,
                  COALESCE(payload->>'customerName', '') as customer_name,
                  COALESCE(payload->'lines', '[]'::jsonb) as lines,
                  payload->>'reservedUntil' as reserved_until,
                  created_at::text
           FROM app_order_records
           WHERE payload->>'status' IN ('APPROVED', 'PROCESSING')`,
        );

        const reservedOrderIds = new Set(resRows.map((r) => r.order_id));
        for (const order of activeOrderRows) {
          if (reservedOrderIds.has(order.id) || reservedOrderIds.has(order.order_code)) {
            continue;
          }
          const lines = Array.isArray(order.lines) ? order.lines : [];
          for (const line of lines) {
            const lineSku = line.productSku || line.productId;
            if (!lineSku) continue;
            const lineQty = Number(line.baseQuantity ?? line.quantity) || 0;
            if (lineQty <= 0) continue;

            addReservationToSku(lineSku, {
              id: `res-ord-${order.id}-${line.id || lineSku}`,
              orderId: order.id,
              orderCode: order.order_code || order.id,
              customerName: order.customer_name,
              orderStatus: order.order_status,
              quantity: lineQty,
              expiredAt: order.reserved_until || new Date(new Date(order.created_at).getTime() + 24 * 3600 * 1000).toISOString(),
              createdAt: order.created_at,
            });
          }
        }
      } catch {
        // Fallback to app_order_inventory_reservations if needed
        try {
          const legacyRows = await this.databaseService.query<{ product_sku: string; reserved: string; order_id?: string }>(
            `SELECT product_sku, COALESCE(SUM(base_quantity), 0)::text AS reserved, MAX(order_id) as order_id
             FROM app_order_inventory_reservations WHERE status = 'RESERVED' GROUP BY product_sku`,
          );
          for (const row of legacyRows) {
            const qty = Number(row.reserved) || 0;
            const targetKeys = [row.product_sku.toUpperCase()];
            if (row.product_sku.toUpperCase() === 'LH-MILK-900G') targetKeys.push('LH-MILK-POWDER-900G');
            if (row.product_sku.toUpperCase() === 'LH-MILK-POWDER-900G') targetKeys.push('LH-MILK-900G');

            for (const k of targetKeys) {
              reservations.set(k, (reservations.get(k) || 0) + qty);
              if (row.order_id) {
                const list = reservationsListBySku.get(k) || [];
                list.push({
                  id: `res-leg-${row.order_id}-${k}`,
                  orderId: row.order_id,
                  orderCode: row.order_id,
                  quantity: qty,
                  expiredAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
                  createdAt: new Date().toISOString(),
                });
                reservationsListBySku.set(k, list);
              }
            }
          }
        } catch {
          // Ignore
        }
      }
    } else {
      // In-memory fallback
      for (const res of this.memoryStockReservations.values()) {
        if (res.status === StockReservationStatus.ACTIVE && new Date(res.expiredAt) > new Date()) {
          const skuKey = res.productId.toUpperCase();
          const targetKeys = [skuKey];
          if (skuKey === 'LH-MILK-900G') targetKeys.push('LH-MILK-POWDER-900G');
          if (skuKey === 'LH-MILK-POWDER-900G') targetKeys.push('LH-MILK-900G');

          for (const k of targetKeys) {
            reservations.set(k, (reservations.get(k) || 0) + res.quantity);
            const list = reservationsListBySku.get(k) || [];
            if (!list.some((existing) => existing.id === res.id)) {
              list.push({
                id: res.id,
                orderId: res.orderId,
                orderCode: res.orderCode || res.orderId,
                quantity: res.quantity,
                expiredAt: res.expiredAt instanceof Date ? res.expiredAt.toISOString() : String(res.expiredAt),
                createdAt: res.createdAt instanceof Date ? res.createdAt.toISOString() : String(res.createdAt),
              });
            }
            reservationsListBySku.set(k, list);
          }
        }
      }
    }

    return products.map((p) => {
      const pSkuUpper = p.sku.toUpperCase();
      const aliasSku = pSkuUpper === 'LH-MILK-POWDER-900G' ? 'LH-MILK-900G' : pSkuUpper === 'LH-MILK-900G' ? 'LH-MILK-POWDER-900G' : '';
      const physicalStockQuantity = physicalBalances.get(pSkuUpper) ?? (aliasSku ? physicalBalances.get(aliasSku) : undefined) ?? p.stockQuantity ?? 0;
      const dbReserved = reservations.get(pSkuUpper) ?? (aliasSku ? reservations.get(aliasSku) : undefined) ?? 0;
      const orderReserved = p.reservedStock ?? 0;
      const reservedQuantity = Math.max(dbReserved, orderReserved);
      const available = Math.max(0, physicalStockQuantity - reservedQuantity);
      const matchedReservations = reservationsListBySku.get(pSkuUpper) || (aliasSku ? reservationsListBySku.get(aliasSku) : []) || [];

      return this.buildStockBalance(
        {
          sku: p.sku,
          productId: p.id,
          name: p.name,
          productName: p.name,
          stockQuantity: available,
          physicalStockQuantity,
          physicalQuantity: physicalStockQuantity,
          reservedQuantity,
          availableQuantity: available,
          baseUnit: p.baseUnit,
          units: (p.units || []).map((u) => ({
            unitName: u.unitName,
            conversionRate: u.conversionRate,
            isBaseUnit: u.isBaseUnit,
          })),
          activeReservations: matchedReservations,
        },
        minLevels.get(p.sku.trim().toUpperCase()) ?? (this.minStockLevels.get(p.sku.trim().toUpperCase()) ?? 0),
        warehouseId,
        warehouseName,
      );
    });
  }

  /**
   * Gắn mức tồn tối thiểu và tính cờ cảnh báo cho một dòng sổ tồn (SN-183).
   */
  private buildStockBalance(
    base: Omit<StockBalance, 'warehouse' | 'warehouseId' | 'minStockLevel' | 'isBelowMinStock'>,
    minStockLevel: number,
    warehouseId: string = DEFAULT_WAREHOUSE_ID,
    warehouseName: string = DEFAULT_WAREHOUSE_NAME,
  ): StockBalance {
    return {
      ...base,
      warehouse: warehouseName,
      warehouseId,
      minStockLevel,
      isBelowMinStock: minStockLevel > 0 && base.stockQuantity <= minStockLevel,
    };
  }

  private async getMinStockLevelsFromDb(products: ProductEntity[], warehouseId: string): Promise<Map<string, number>> {
    await this.ensureStockBalanceTable();
    if (products.length === 0) return new Map();
    const rows = await this.databaseService.query<{ product_sku: string; min_stock_level: string | null }>(
      `SELECT product_sku, COALESCE(min_stock_level, 0)::text AS min_stock_level
       FROM app_inventory_stock_balances
       WHERE product_sku = ANY($1::text[]) AND warehouse_id = $2::uuid`,
      [products.map((product) => product.sku.trim().toUpperCase()), warehouseId],
    );
    return new Map(rows.map((row) => [row.product_sku, Number(row.min_stock_level ?? 0)]));
  }

  /**
   * Khai báo mức tồn tối thiểu theo SKU tại kho (SN-183).
   * Hệ thống hiện vận hành một kho (WH01) nên warehouseId chỉ được kiểm tra không rỗng.
   */
  async setMinStockLevel(
    warehouseId: string,
    sku: string,
    minStock: number,
  ): Promise<StockBalance> {
    if (!warehouseId?.trim()) {
      throw new BadRequestException('Thiếu mã kho.');
    }
    const level = Number(minStock);
    if (!Number.isFinite(level) || level < 0) {
      throw new BadRequestException('Mức tồn tối thiểu phải là số không âm.');
    }
    const cleanSku = sku.trim().toUpperCase();
    const product = await this.productsService.findById(cleanSku);
    const productSku = product.sku.trim().toUpperCase();

    if (this.databaseService.isConnected()) {
      await this.ensureStockBalanceTable();
      await this.databaseService.query(
        `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity, min_stock_level)
         VALUES ($1, $4::uuid, $2, $3)
         ON CONFLICT (product_sku, warehouse_id)
         DO UPDATE SET min_stock_level = EXCLUDED.min_stock_level, updated_at = CURRENT_TIMESTAMP`,
        [productSku, warehouseId === DEFAULT_WAREHOUSE_ID ? product.stockQuantity ?? 0 : 0, level, warehouseId],
      );
    }
    this.minStockLevels.set(productSku, level);

    const balances = await this.getStockOverview(warehouseId);
    const updated = balances.find((row) => row.sku.trim().toUpperCase() === productSku);
    if (!updated) {
      throw new BadRequestException(`Không tìm thấy SKU ${sku}.`);
    }
    return updated;
  }

  /**
   * Danh sách SKU có tồn khả dụng <= tồn tối thiểu (> 0); hụt nhiều nhất lên đầu (SN-183).
   */
  async getLowStockAlerts(warehouseId?: string): Promise<LowStockAlert[]> {
    const balances = await this.getStockOverview();
    const targetWarehouse = warehouseId?.trim().toUpperCase();
    return balances
      .filter((row) => !targetWarehouse || (row.warehouseId && row.warehouseId.toUpperCase() === targetWarehouse))
      .filter((row) => (row.minStockLevel ?? 0) > 0 && row.stockQuantity <= (row.minStockLevel ?? 0))
      .map((row): LowStockAlert => {
        const minStockLevel = row.minStockLevel ?? 0;
        return {
          ...row,
          minStockLevel,
          isBelowMinStock: true,
          shortage: minStockLevel - row.stockQuantity,
        };
      })
      .sort((a, b) => b.shortage - a.shortage);
  }

  /**
   * Lấy danh sách phiếu giữ chỗ kho đang hoạt động (SN-180)
   */
  async getActiveReservations(
    sku?: string,
    orderId?: string,
  ): Promise<StockReservationEntity[]> {
    if (this.databaseService?.isConnected()) {
      await this.ensureStockReservationsTable();
      let query = `
        SELECT r.id, r.order_id, r.product_id, r.warehouse_id, r.quantity::text,
               r.status, r.expired_at, r.created_at, r.released_at, o.order_code
        FROM stock_reservations r
        LEFT JOIN app_order_records o ON o.id = r.order_id
        WHERE r.status IN ('ACTIVE', 'RESERVED')
      `;
      const params: unknown[] = [];
      if (sku) {
        params.push(sku.toUpperCase());
        query += ` AND UPPER(r.product_id) = $${params.length}`;
      }
      if (orderId) {
        params.push(orderId);
        query += ` AND r.order_id = $${params.length}`;
      }
      query += ` ORDER BY r.created_at DESC`;
      const rows = await this.databaseService.query<{
        id: string;
        order_id: string;
        product_id: string;
        warehouse_id: string;
        quantity: string;
        status: string;
        expired_at: Date;
        created_at: Date;
        released_at?: Date;
        order_code?: string;
      }>(query, params);

      return rows.map(
        (row) =>
          new StockReservationEntity({
            id: row.id,
            orderId: row.order_id,
            orderCode: row.order_code || row.order_id,
            productId: row.product_id,
            warehouseId: row.warehouse_id,
            quantity: Number(row.quantity),
            status: row.status as StockReservationStatus,
            expiredAt: new Date(row.expired_at),
            createdAt: new Date(row.created_at),
            releasedAt: row.released_at ? new Date(row.released_at) : undefined,
          }),
      );
    }

    return Array.from(this.memoryStockReservations.values()).filter((res) => {
      if (res.status !== StockReservationStatus.ACTIVE) return false;
      if (sku && res.productId.toUpperCase() !== sku.toUpperCase()) return false;
      if (orderId && res.orderId !== orderId) return false;
      return true;
    });
  }

  addMemoryReservation(res: StockReservationEntity): void {
    this.memoryStockReservations.set(res.id, res);
  }

  releaseMemoryReservationsByOrderId(orderId: string): number {
    let count = 0;
    for (const [id, res] of this.memoryStockReservations.entries()) {
      if (res.orderId === orderId && res.status === StockReservationStatus.ACTIVE) {
        res.status = StockReservationStatus.RELEASED;
        res.releasedAt = new Date();
        this.memoryStockReservations.set(id, res);
        count++;
      }
    }
    return count;
  }

  releaseExpiredMemoryReservations(): { releasedReservations: number; cancelledOrderIds: string[] } {
    const now = new Date();
    const cancelledOrderIds = new Set<string>();
    let count = 0;
    for (const [id, res] of this.memoryStockReservations.entries()) {
      if (res.status === StockReservationStatus.ACTIVE && new Date(res.expiredAt) < now) {
        res.status = StockReservationStatus.RELEASED;
        res.releasedAt = now;
        this.memoryStockReservations.set(id, res);
        cancelledOrderIds.add(res.orderId);
        count++;
      }
    }
    return { releasedReservations: count, cancelledOrderIds: Array.from(cancelledOrderIds) };
  }

  /**
   * Điều chỉnh tồn kho hàng hóa (Chỉ Thủ kho và Quản trị viên được phép)
   *
   * Nghiệp vụ cốt lõi (SN-23):
   * - Nhập xuất theo đơn vị nào (thùng, lốc, lon) cũng tự động quy về đơn vị cơ sở để ghi sổ tồn
   * - Lưu snapshot hệ số quy đổi bất biến tại thời điểm phát sinh giao dịch
   * - Đổi hệ số quy đổi sau này không làm sai lệch lịch sử giao dịch đã ghi
   *
   * Fix #2 (Concurrency): toàn bộ "kiểm tra tồn + cập nhật tồn" được bọc trong per-product
   * mutex lock, loại bỏ race condition khi nhiều request cùng SKU đến đồng thời.
   */
  async adjustStock(
    dto: AdjustStockDto,
    userId: string,
  ): Promise<StockAdjustmentResult> {
    const productLookup = await this.productsService.findById(dto.productSku);
    const releaseLock = await this.acquireLock(productLookup.id);
    try {
      const product = await this.productsService.findById(dto.productSku);
      return await this.adjustStockLocked(product, dto, userId);
    } finally {
      releaseLock();
    }
  }

  private async adjustStockLocked(
    product: ProductEntity,
    dto: AdjustStockDto,
    userId: string,
  ): Promise<StockAdjustmentResult> {
    const conversion = this.productsService.findUnitConversion(product, dto.unit || dto.unitName);
    const baseQuantityChange = Math.round(dto.quantityChange * conversion.conversionRate);
    if (baseQuantityChange === 0) {
      throw new BadRequestException('Số lượng điều chỉnh sau quy đổi phải khác 0.');
    }
    if (!this.databaseService.isConnected()) {
      const previousQuantity = product.stockQuantity ?? 0;
      if (baseQuantityChange < 0 && previousQuantity + baseQuantityChange < 0) {
        throw new BadRequestException(`Tồn kho không đủ để xuất trừ (hiện có: ${previousQuantity}).`);
      }
      const newQuantity = previousQuantity + baseQuantityChange;
      await this.productsService.setStockQuantity(product.id, newQuantity);
      const transaction = this.createInventoryTransaction(
        product, dto, userId, conversion.unitName, conversion.conversionRate,
        baseQuantityChange, previousQuantity, newQuantity,
      );
      this.writeLedger(transaction);
      return this.createAdjustmentResult(transaction, dto, userId, previousQuantity, newQuantity);
    }
    const client = await this.databaseService.getClient();
    let transaction: InventoryTransactionEntity;
    let previousQuantity = 0;
    let newQuantity = 0;
    try {
      await client.query('BEGIN');
      await this.lockSku(client, product.sku);
      previousQuantity = await this.getStockBalanceForUpdate(client, product, dto.warehouseId || DEFAULT_WAREHOUSE_ID);
      await this.validateStockAdjustment(client, product, dto, baseQuantityChange, previousQuantity);
      newQuantity = previousQuantity + baseQuantityChange;
      await this.updateStockBalance(client, product.sku, newQuantity, dto.warehouseId || DEFAULT_WAREHOUSE_ID);
      await this.consumeOrderReservation(client, product.sku, dto.referenceCode, baseQuantityChange);
      transaction = this.createInventoryTransaction(
        product, dto, userId, conversion.unitName, conversion.conversionRate,
        baseQuantityChange, previousQuantity, newQuantity,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (!dto.warehouseId || dto.warehouseId === DEFAULT_WAREHOUSE_ID) {
      await this.productsService.setStockQuantity(product.id, newQuantity);
    }
    this.writeLedger(transaction);
    return this.createAdjustmentResult(transaction, dto, userId, previousQuantity, newQuantity);
  }

  private async lockSku(client: PoolClient, sku: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sku.trim().toUpperCase()]);
  }

  private async validateStockAdjustment(
    client: PoolClient,
    product: ProductEntity,
    dto: AdjustStockDto,
    quantityChange: number,
    physicalQuantity: number,
  ): Promise<void> {
    if (quantityChange >= 0) return;
    const reservations = await this.getReservationQuantities(
      client, product.sku, dto.referenceCode?.trim(), dto.warehouseId || DEFAULT_WAREHOUSE_ID,
    );
    const requestedExport = Math.abs(quantityChange);
    if (reservations.orderQuantity > 0 && requestedExport > reservations.orderQuantity) {
      throw new BadRequestException(
        `Số lượng xuất vượt quá phần đang giữ của đơn ${dto.referenceCode} (${reservations.orderQuantity} ${product.baseUnit}).`,
      );
    }
    const isOrderExport = Boolean(dto.referenceCode?.trim() && reservations.orderQuantity > 0);
    const available = physicalQuantity - reservations.totalQuantity;
    if (!isOrderExport && requestedExport > available) {
      throw new BadRequestException(
        `Tồn khả dụng chỉ còn ${available} ${product.baseUnit}; ${reservations.totalQuantity} đang được giữ cho đơn hàng.`,
      );
    }
    if (requestedExport > physicalQuantity) {
      throw new BadRequestException(`Tồn thực tế chỉ còn ${physicalQuantity} ${product.baseUnit}.`);
    }
  }

  private async getReservationQuantities(
    client: PoolClient,
    sku: string,
    orderCode?: string,
    warehouseId: string = DEFAULT_WAREHOUSE_ID,
  ): Promise<{ totalQuantity: number; orderQuantity: number }> {
    const result = await client.query<{ total: string; order_quantity: string }>(
      `SELECT COALESCE(SUM(base_quantity), 0)::text AS total,
              COALESCE(SUM(base_quantity) FILTER (
                WHERE $2::text IS NOT NULL AND order_id = (
                  SELECT id FROM app_order_records WHERE UPPER(order_code) = UPPER($2)
                )
              ), 0)::text AS order_quantity
       FROM app_order_inventory_reservations
       WHERE product_sku = $1 AND warehouse_id = $3::uuid AND status = 'RESERVED'`,
      [sku.trim().toUpperCase(), orderCode || null, warehouseId],
    );
    return {
      totalQuantity: Number(result.rows[0]?.total ?? 0),
      orderQuantity: Number(result.rows[0]?.order_quantity ?? 0),
    };
  }

  private async consumeOrderReservation(
    client: PoolClient,
    sku: string,
    orderCode: string | undefined,
    quantityChange: number,
  ): Promise<void> {
    if (quantityChange >= 0 || !orderCode?.trim()) return;
    let remaining = Math.abs(quantityChange);
    const rows = await client.query<{ id: string; base_quantity: string }>(
      `SELECT r.id, r.base_quantity::text FROM app_order_inventory_reservations r
       JOIN app_order_records o ON o.id = r.order_id
       WHERE UPPER(o.order_code) = UPPER($1) AND r.product_sku = $2 AND r.status = 'RESERVED'
       ORDER BY r.id FOR UPDATE OF r`,
      [orderCode.trim(), sku.trim().toUpperCase()],
    );
    for (const row of rows.rows) {
      if (remaining <= 0) break;
      remaining = await this.consumeReservationRow(client, row, remaining);
    }
  }

  private async consumeReservationRow(
    client: PoolClient,
    row: { id: string; base_quantity: string },
    remaining: number,
  ): Promise<number> {
    const reserved = Number(row.base_quantity);
    const consumed = Math.min(remaining, reserved);
    if (consumed === reserved) {
      await client.query(
        `UPDATE app_order_inventory_reservations SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [row.id],
      );
    } else {
      await client.query(
        `UPDATE app_order_inventory_reservations SET base_quantity = base_quantity - $2 WHERE id = $1`,
        [row.id, consumed],
      );
    }
    return remaining - consumed;
  }

  private createInventoryTransaction(
    product: ProductEntity,
    dto: AdjustStockDto,
    userId: string,
    unitName: string,
    conversionRate: number,
    baseQuantityChange: number,
    previousQuantity: number,
    newQuantity: number,
  ): InventoryTransactionEntity {
    const referenceCode = dto.referenceCode?.trim() ||
      `${dto.quantityChange >= 0 ? 'PNK' : 'PXK'}-${Date.now().toString().slice(-6)}`;
    return new InventoryTransactionEntity({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      transactionType: dto.quantityChange >= 0 ? 'IMPORT' : 'EXPORT',
      inputQuantity: dto.quantityChange,
      inputUnit: unitName,
      conversionRate,
      baseQuantityChange,
      baseUnit: product.baseUnit,
      previousStock: previousQuantity,
      newStock: newQuantity,
      reason: dto.reason.trim(),
      referenceCode,
      warehouse: dto.warehouseLocation || 'Kho Tổng Miền Nam - LOHA WH01',
      performedBy: userId,
      createdAt: new Date(),
    });
  }

  private createAdjustmentResult(
    transaction: InventoryTransactionEntity,
    dto: AdjustStockDto,
    userId: string,
    previousQuantity: number,
    newQuantity: number,
  ): StockAdjustmentResult {
    const action = dto.quantityChange >= 0 ? 'Nhập kho' : 'Xuất kho';
    const sign = dto.quantityChange >= 0 ? '+' : '';
    return {
      success: true,
      message: `${action} thành công: ${sign}${dto.quantityChange} ${transaction.inputUnit} (Quy đổi: ${sign}${transaction.baseQuantityChange} ${transaction.baseUnit}). Tồn mới: ${newQuantity} ${transaction.baseUnit}.`,
      sku: transaction.sku,
      productName: transaction.productName,
      inputQuantity: dto.quantityChange,
      inputUnit: transaction.inputUnit,
      unitName: transaction.inputUnit,
      conversionRate: transaction.conversionRate,
      conversionFactor: transaction.conversionRate,
      baseQuantityChange: transaction.baseQuantityChange,
      baseUnit: transaction.baseUnit,
      previousQuantity,
      newQuantity,
      quantityChange: transaction.baseQuantityChange,
      reason: dto.reason,
      referenceCode: transaction.referenceCode,
      adjustedBy: userId,
      timestamp: transaction.createdAt.toISOString(),
    };
  }

  /**
   * Truy vấn sổ kho và lịch sử biến động giao dịch (Fix #4: đọc từ ledger Map)
   */
  async getTransactions(
    sku?: string,
    limit?: number,
  ): Promise<InventoryTransactionEntity[]> {
    // Gom toàn bộ giao dịch từ tất cả bucket, sắp xếp mới nhất lên đầu
    let list: InventoryTransactionEntity[] = [];
    for (const bucket of this.ledger.values()) {
      list = list.concat(bucket);
    }
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (sku) {
      const cleanSku = sku.trim().toUpperCase();
      list = list.filter((t) => {
        const tSku = t.sku.toUpperCase();
        if (tSku === cleanSku) return true;
        if (cleanSku === 'LH-MILK-900G' && tSku === 'LH-MILK-POWDER-900G') return true;
        if (cleanSku === 'LH-TEA-240ML' && tSku === 'LH-TEA-350ML') return true;
        return false;
      });
    }

    const max = limit && limit > 0 ? Number(limit) : 100;
    return list.slice(0, max);
  }

  // =========================================================================
  // QUẢN LÝ KIỂM KÊ KHO (SN-182 / EP-SN-229)
  // =========================================================================

  private seedInitialAudits(): void {
    const now = Date.now();
    const seedAudit1 = new InventoryAuditEntity({
      id: 'audit-seed-001',
      auditCode: 'PKK-20261008-001',
      warehouseId: DEFAULT_WAREHOUSE_ID,
      warehouseName: DEFAULT_WAREHOUSE_NAME,
      scope: 'ALL',
      status: InventoryAuditStatus.COMPLETED,
      note: 'Kiểm kê định kỳ đầu tháng 10/2026',
      totalBookQuantity: 1540,
      totalActualQuantity: 1538,
      totalDifferenceQuantity: -2,
      creatorId: 'usr-wh-keeper',
      creatorName: 'Thủ kho Nguyễn Văn Kho',
      completedById: 'usr-wh-manager',
      completedByName: 'Quản lý kho Trần Văn Quản',
      completedAt: new Date(now - 86400000 * 2),
      reason: 'Hao hụt tự nhiên trong quá trình vận chuyển nội bộ',
      createdAt: new Date(now - 86400000 * 3),
      updatedAt: new Date(now - 86400000 * 2),
      items: [
        {
          id: 'item-seed-001',
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
          categoryName: 'Sữa Bột',
          unit: 'Lon',
          bookQuantity: 340,
          actualQuantity: 338,
          difference: -2,
          differenceAmount: -1100000,
          unitPrice: 550000,
          note: 'Móp méo 2 lon khi bốc xếp',
        },
        {
          id: 'item-seed-002',
          productId: 'prod-002',
          productSku: 'LH-NUT-180ML',
          productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
          categoryName: 'Sữa Hạt',
          unit: 'Hộp',
          bookQuantity: 1200,
          actualQuantity: 1200,
          difference: 0,
          differenceAmount: 0,
          unitPrice: 28000,
          note: 'Khớp số lượng',
        },
      ],
    });

    this.audits.set(seedAudit1.id, seedAudit1);
  }

  /**
   * Tạo phiếu kiểm kê theo kho hoặc nhóm hàng (SN-182)
   * Hệ thống chốt số lượng tồn sổ sách (bookQuantity) tại thời điểm tạo phiếu.
   */
  async createAudit(
    dto: CreateInventoryAuditDto,
    creator?: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    const warehouseId = dto.warehouseId || DEFAULT_WAREHOUSE_ID;
    const warehouseName = dto.warehouseName || DEFAULT_WAREHOUSE_NAME;
    const scope = dto.scope || 'ALL';

    const allProducts = await this.productsService.findAll();
    let targetProducts = allProducts;

    if (scope === 'CATEGORY' && (dto.categoryId || dto.categoryName)) {
      const catId = (dto.categoryId || '').trim().toLowerCase();
      const catName = (dto.categoryName || '').trim().toLowerCase();

      targetProducts = allProducts.filter((p) => {
        const pCatId = (p.categoryId || '').trim().toLowerCase();
        const pCat = (p.category || '').trim().toLowerCase();
        const pParent = (p.parentCategory || '').trim().toLowerCase();
        const pSub = (p.subCategory || '').trim().toLowerCase();

        return (
          (catId && (pCatId === catId || pCat.includes(catId))) ||
          (catName && (pCat.includes(catName) || pParent.includes(catName) || pSub.includes(catName)))
        );
      });

      if (targetProducts.length === 0) {
        targetProducts = allProducts;
      }
    }

    const auditId = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const randCode = Math.floor(1000 + Math.random() * 9000);
    const auditCode = `PKK-${dateStr}-${randCode}`;

    const items: InventoryAuditItemEntity[] = targetProducts.map((p, idx) => {
      const bookQty = p.stockQuantity ?? 0;
      return {
        id: `audit-item-${Date.now()}-${idx + 1}`,
        productId: p.id,
        productSku: p.sku,
        productName: p.name,
        categoryName: p.parentCategory || p.category || 'Mặc định',
        unit: p.baseUnit || 'Cái',
        bookQuantity: bookQty,
        actualQuantity: null,
        difference: 0,
        differenceAmount: 0,
        unitPrice: p.price || p.costPrice || 0,
        note: '',
      };
    });

    const creatorId = creator?.userId || 'usr-system';
    const creatorName = (creator as any)?.fullName || creator?.username || creator?.userId || 'Thủ kho';

    const audit = new InventoryAuditEntity({
      id: auditId,
      auditCode,
      warehouseId,
      warehouseName,
      scope,
      categoryId: dto.categoryId,
      categoryName: dto.categoryName,
      status: InventoryAuditStatus.DRAFT,
      note: dto.note?.trim(),
      items,
      creatorId,
      creatorName,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.audits.set(audit.id, audit);
    return audit;
  }

  /**
   * Danh sách phiếu kiểm kê có lọc theo trạng thái, kho, từ ngày, đến ngày (SN-182)
   */
  async getAudits(query?: QueryAuditsDto): Promise<InventoryAuditEntity[]> {
    let list = Array.from(this.audits.values());

    if (query?.status) {
      const statusUpper = query.status.trim().toUpperCase();
      list = list.filter((a) => a.status.toUpperCase() === statusUpper);
    }

    if (query?.warehouseId) {
      const whId = query.warehouseId.trim().toUpperCase();
      list = list.filter((a) => a.warehouseId.toUpperCase() === whId);
    }

    if (query?.search) {
      const s = query.search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.auditCode.toLowerCase().includes(s) ||
          (a.note && a.note.toLowerCase().includes(s)) ||
          a.creatorName.toLowerCase().includes(s) ||
          (a.reason && a.reason.toLowerCase().includes(s)),
      );
    }

    if (query?.fromDate) {
      const from = new Date(query.fromDate);
      if (!isNaN(from.getTime())) {
        list = list.filter((a) => a.createdAt.getTime() >= from.getTime());
      }
    }

    if (query?.toDate) {
      const to = new Date(query.toDate);
      if (!isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        list = list.filter((a) => a.createdAt.getTime() <= to.getTime());
      }
    }

    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Lấy chi tiết phiếu kiểm kê theo ID hoặc mã phiếu (SN-182)
   */
  async getAuditById(id: string): Promise<InventoryAuditEntity> {
    const cleanId = id.trim();
    let audit = this.audits.get(cleanId);

    if (!audit) {
      audit = Array.from(this.audits.values()).find(
        (a) => a.auditCode.toLowerCase() === cleanId.toLowerCase(),
      );
    }

    if (!audit) {
      throw new NotFoundException(`Không tìm thấy phiếu kiểm kê ${id}.`);
    }

    return audit;
  }

  /**
   * Nhập số đếm thực tế và tự động tính chênh lệch từng dòng (SN-182)
   */
  async updateAuditItems(
    id: string,
    dto: UpdateAuditItemsDto,
    _user?: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    const audit = await this.getAuditById(id);

    if (audit.status !== InventoryAuditStatus.DRAFT) {
      throw new BadRequestException('Chỉ có thể nhập số đếm thực tế cho phiếu kiểm kê ở trạng thái Bản nháp (DRAFT).');
    }

    if (!dto.items || !Array.isArray(dto.items)) {
      throw new BadRequestException('Danh sách mặt hàng kiểm đếm không hợp lệ.');
    }

    const itemMap = new Map<string, { actualQuantity: number; note?: string }>();
    for (const input of dto.items) {
      itemMap.set(input.productId, input);
    }

    for (const item of audit.items) {
      const input = itemMap.get(item.productId) || itemMap.get(item.productSku) || itemMap.get(item.id);
      if (input !== undefined) {
        item.actualQuantity = Number(input.actualQuantity);
        item.difference = item.actualQuantity - item.bookQuantity;
        item.differenceAmount = item.difference * (item.unitPrice || 0);
        if (input.note !== undefined) {
          item.note = input.note?.trim();
        }
      }
    }

    // Cập nhật lại tổng
    audit.totalActualQuantity = audit.items.reduce(
      (sum, item) => sum + (item.actualQuantity !== null && item.actualQuantity !== undefined ? item.actualQuantity : item.bookQuantity),
      0,
    );
    audit.totalDifferenceQuantity = audit.items.reduce((sum, item) => sum + item.difference, 0);
    audit.updatedAt = new Date();

    return audit;
  }

  /**
   * Chốt kiểm kê điều chỉnh tồn về số thực đếm (SN-182)
   * Yêu cầu:
   * 1. Chỉ Quản lý kho (WAREHOUSE_MANAGER, WH_MANAGER, ADMIN) mới có quyền chốt.
   * 2. Bắt buộc nhập lý do điều chỉnh (reason).
   * 3. Cập nhật tồn kho sản phẩm về actualQuantity và ghi sổ kho giao dịch ADJUSTMENT.
   */
  async completeAudit(
    id: string,
    dto: CompleteAuditDto,
    user: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    // 1. Phân quyền RBAC nghiêm ngặt
    const roles: string[] = [];
    if (Array.isArray(user?.roles)) {
      roles.push(...user.roles.map((r) => r.toString().toUpperCase()));
    }
    if ((user as any)?.role) {
      roles.push((user as any).role.toString().toUpperCase());
    }

    const isWarehouseManager = roles.some((r) =>
      [
        UserRole.WAREHOUSE_MANAGER,
        UserRole.WH_MANAGER,
        UserRole.ADMIN,
        'WAREHOUSE_MANAGER',
        'WH_MANAGER',
        'ADMIN',
      ].includes(r as any),
    );

    if (!isWarehouseManager) {
      throw new ForbiddenException(
        'Chỉ Quản lý kho (WAREHOUSE_MANAGER) hoặc Quản trị viên (ADMIN) mới có quyền chốt phiếu kiểm kê và điều chỉnh tồn kho.',
      );
    }

    // 2. Bắt buộc nhập lý do điều chỉnh
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Bắt buộc phải nhập lý do điều chỉnh khi chốt phiếu kiểm kê.');
    }

    const audit = await this.getAuditById(id);

    if (audit.status === InventoryAuditStatus.COMPLETED) {
      throw new BadRequestException('Phiếu kiểm kê đã được chốt hoàn thành trước đó.');
    }

    if (audit.status === InventoryAuditStatus.CANCELLED) {
      throw new BadRequestException('Phiếu kiểm kê đã bị hủy, không thể chốt.');
    }

    // 3. Cập nhật tồn kho về số thực tế và ghi sổ kho
    for (const item of audit.items) {
      const actualQty =
        item.actualQuantity !== null && item.actualQuantity !== undefined
          ? item.actualQuantity
          : item.bookQuantity;
      const diff = actualQty - item.bookQuantity;

      if (diff !== 0) {
        // Cập nhật tồn kho cho sản phẩm
        await this.productsService.setStockQuantity(item.productId, actualQty);

        // Cập nhật tồn kho trong DB nếu có kết nối
        if (this.databaseService.isConnected()) {
          try {
            await this.databaseService.query(
              `UPDATE app_inventory_stock_balances
               SET physical_quantity = $2, updated_at = CURRENT_TIMESTAMP
               WHERE product_sku = UPPER($1)`,
              [item.productSku, actualQty],
            );
          } catch (e) {
            // In-memory fallback
          }
        }

        // Ghi sổ kho giao dịch ADJUSTMENT
        const tx = new InventoryTransactionEntity({
          productId: item.productId,
          sku: item.productSku,
          productName: item.productName,
          transactionType: 'ADJUSTMENT',
          inputQuantity: Math.abs(diff),
          inputUnit: item.unit,
          conversionRate: 1,
          baseQuantityChange: diff,
          baseUnit: item.unit,
          previousStock: item.bookQuantity,
          newStock: actualQty,
          reason: `Kiểm kê kho [${audit.auditCode}]: ${dto.reason.trim()}${item.note ? ` - ${item.note}` : ''}`,
          referenceCode: audit.auditCode,
          warehouse: audit.warehouseName,
          performedBy: user.userId || user.username || 'WAREHOUSE_MANAGER',
          createdAt: new Date(),
        });

        this.writeLedger(tx);
      }
    }

    // Cập nhật trạng thái phiếu
    audit.status = InventoryAuditStatus.COMPLETED;
    audit.reason = dto.reason.trim();
    if (dto.note) {
      audit.note = audit.note ? `${audit.note} | ${dto.note.trim()}` : dto.note.trim();
    }
    audit.completedById = user.userId;
    audit.completedByName = (user as any).fullName || user.username || user.userId || 'Quản lý kho';
    audit.completedAt = new Date();
    audit.updatedAt = new Date();

    return audit;
  }

  /**
   * Hủy phiếu kiểm kê (chỉ khi đang ở trạng thái DRAFT)
   */
  async cancelAudit(
    id: string,
    reason?: string,
    _user?: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    const audit = await this.getAuditById(id);

    if (audit.status !== InventoryAuditStatus.DRAFT) {
      throw new BadRequestException('Chỉ có thể hủy phiếu kiểm kê ở trạng thái Bản nháp (DRAFT).');
    }

    audit.status = InventoryAuditStatus.CANCELLED;
    if (reason) {
      audit.note = audit.note ? `${audit.note} | Lý do hủy: ${reason.trim()}` : `Lý do hủy: ${reason.trim()}`;
    }
    audit.updatedAt = new Date();

    return audit;
  }
}

