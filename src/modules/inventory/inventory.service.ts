import { BadRequestException, forwardRef, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { StockReservationEntity, StockReservationStatus } from './entities/stock-reservation.entity';
import { DatabaseService } from '../../database/database.service';
import type { PoolClient } from 'pg';
import type { ProductEntity } from '../products/entities/product.entity';

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

  /**
   * Fix #2: Per-product Promise mutex lock.
   * - Khi request A đang trong critical section (kiểm tra tồn + cập nhật) của SKU X,
   *   request B sẽ await Promise trước khi được phép vào.
   * - Đảm bảo hai bước "kiểm tra tồn" & "cập nhật tồn" là NGUYÊN TỬ với nhau.
   * - Không ảnh hưởng throughput cho các SKU khác (lock độc lập theo productId).
   */
  private locks = new Map<string, Promise<void>>();
  private stockBalanceSchemaPromise: Promise<void> | null = null;

  private memoryStockReservations = new Map<string, StockReservationEntity>();
  private stockReservationSchemaPromise: Promise<void> | null = null;

  constructor(
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    private readonly databaseService: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.ledger.size === 0) {
      this.seedInitialTransactions();
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
          product_sku TEXT PRIMARY KEY,
          physical_quantity NUMERIC(15, 2) NOT NULL CHECK (physical_quantity >= 0),
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `).then(() => undefined).catch((error: unknown) => {
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
      `INSERT INTO app_inventory_stock_balances (product_sku, physical_quantity)
       SELECT UPPER(sku), quantity
       FROM UNNEST($1::text[], $2::numeric[]) AS seed(sku, quantity)
       ON CONFLICT (product_sku) DO NOTHING`,
      [products.map((product) => product.sku), products.map((product) => product.stockQuantity)],
    );
  }

  private async getStockBalances(products: ProductEntity[]): Promise<Map<string, number>> {
    await this.ensureStockBalanceTable();
    if (products.length === 0) return new Map();
    await this.databaseService.query(
      `INSERT INTO app_inventory_stock_balances (product_sku, physical_quantity)
       SELECT UPPER(sku), quantity
       FROM UNNEST($1::text[], $2::numeric[]) AS seed(sku, quantity)
       ON CONFLICT (product_sku) DO NOTHING`,
      [products.map((product) => product.sku), products.map((product) => product.stockQuantity)],
    );
    const rows = await this.databaseService.query<{ product_sku: string; physical_quantity: string }>(
      `SELECT product_sku, physical_quantity::text
       FROM app_inventory_stock_balances
       WHERE product_sku = ANY($1::text[])`,
      [products.map((product) => product.sku.toUpperCase())],
    );
    return new Map(rows.map((row) => [row.product_sku, Number(row.physical_quantity)]));
  }

  async getStockBalanceForUpdate(
    client: PoolClient,
    product: ProductEntity,
  ): Promise<number> {
    await this.ensureStockBalanceTable();
    const sku = product.sku.trim().toUpperCase();
    await client.query(
      `INSERT INTO app_inventory_stock_balances (product_sku, physical_quantity)
       VALUES ($1, $2) ON CONFLICT (product_sku) DO NOTHING`,
      [sku, product.stockQuantity],
    );
    const result = await client.query<{ physical_quantity: string }>(
      `SELECT physical_quantity::text FROM app_inventory_stock_balances
       WHERE product_sku = $1 FOR UPDATE`,
      [sku],
    );
    return Number(result.rows[0]?.physical_quantity ?? 0);
  }

  async updateStockBalance(
    client: PoolClient,
    sku: string,
    physicalQuantity: number,
  ): Promise<void> {
    await client.query(
      `UPDATE app_inventory_stock_balances
       SET physical_quantity = $2, updated_at = CURRENT_TIMESTAMP
       WHERE product_sku = $1`,
      [sku.trim().toUpperCase(), physicalQuantity],
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
  async getStockOverview(): Promise<
    Array<{
      sku: string;
      productId: string;
      name: string;
      productName: string;
      stockQuantity: number;
      physicalStockQuantity: number;
      physicalQuantity: number;
      reservedQuantity: number;
      availableQuantity: number;
      baseUnit: string;
      units: Array<{ unitName: string; conversionRate: number; isBaseUnit: boolean }>;
      warehouse: string;
      activeReservations: Array<{
        id: string;
        orderId: string;
        orderCode?: string;
        customerName?: string;
        orderStatus?: string;
        quantity: number;
        expiredAt: string;
        createdAt: string;
      }>;
    }>
  > {
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

    if (this.databaseService?.isConnected()) {
      await this.ensureStockReservationsTable();
      physicalBalances = await this.getStockBalances(products);

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

      return {
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
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        activeReservations: matchedReservations,
      };
    });
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
      previousQuantity = await this.getStockBalanceForUpdate(client, product);
      await this.validateStockAdjustment(client, product, dto, baseQuantityChange, previousQuantity);
      newQuantity = previousQuantity + baseQuantityChange;
      await this.updateStockBalance(client, product.sku, newQuantity);
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
    await this.productsService.setStockQuantity(product.id, newQuantity);
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
      client, product.sku, dto.referenceCode?.trim(),
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
  ): Promise<{ totalQuantity: number; orderQuantity: number }> {
    const result = await client.query<{ total: string; order_quantity: string }>(
      `SELECT COALESCE(SUM(base_quantity), 0)::text AS total,
              COALESCE(SUM(base_quantity) FILTER (
                WHERE $2::text IS NOT NULL AND order_id = (
                  SELECT id FROM app_order_records WHERE UPPER(order_code) = UPPER($2)
                )
              ), 0)::text AS order_quantity
       FROM app_order_inventory_reservations
       WHERE product_sku = $1 AND status = 'RESERVED'`,
      [sku.trim().toUpperCase(), orderCode || null],
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
}
