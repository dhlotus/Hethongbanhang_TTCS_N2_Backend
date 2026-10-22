import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { ProductsService } from '../products/products.service';
import { GoodsReceiptsService } from '../inventory-receipts/goods-receipts.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { StockReservationEntity, StockReservationStatus } from './entities/stock-reservation.entity';
import { DatabaseService } from '../../database/database.service';
import type { PoolClient } from 'pg';
import type { ProductEntity } from '../products/entities/product.entity';
import type { LowStockAlert, StockBalance } from './entities/stock-balance.entity';
import { InventoryAuditEntity, InventoryAuditItemEntity } from './entities/inventory-audit.entity';
import { InventoryAuditStatus } from './entities/inventory-audit-status.enum';
import { InventoryBatchEntity } from './entities/inventory-batch.entity';
import {
  CreateInventoryAuditDto,
  UpdateAuditItemsDto,
  CompleteAuditDto,
  QueryAuditsDto,
  QueryBatchesDto,
  CheckBatchDispatchDto,
  BatchStatusFilter,
  CreateStockAdjustmentDto,
  RejectStockAdjustmentDto,
  QueryStockAdjustmentsDto,
} from './dto';
import {
  StockAdjustmentEntity,
  StockAdjustmentItemEntity,
} from './entities/stock-adjustment.entity';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  DEFAULT_WAREHOUSE_ID,
  STANDARD_WAREHOUSES,
} from '../warehouses/warehouse.constants';

const DEFAULT_WAREHOUSE_NAME = 'Kho Tổng Miền Nam';

export interface PaginatedBatchesResponse {
  data: InventoryBatchEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  thresholdDays: number;
}

export interface BatchStatsResponse {
  totalBatches: number;
  validCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  totalQuantity: number;
  thresholdDays: number;
}

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

export interface StockOverviewItem extends StockBalance {
  id: string;
  category: string;
  parentCategory: string;
  subCategory?: string;
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'DAMAGED';
  imageUrl?: string;
  damagedQuantity?: number;
  damagedStock?: number;
  batchNumber?: string;
  expiryDate?: string;
  mfgDate?: string;
  warehouseCode?: string;
}

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);
  /**
   * Fix #4: Sổ kho tập trung theo Map<productId, giao dịch[]>.
   * - Lookup O(1) theo productId thay vì O(n) full-scan mảng phẳng.
   * - Tránh race write vào cùng một vùng nhớ khi nhiều request song song
   *   cho các SKU khác nhau (mỗi SKU có bucket riêng).
   */
  private ledger = new Map<string, InventoryTransactionEntity[]>();
  private audits = new Map<string, InventoryAuditEntity>();
  private batches = new Map<string, InventoryBatchEntity>();
  private memoryWarehouseBalances = new Map<string, Map<string, number>>();
  private adjustments = new Map<string, StockAdjustmentEntity>();
  private stockAdjustmentsSchemaPromise: Promise<void> | null = null;

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
  private readonly goodsReceiptsService?: GoodsReceiptsService;

  private memoryStockReservations = new Map<string, StockReservationEntity>();
  private stockReservationSchemaPromise: Promise<void> | null = null;
  private stockTransactionsSchemaPromise: Promise<void> | null = null;

  constructor(
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    @Optional()
    arg2?: DatabaseService | GoodsReceiptsService,
    @Optional()
    @Inject(forwardRef(() => GoodsReceiptsService))
    arg3?: GoodsReceiptsService | DatabaseService,
  ) {
    if (arg2 instanceof DatabaseService) {
      this.databaseService = arg2;
      this.goodsReceiptsService = arg3 instanceof GoodsReceiptsService ? arg3 : (arg3 as any);
    } else if (arg2 && typeof (arg2 as any).getConfirmedReceiptsForSync === 'function') {
      this.goodsReceiptsService = arg2 as GoodsReceiptsService;
      this.databaseService = arg3 instanceof DatabaseService ? arg3 : new DatabaseService();
    } else {
      this.databaseService = (arg3 instanceof DatabaseService ? arg3 : (arg2 as any)) || new DatabaseService();
      this.goodsReceiptsService = (arg3 && typeof (arg3 as any).getConfirmedReceiptsForSync === 'function') ? (arg3 as GoodsReceiptsService) : undefined;
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.ledger.size === 0) {
      this.seedInitialTransactions();
    }
    if (this.audits.size === 0) {
      this.seedInitialAudits();
    }
    if (this.batches.size === 0) {
      this.seedInitialBatches();
    }
    await this.syncWithGoodsReceipts();
    if (this.adjustments.size === 0) {
      this.seedInitialAdjustments();
    }
    if (this.databaseService?.isConnected()) {
      await this.ensureStockBalanceTable();
      await this.ensureStockReservationsTable();
      await this.ensureStockTransactionsTable();
      await this.ensureStockAdjustmentsTable();
      await this.seedStockBalances();
      await this.ensureAllWarehousesInventory();
      await this.syncBatchesFromDatabase();
      await this.syncAdjustmentsFromDatabase();
      try {
        await this.databaseService.query(`ALTER TABLE inventory_batches ALTER COLUMN expiry_date DROP NOT NULL;`);
      } catch {}
    }
  }

  async ensureStockTransactionsTable(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    if (!this.stockTransactionsSchemaPromise) {
      this.stockTransactionsSchemaPromise = (async () => {
        await this.databaseService.query(`
          CREATE TABLE IF NOT EXISTS app_inventory_transactions (
            id TEXT PRIMARY KEY,
            product_id TEXT NOT NULL,
            sku TEXT NOT NULL,
            product_name TEXT NOT NULL,
            transaction_type TEXT NOT NULL,
            input_quantity NUMERIC(15, 2) NOT NULL,
            input_unit TEXT NOT NULL,
            conversion_rate NUMERIC(15, 2) NOT NULL DEFAULT 1,
            base_quantity_change NUMERIC(15, 2) NOT NULL,
            base_unit TEXT NOT NULL,
            previous_stock NUMERIC(15, 2) NOT NULL,
            new_stock NUMERIC(15, 2) NOT NULL,
            reason TEXT,
            reference_code TEXT,
            warehouse TEXT,
            performed_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_stock_tx_sku ON app_inventory_transactions(sku);
          CREATE INDEX IF NOT EXISTS idx_stock_tx_created_at ON app_inventory_transactions(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_stock_tx_ref ON app_inventory_transactions(reference_code);
        `);

        try {
          const countRes = await this.databaseService.query<{ count: string }>(
            `SELECT count(*)::text as count FROM app_inventory_transactions`,
          );
          const count = Number(countRes[0]?.count ?? 0);
          if (count === 0) {
            for (const bucket of this.ledger.values()) {
              for (const tx of bucket) {
                await this.databaseService.query(
                  `INSERT INTO app_inventory_transactions (
                    id, product_id, sku, product_name, transaction_type,
                    input_quantity, input_unit, conversion_rate, base_quantity_change, base_unit,
                    previous_stock, new_stock, reason, reference_code, warehouse, performed_by, created_at
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                  ON CONFLICT (id) DO NOTHING`,
                  [
                    tx.id,
                    tx.productId,
                    tx.sku,
                    tx.productName,
                    tx.transactionType,
                    tx.inputQuantity,
                    tx.inputUnit,
                    tx.conversionRate,
                    tx.baseQuantityChange,
                    tx.baseUnit,
                    tx.previousStock,
                    tx.newStock,
                    tx.reason,
                    tx.referenceCode,
                    tx.warehouse,
                    tx.performedBy,
                    tx.createdAt,
                  ],
                );
              }
            }
          }
        } catch (seedErr: any) {
          console.warn('[INVENTORY_SERVICE] Không thể nạp khởi tạo app_inventory_transactions:', seedErr?.message);
        }
      })().catch((error: unknown) => {
        this.stockTransactionsSchemaPromise = null;
        console.warn('[INVENTORY_SERVICE] Lỗi tạo bảng app_inventory_transactions:', (error as any)?.message);
      });
    }
    await this.stockTransactionsSchemaPromise;
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
      `)).then(() => this.databaseService.query(`
        ALTER TABLE app_inventory_stock_balances
        ADD COLUMN IF NOT EXISTS warehouse_id UUID NOT NULL DEFAULT '${DEFAULT_WAREHOUSE_ID}'
      `)).then(() => this.databaseService.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
            WHERE c.conrelid = 'app_inventory_stock_balances'::regclass
              AND c.contype = 'p' AND a.attname = 'warehouse_id'
          ) THEN
            ALTER TABLE app_inventory_stock_balances DROP CONSTRAINT IF EXISTS app_inventory_stock_balances_pkey;
            ALTER TABLE app_inventory_stock_balances ADD CONSTRAINT app_inventory_stock_balances_pkey PRIMARY KEY (product_sku, warehouse_id);
          END IF;
        END $$;
      `)).then(() => undefined).catch((error: unknown) => {
        this.stockBalanceSchemaPromise = null;
        throw error;
      });
    }
    await this.stockBalanceSchemaPromise;
  }

  private async seedStockBalances(): Promise<void> {
    try {
      // Đồng bộ app_inventory_stock_balances từ bảng chuẩn inventories (chỉ cho các kho thực tế có tồn)
      await this.databaseService.query(`
        INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity)
        SELECT UPPER(p.sku), i.warehouse_id, i.on_hand
        FROM inventories i
        JOIN products p ON p.id = i.product_id
        ON CONFLICT (product_sku, warehouse_id) DO UPDATE
        SET physical_quantity = EXCLUDED.physical_quantity;
      `);
    } catch {}
  }

  async ensureAllWarehousesInventory(): Promise<void> {
    if (!this.databaseService?.isConnected()) {
      await this.databaseService?.ensureConnection?.();
    }
    if (!this.databaseService?.isConnected()) return;

    try {
      // Đảm bảo mọi sản phẩm đều có bản ghi cơ sở dữ liệu tồn kho riêng ở TẤT CẢ các kho đang hoạt động
      // Kho mới tạo hoặc sản phẩm mới tạo sẽ có on_hand = 0, allocated = 0, physical_quantity = 0
      await this.databaseService.query(`
        INSERT INTO inventories (warehouse_id, product_id, on_hand, allocated)
        SELECT w.id, p.id, 0, 0
        FROM warehouses w
        CROSS JOIN products p
        WHERE (w.status IS NULL OR w.status = 'ACTIVE')
        ON CONFLICT (warehouse_id, product_id) DO NOTHING;
      `);

      await this.databaseService.query(`
        INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity)
        SELECT UPPER(p.sku), w.id, 0
        FROM warehouses w
        CROSS JOIN products p
        WHERE (w.status IS NULL OR w.status = 'ACTIVE')
        ON CONFLICT (product_sku, warehouse_id) DO NOTHING;
      `);
    } catch (err) {
      console.warn('[INVENTORY_SERVICE] Lỗi đồng bộ cơ sở dữ liệu tồn kho các kho:', err);
    }
  }

  public async resolveWarehouseId(rawWh?: string): Promise<{ id: string; code: string; name: string } | null> {
    if (!rawWh || !rawWh.trim()) return null;
    const clean = rawWh.trim();
    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<{ id: string; code: string; name: string }>(
          `SELECT id, code, name FROM warehouses
           WHERE id::text = $1 OR code = $1 OR name = $1
              OR $1 ILIKE '%' || code || '%' OR $1 ILIKE '%' || name || '%'
           LIMIT 1`,
          [clean],
        );
        if (rows[0]) return rows[0];
      } catch {}
    }
    const standard = STANDARD_WAREHOUSES.find(
      (w) =>
        w.id === clean ||
        w.code.toLowerCase() === clean.toLowerCase() ||
        w.name.toLowerCase().includes(clean.toLowerCase()),
    );
    if (standard) {
      return { id: standard.id, code: standard.code, name: standard.name };
    }
    return null;
  }

  public async getAllActiveWarehouses(): Promise<Array<{ id: string; code: string; name: string }>> {
    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<{ id: string; code: string; name: string }>(
          `SELECT id, code, name FROM warehouses WHERE status IS NULL OR status = 'ACTIVE' ORDER BY code ASC`,
        );
        if (rows.length > 0) return rows;
      } catch {}
    }
    return STANDARD_WAREHOUSES.map((w) => ({ id: w.id, code: w.code, name: w.name }));
  }

  private getFallbackStockBalances(products: ProductEntity[], warehouseId: string): Map<string, number> {
    const result = new Map<string, number>();
    const cleanWhId = (warehouseId || '').toLowerCase().trim();

    if (cleanWhId === 'all' || !cleanWhId) {
      for (const p of products) {
        const skuUpper = p.sku.trim().toUpperCase();
        let total = 0;
        for (const whMap of this.memoryWarehouseBalances.values()) {
          total += whMap.get(skuUpper) ?? 0;
        }
        if (total === 0 && (p.stockQuantity ?? 0) > 0) {
          total = p.stockQuantity ?? 0;
        }
        result.set(skuUpper, total);
      }
      return result;
    }

    const whMap = this.memoryWarehouseBalances.get(cleanWhId);
    const isDefaultWh = cleanWhId === DEFAULT_WAREHOUSE_ID.toLowerCase() || cleanWhId.includes('0001') || cleanWhId.includes('kho-mn');

    for (const p of products) {
      const skuUpper = p.sku.trim().toUpperCase();
      let qty = whMap ? whMap.get(skuUpper) : undefined;

      if (qty === undefined) {
        if (isDefaultWh) {
          qty = p.stockQuantity ?? 0;
        } else {
          qty = Array.from(this.batches.values())
            .filter((b) => b.warehouseId.toLowerCase() === cleanWhId && b.productSku.toUpperCase() === skuUpper)
            .reduce((sum, b) => sum + b.quantity, 0);
        }
      }
      result.set(skuUpper, qty);
    }

    return result;
  }

  private async getStockBalances(products: ProductEntity[], warehouseId: string): Promise<Map<string, number>> {
    if (!this.databaseService?.isConnected()) {
      return this.getFallbackStockBalances(products, warehouseId);
    }
    await this.ensureStockBalanceTable();
    if (products.length === 0) return new Map();

    if (warehouseId === 'ALL') {
      try {
        const rows = await this.databaseService.query<{ product_sku: string; total_quantity: string }>(
          `SELECT UPPER(p.sku) as product_sku, COALESCE(SUM(CASE WHEN w.id IS NOT NULL THEN i.on_hand ELSE 0 END), 0)::text as total_quantity
           FROM products p
           LEFT JOIN inventories i ON i.product_id = p.id
           LEFT JOIN warehouses w ON w.id = i.warehouse_id AND (w.status IS NULL OR w.status = 'ACTIVE')
           WHERE UPPER(p.sku) = ANY($1::text[])
           GROUP BY p.sku;`,
          [products.map((p) => p.sku.toUpperCase())],
        );
        const map = new Map(rows.map((row) => [row.product_sku, Number(row.total_quantity)]));
        if (map.size === 0) return this.getFallbackStockBalances(products, warehouseId);
        return map;
      } catch {
        return this.getFallbackStockBalances(products, warehouseId);
      }
    }

    try {
      const rows = await this.databaseService.query<{ product_sku: string; physical_quantity: string }>(
        `SELECT UPPER(p.sku) as product_sku, COALESCE(i.on_hand, 0)::text as physical_quantity
         FROM inventories i
         JOIN products p ON i.product_id = p.id
         WHERE i.warehouse_id = $1::uuid
           AND UPPER(p.sku) = ANY($2::text[])`,
        [warehouseId, products.map((p) => p.sku.toUpperCase())],
      );
      const map = new Map(rows.map((row) => [row.product_sku, Number(row.physical_quantity)]));
      if (map.size === 0) {
        return this.getFallbackStockBalances(products, warehouseId);
      }
      return map;
    } catch {
      return this.getFallbackStockBalances(products, warehouseId);
    }
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
   * Helper: ghi một giao dịch vào sổ ledger (cả in-memory và bảng app_inventory_transactions trong PostgreSQL)
   */
  private writeLedger(tx: InventoryTransactionEntity): void {
    const bucket = this.ledger.get(tx.productId) ?? [];
    bucket.unshift(tx); // mới nhất lên đầu
    this.ledger.set(tx.productId, bucket);

    if (this.databaseService?.isConnected()) {
      this.saveTransactionToDb(tx).catch((err) => {
        console.warn('[INVENTORY_SERVICE] Lỗi lưu giao dịch thẻ kho vào PostgreSQL:', err?.message);
      });
    }
  }

  private async saveTransactionToDb(tx: InventoryTransactionEntity): Promise<void> {
    try {
      await this.ensureStockTransactionsTable();
      await this.databaseService.query(
        `INSERT INTO app_inventory_transactions (
          id, product_id, sku, product_name, transaction_type,
          input_quantity, input_unit, conversion_rate, base_quantity_change, base_unit,
          previous_stock, new_stock, reason, reference_code, warehouse, performed_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO NOTHING`,
        [
          tx.id,
          tx.productId,
          tx.sku,
          tx.productName,
          tx.transactionType,
          tx.inputQuantity,
          tx.inputUnit,
          tx.conversionRate,
          tx.baseQuantityChange,
          tx.baseUnit,
          tx.previousStock,
          tx.newStock,
          tx.reason,
          tx.referenceCode,
          tx.warehouse,
          tx.performedBy,
          tx.createdAt,
        ],
      );
    } catch (err: any) {
      console.warn('[INVENTORY_SERVICE] Không thể ghi thẻ kho vào PostgreSQL:', err?.message);
    }
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
   * Khởi tạo các giao dịch sổ kho mẫu phong phú phục vụ Thẻ kho (SN-185 & SN-23)
   */
  private seedInitialTransactions(): void {
    const now = Date.now();
    const day = 86400000;
    const hour = 3600000;
    const minute = 60000;

    const transactions: InventoryTransactionEntity[] = [
      // 1. LH-MILK-900G (Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g)
      new InventoryTransactionEntity({
        id: 'tx-seed-milk-01',
        productId: 'prod-001',
        sku: 'LH-MILK-900G',
        productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        transactionType: 'IMPORT',
        inputQuantity: 10,
        inputUnit: 'Thùng',
        conversionRate: 24,
        baseQuantityChange: 240,
        baseUnit: 'Lon',
        previousStock: 100,
        newStock: 340,
        reason: 'Nhập lô hàng mới từ Nhà máy Dược Loha',
        referenceCode: 'PNK-2026-0891',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Thủ kho Nguyễn Văn Kho',
        createdAt: new Date(now - day * 6 - hour * 2 - minute * 15),
      }),
      new InventoryTransactionEntity({
        id: 'tx-seed-milk-02',
        productId: 'prod-001',
        sku: 'LH-MILK-900G',
        productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        transactionType: 'ORDER',
        inputQuantity: -50,
        inputUnit: 'Lon',
        conversionRate: 1,
        baseQuantityChange: -50,
        baseUnit: 'Lon',
        previousStock: 340,
        newStock: 290,
        reason: 'Xuất bán đơn hàng đại lý #DH-2026-1002 (Đại lý Sữa Miền Nam)',
        referenceCode: 'DH-2026-1002',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Nhân viên kho Trần Văn Kho',
        createdAt: new Date(now - day * 4 - hour * 5 - minute * 40),
      }),
      new InventoryTransactionEntity({
        id: 'tx-seed-milk-03',
        productId: 'prod-001',
        sku: 'LH-MILK-900G',
        productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        transactionType: 'TRANSFER',
        inputQuantity: -30,
        inputUnit: 'Lon',
        conversionRate: 1,
        baseQuantityChange: -30,
        baseUnit: 'Lon',
        previousStock: 290,
        newStock: 260,
        reason: 'Điều chuyển nội bộ sang Kho Vận Hà Nội phục vụ thị trường phía Bắc',
        referenceCode: 'PCK-2026-0045',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Quản lý kho Đỗ Quốc Bảo',
        createdAt: new Date(now - day * 3 - hour * 1 - minute * 10),
      }),
      new InventoryTransactionEntity({
        id: 'tx-seed-milk-04',
        productId: 'prod-001',
        sku: 'LH-MILK-900G',
        productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        transactionType: 'ADJUSTMENT',
        inputQuantity: -2,
        inputUnit: 'Lon',
        conversionRate: 1,
        baseQuantityChange: -2,
        baseUnit: 'Lon',
        previousStock: 260,
        newStock: 258,
        reason: 'Điều chỉnh kiểm kê định kỳ: Hao hụt 2 lon do móp méo khi bốc xếp',
        referenceCode: 'PKK-20261008-001',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Quản lý kho Đỗ Quốc Bảo',
        createdAt: new Date(now - day * 2 - hour * 3 - minute * 25),
      }),
      new InventoryTransactionEntity({
        id: 'tx-seed-milk-05',
        productId: 'prod-001',
        sku: 'LH-MILK-900G',
        productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        transactionType: 'IMPORT',
        inputQuantity: 1242,
        inputUnit: 'Lon',
        conversionRate: 1,
        baseQuantityChange: 1242,
        baseUnit: 'Lon',
        previousStock: 258,
        newStock: 1500,
        reason: 'Nhập bổ sung lượng lớn theo hợp đồng cung ứng số HD-2026-44',
        referenceCode: 'PNK-2026-0905',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Thủ kho Nguyễn Văn Kho',
        createdAt: new Date(now - day * 1 - hour * 4 - minute * 5),
      }),

      // 2. LH-NUT-180ML (Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml)
      new InventoryTransactionEntity({
        id: 'tx-seed-nut-01',
        productId: 'prod-002',
        sku: 'LH-NUT-180ML',
        productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
        transactionType: 'IMPORT',
        inputQuantity: 25,
        inputUnit: 'Thùng',
        conversionRate: 48,
        baseQuantityChange: 1200,
        baseUnit: 'Hộp',
        previousStock: 0,
        newStock: 1200,
        reason: 'Nhập kho thành phẩm theo lệnh sản xuất #LSX-1102',
        referenceCode: 'PNK-2026-0892',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Thủ kho Nguyễn Văn Kho',
        createdAt: new Date(now - day * 5 - hour * 2 - minute * 20),
      }),
      new InventoryTransactionEntity({
        id: 'tx-seed-nut-02',
        productId: 'prod-002',
        sku: 'LH-NUT-180ML',
        productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
        transactionType: 'ORDER',
        inputQuantity: -120,
        inputUnit: 'Hộp',
        conversionRate: 1,
        baseQuantityChange: -120,
        baseUnit: 'Hộp',
        previousStock: 1200,
        newStock: 1080,
        reason: 'Xuất bán theo đơn hàng #DH-2026-1008 cho Chuỗi siêu thị Loha Mart',
        referenceCode: 'DH-2026-1008',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Nhân viên kho Trần Văn Kho',
        createdAt: new Date(now - day * 3 - hour * 4 - minute * 45),
      }),

      // 3. LH-BIRD-NEST (Yến Sào & Thực Phẩm Bổ Dưỡng)
      new InventoryTransactionEntity({
        id: 'tx-seed-bird-01',
        productId: 'prod-003',
        sku: 'LH-BIRD-NEST',
        productName: 'Tổ Yến Chưng Đông Trùng Hạ Thảo Cao Cấp 70ml',
        transactionType: 'IMPORT',
        inputQuantity: 600,
        inputUnit: 'Hũ',
        conversionRate: 1,
        baseQuantityChange: 600,
        baseUnit: 'Hũ',
        previousStock: 0,
        newStock: 600,
        reason: 'Nhập kho thành phẩm cao cấp từ Xưởng Yến Sào Nha Trang',
        referenceCode: 'PNK-2026-0895',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Thủ kho Nguyễn Văn Kho',
        createdAt: new Date(now - day * 4 - hour * 1 - minute * 30),
      }),
      new InventoryTransactionEntity({
        id: 'tx-seed-bird-02',
        productId: 'prod-003',
        sku: 'LH-BIRD-NEST',
        productName: 'Tổ Yến Chưng Đông Trùng Hạ Thảo Cao Cấp 70ml',
        transactionType: 'ORDER',
        inputQuantity: -20,
        inputUnit: 'Hũ',
        conversionRate: 1,
        baseQuantityChange: -20,
        baseUnit: 'Hũ',
        previousStock: 600,
        newStock: 580,
        reason: 'Xuất giao hàng đơn VIP #DH-2026-1015 (Đại lý Dinh Dưỡng An Tâm)',
        referenceCode: 'DH-2026-1015',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Nhân viên kho Trần Văn Kho',
        createdAt: new Date(now - day * 2 - hour * 5 - minute * 15),
      }),

      // 4. LH-COFFEE-250G (Cà Phê Rang Xay)
      new InventoryTransactionEntity({
        id: 'tx-seed-coffee-01',
        productId: 'prod-004',
        sku: 'LH-COFFEE-250G',
        productName: 'Cà Phê Rang Xay Nguyên Chất Robusta & Arabica 250g',
        transactionType: 'IMPORT',
        inputQuantity: 500,
        inputUnit: 'Gói',
        conversionRate: 1,
        baseQuantityChange: 500,
        baseUnit: 'Gói',
        previousStock: 0,
        newStock: 500,
        reason: 'Nhập lô cà phê thu hoạch mới từ Nông trại Buôn Ma Thuột',
        referenceCode: 'PNK-2026-0898',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Thủ kho Nguyễn Văn Kho',
        createdAt: new Date(now - day * 5 - hour * 3 - minute * 10),
      }),
      new InventoryTransactionEntity({
        id: 'tx-seed-coffee-02',
        productId: 'prod-004',
        sku: 'LH-COFFEE-250G',
        productName: 'Cà Phê Rang Xay Nguyên Chất Robusta & Arabica 250g',
        transactionType: 'TRANSFER',
        inputQuantity: -90,
        inputUnit: 'Gói',
        conversionRate: 1,
        baseQuantityChange: -90,
        baseUnit: 'Gói',
        previousStock: 500,
        newStock: 410,
        reason: 'Điều chuyển kho nội bộ sang Kho Trung Chuyển Đà Nẵng',
        referenceCode: 'PCK-2026-0048',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Quản lý kho Đỗ Quốc Bảo',
        createdAt: new Date(now - day * 2 - hour * 2 - minute * 50),
      }),

      // 5. LH-TEA-350ML (Trà Thảo Mộc)
      new InventoryTransactionEntity({
        id: 'tx-seed-tea-01',
        productId: 'prod-005',
        sku: 'LH-TEA-350ML',
        productName: 'Trà Thảo Mộc Hoa Cúc & Kỷ Tử Thanh Nhiệt 350ml',
        transactionType: 'IMPORT',
        inputQuantity: 300,
        inputUnit: 'Chai',
        conversionRate: 1,
        baseQuantityChange: 300,
        baseUnit: 'Chai',
        previousStock: 0,
        newStock: 300,
        reason: 'Nhập hàng đợt 1 từ Công ty Trà Thảo Dược Thiên Nhiên',
        referenceCode: 'PNK-2026-0901',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Thủ kho Nguyễn Văn Kho',
        createdAt: new Date(now - day * 4 - hour * 1 - minute * 35),
      }),
      new InventoryTransactionEntity({
        id: 'tx-seed-tea-02',
        productId: 'prod-005',
        sku: 'LH-TEA-350ML',
        productName: 'Trà Thảo Mộc Hoa Cúc & Kỷ Tử Thanh Nhiệt 350ml',
        transactionType: 'EXPORT',
        inputQuantity: -40,
        inputUnit: 'Chai',
        conversionRate: 1,
        baseQuantityChange: -40,
        baseUnit: 'Chai',
        previousStock: 300,
        newStock: 260,
        reason: 'Xuất mẫu thử nghiệm và giới thiệu sản phẩm tại Hội chợ Thương mại',
        referenceCode: 'PXK-2026-0015',
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: 'Nhân viên kho Trần Văn Kho',
        createdAt: new Date(now - day * 1 - hour * 5 - minute * 20),
      }),
    ];

    for (const tx of transactions) {
      this.writeLedger(tx);
    }
  }

  /**
   * Xem tổng quan sổ tồn kho minh bạch 3 cột (thực tế, tạm giữ, khả thi) theo SKU và từng kho (SN-10, SN-180)
   */
  getStockOverview(
    warehouseId: string,
    currentUser?: ICurrentUser,
  ): Promise<StockOverviewItem[]>;
  getStockOverview(
    query: {
      warehouse?: string;
      warehouseId?: string;
      category?: string;
      status?: string;
      search?: string;
      page: number;
      limit?: number;
    },
    currentUser?: ICurrentUser,
  ): Promise<{
    data: StockOverviewItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    summary: {
      totalPhysical: number;
      totalReserved: number;
      totalAvailable: number;
      lowStockCount: number;
      outOfStockCount: number;
      nearOutOfStockCount: number;
      totalSku: number;
    };
  }>;
  getStockOverview(
    query?: {
      warehouse?: string;
      warehouseId?: string;
      category?: string;
      status?: string;
      search?: string;
    },
    currentUser?: ICurrentUser,
  ): Promise<StockOverviewItem[]>;
  getStockOverview(
    query?: {
      warehouse?: string;
      warehouseId?: string;
      category?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    currentUser?: ICurrentUser,
  ): Promise<any>;
  async getStockOverview(
    query?: {
      warehouse?: string;
      warehouseId?: string;
      category?: string;
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    } | string,
    currentUser?: ICurrentUser,
  ): Promise<any> {
    const q = typeof query === 'string' ? { warehouseId: query } : query;
    const isUuid = (val?: string) =>
      Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim()));
    const rawWh = q?.warehouseId || q?.warehouse;

    const roles = currentUser?.roles || [];
    const isAdmin = roles.includes(UserRole.ADMIN);
    const isManager = roles.includes(UserRole.WAREHOUSE_MANAGER) || roles.includes(UserRole.WH_MANAGER as any) || isAdmin;
    const isKeeper = (roles.includes(UserRole.WAREHOUSE_KEEPER) || roles.includes(UserRole.WAREHOUSE as any)) && !isManager;

    let warehouseId = 'ALL';
    let warehouseName = 'Tất cả kho hàng';

    // Cho phép cả Thủ kho và Quản lý kho tra cứu toàn bộ mạng lưới kho ('ALL' hoặc kho chỉ định)
    if (rawWh && rawWh !== 'ALL') {
      const resolved = await this.resolveWarehouseId(rawWh);
      if (resolved) {
        warehouseId = resolved.id;
        warehouseName = `${resolved.name} - ${resolved.code}`;
      }
    } else if (rawWh === 'ALL') {
      warehouseId = 'ALL';
      warehouseName = 'Tất cả kho hàng';
    } else {
      // Mặc định khi không truyền bộ lọc kho: Thủ kho mở sẵn kho của mình, Quản lý / Admin mở Tất cả kho
      if (isKeeper) {
        let myWhId = currentUser?.warehouseId || currentUser?.warehouseCode || currentUser?.assignedWarehouse;
        if (!myWhId && currentUser?.userId && this.databaseService?.isConnected()) {
          try {
            const userWhRow = await this.databaseService.query<{ id: string }>(
              `SELECT id FROM warehouses WHERE manager_id = $1::uuid
               UNION
               SELECT warehouse_id FROM user_warehouses WHERE user_id = $1::uuid LIMIT 1`,
              [currentUser.userId],
            );
            if (userWhRow[0]?.id) myWhId = userWhRow[0].id;
          } catch {}
        }

        const resolved = myWhId ? await this.resolveWarehouseId(myWhId) : null;
        if (resolved) {
          warehouseId = resolved.id;
          warehouseName = `${resolved.name} - ${resolved.code}`;
        } else {
          warehouseId = 'ALL';
          warehouseName = 'Tất cả kho hàng';
        }
      } else {
        warehouseId = 'ALL';
        warehouseName = 'Tất cả kho hàng';
      }
    }

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
    const invAllocatedBySku = new Map<string, number>();

    if (this.databaseService?.isConnected()) {
      await this.ensureStockReservationsTable();
      physicalBalances = await this.getStockBalances(products, warehouseId);
      minLevels = await this.getMinStockLevelsFromDb(products, warehouseId);
      try {
        const invAllocQuery = warehouseId !== 'ALL'
          ? `SELECT UPPER(p.sku) as sku, COALESCE(i.allocated, 0)::text as allocated
             FROM inventories i
             JOIN products p ON i.product_id = p.id
             WHERE i.warehouse_id = $1::uuid`
          : `SELECT UPPER(p.sku) as sku, COALESCE(SUM(i.allocated), 0)::text as allocated
             FROM inventories i
             JOIN products p ON i.product_id = p.id
             JOIN warehouses w ON w.id = i.warehouse_id
             WHERE (w.status IS NULL OR w.status = 'ACTIVE')
             GROUP BY p.sku`;
        const invAllocRows = await this.databaseService.query<{ sku: string; allocated: string }>(
          invAllocQuery,
          warehouseId !== 'ALL' ? [warehouseId] : [],
        );
        for (const row of invAllocRows) {
          invAllocatedBySku.set(row.sku, Number(row.allocated) || 0);
        }
      } catch {}

      if (warehouseId !== 'ALL') {
        try {
          const warehouseRows = await this.databaseService.query<{ name: string; code: string }>(
            'SELECT name, code FROM warehouses WHERE id = $1::uuid',
            [warehouseId],
          );
          if (warehouseRows[0]?.name) {
            warehouseName = warehouseRows[0].code
              ? `${warehouseRows[0].name} - ${warehouseRows[0].code}`
              : warehouseRows[0].name;
          }
        } catch {
          // Ignore
        }
      } else {
        warehouseName = 'Tất cả kho hàng';
      }

      try {
        const resQuery = warehouseId !== 'ALL'
          ? `SELECT r.id, r.order_id, r.product_id, r.quantity::text,
                  r.expired_at::text, r.created_at::text,
                  COALESCE(o.order_code, o.id, r.order_id) as order_code,
                  COALESCE(o.payload->>'customerName', '') as customer_name,
                  COALESCE(o.payload->>'status', 'APPROVED') as order_status
           FROM stock_reservations r
           LEFT JOIN app_order_records o ON (o.id = r.order_id OR o.order_code = r.order_id)
           WHERE r.status IN ('ACTIVE', 'RESERVED') AND r.expired_at > CURRENT_TIMESTAMP
             AND (r.warehouse_id = $1 OR r.warehouse_id = $1::text)`
          : `SELECT r.id, r.order_id, r.product_id, r.quantity::text,
                  r.expired_at::text, r.created_at::text,
                  COALESCE(o.order_code, o.id, r.order_id) as order_code,
                  COALESCE(o.payload->>'customerName', '') as customer_name,
                  COALESCE(o.payload->>'status', 'APPROVED') as order_status
           FROM stock_reservations r
           LEFT JOIN app_order_records o ON (o.id = r.order_id OR o.order_code = r.order_id)
           WHERE r.status IN ('ACTIVE', 'RESERVED') AND r.expired_at > CURRENT_TIMESTAMP`;
        const resParams = warehouseId !== 'ALL' ? [warehouseId] : [];

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
        }>(resQuery, resParams);

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

        // Bổ sung các đơn hàng APPROVED/PROCESSING/PACKED từ app_order_records nếu chưa có trong stock_reservations
        const orderQuery = warehouseId !== 'ALL'
          ? `SELECT id, order_code,
                  COALESCE(payload->>'status', 'APPROVED') as order_status,
                  COALESCE(payload->>'customerName', '') as customer_name,
                  COALESCE(payload->'lines', '[]'::jsonb) as lines,
                  payload->>'reservedUntil' as reserved_until,
                  created_at::text
           FROM app_order_records
           WHERE payload->>'status' IN ('APPROVED', 'PROCESSING', 'PACKED')
             AND (payload->>'warehouseId' = $1 OR payload->>'warehouse_id' = $1)`
          : `SELECT id, order_code,
                  COALESCE(payload->>'status', 'APPROVED') as order_status,
                  COALESCE(payload->>'customerName', '') as customer_name,
                  COALESCE(payload->'lines', '[]'::jsonb) as lines,
                  payload->>'reservedUntil' as reserved_until,
                  created_at::text
           FROM app_order_records
           WHERE payload->>'status' IN ('APPROVED', 'PROCESSING', 'PACKED')`;

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
        }>(orderQuery, resParams);

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
          const legacyQuery = warehouseId !== 'ALL'
            ? `SELECT product_sku, COALESCE(SUM(base_quantity), 0)::text AS reserved, MAX(order_id) as order_id
               FROM app_order_inventory_reservations
               WHERE status = 'RESERVED' AND warehouse_id = $1::uuid
               GROUP BY product_sku`
            : `SELECT product_sku, COALESCE(SUM(base_quantity), 0)::text AS reserved, MAX(order_id) as order_id
               FROM app_order_inventory_reservations
               WHERE status = 'RESERVED'
               GROUP BY product_sku`;

          const legacyRows = await this.databaseService.query<{ product_sku: string; reserved: string; order_id?: string }>(
            legacyQuery,
            warehouseId !== 'ALL' ? [warehouseId] : [],
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
      physicalBalances = this.getFallbackStockBalances(products, warehouseId);
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

    // Toàn bộ sản phẩm trong danh mục luôn hiển thị cho kho được chọn (kho mới tạo hiển thị tồn = 0)
    const targetProducts = products;

    let items: StockOverviewItem[] = targetProducts.map((p) => {
      const pSkuUpper = p.sku.toUpperCase();
      const aliasSku = pSkuUpper === 'LH-MILK-POWDER-900G' ? 'LH-MILK-900G' : pSkuUpper === 'LH-MILK-900G' ? 'LH-MILK-POWDER-900G' : '';
      const physicalStockQuantity = warehouseId === 'ALL'
        ? (physicalBalances.get(pSkuUpper) ?? (aliasSku ? physicalBalances.get(aliasSku) : undefined) ?? p.stockQuantity ?? 0)
        : (physicalBalances.get(pSkuUpper) ?? (aliasSku ? physicalBalances.get(aliasSku) : undefined) ?? 0);
      const dbReserved = reservations.get(pSkuUpper) ?? (aliasSku ? reservations.get(aliasSku) : undefined) ?? 0;
      const invAllocated = invAllocatedBySku.get(pSkuUpper) ?? (aliasSku ? invAllocatedBySku.get(aliasSku) : undefined) ?? 0;

      // CÁCH LY CHẶT CHẼ TỒN TẠM GIỮ THEO TỪNG KHO:
      // Khi lọc theo kho cụ thể (warehouseId !== 'ALL'), chỉ lấy đúng lượng tạm giữ của kho đó (từ stock_reservations và inventories.allocated).
      // Tuyệt đối không fallback sang p.reservedStock (vốn là tổng tạm giữ của toàn bộ hệ thống).
      const reservedQuantity = warehouseId !== 'ALL'
        ? Math.max(dbReserved, invAllocated)
        : (this.databaseService?.isConnected() ? Math.max(dbReserved, invAllocated) : Math.max(dbReserved, p.reservedStock ?? 0));
      const available = Math.max(0, physicalStockQuantity - reservedQuantity);
      const matchedReservations = reservationsListBySku.get(pSkuUpper) || (aliasSku ? reservationsListBySku.get(aliasSku) : []) || [];
      const minStockLevel = minLevels.get(p.sku.trim().toUpperCase()) ?? (this.minStockLevels.get(p.sku.trim().toUpperCase()) ?? 0);
      const isBelowMinStock = minStockLevel > 0 && available <= minStockLevel;

      let status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' = 'IN_STOCK';
      if (available <= 0) {
        status = 'OUT_OF_STOCK';
      } else if (available <= 10 || isBelowMinStock) {
        status = 'LOW_STOCK';
      }

      return {
        id: p.id,
        productId: p.id,
        sku: p.sku,
        name: p.name,
        productName: p.name,
        category: p.category || `${p.parentCategory || ''} / ${p.subCategory || ''}`,
        parentCategory: p.parentCategory || 'Sữa & Chế phẩm sữa',
        subCategory: p.subCategory || '',
        physicalStock: physicalStockQuantity,
        physicalStockQuantity,
        physicalQuantity: physicalStockQuantity,
        reservedStock: reservedQuantity,
        reservedQuantity,
        availableStock: available,
        availableQuantity: available,
        stockQuantity: available,
        baseUnit: p.baseUnit,
        units: (p.units || []).map((u) => ({
          unitName: u.unitName,
          conversionRate: u.conversionRate,
          isBaseUnit: u.isBaseUnit,
        })),
        warehouse: warehouseName,
        warehouseId,
        minStockLevel,
        isBelowMinStock,
        status,
        imageUrl: p.imageUrl,
        activeReservations: matchedReservations,
      };
    });

    if (q?.search) {
      const searchLower = q.search.trim().toLowerCase();
      items = items.filter(
        (i) => i.sku.toLowerCase().includes(searchLower) || i.name.toLowerCase().includes(searchLower),
      );
    }

    if (q?.category && q.category !== 'ALL') {
      items = items.filter(
        (i) =>
          i.category.includes(q.category!) ||
          i.parentCategory === q.category ||
          i.subCategory === q.category,
      );
    }

    if (q?.status && q.status !== 'ALL') {
      if (q.status === 'DAMAGED' || q.status === 'DAMAGED_STOCK') {
        // Chỉ hiển thị các sản phẩm lỗi tồn kho riêng (damaged_stock_balances)
        let damagedRows: any[] = [];
        if (this.databaseService?.isConnected()) {
          try {
            const sql = `
              SELECT d.id, d.warehouse_id, d.product_id, d.product_sku, d.batch_number,
                     d.quantity as damaged_quantity, d.updated_at,
                     w.name as warehouse_name, w.code as warehouse_code,
                     p.name as product_name, p.base_unit as unit, c.name as category, p.image_url,
                     b.expiry_date, b.mfg_date
              FROM damaged_stock_balances d
              LEFT JOIN warehouses w ON (w.id::text = d.warehouse_id OR w.code = d.warehouse_id)
              LEFT JOIN products p ON (p.id::text = d.product_id OR UPPER(p.sku) = UPPER(d.product_sku))
              LEFT JOIN categories c ON c.id = p.category_id
              LEFT JOIN LATERAL (
                SELECT expiry_date, mfg_date
                FROM inventory_batches ib
                WHERE (ib.batch_number = d.batch_number OR ib.batch_no = d.batch_number)
                  AND d.batch_number IS NOT NULL AND d.batch_number <> ''
                ORDER BY ib.created_at DESC
                LIMIT 1
              ) b ON true
              WHERE d.quantity > 0;
            `;
            damagedRows = await this.databaseService.query<any>(sql);
          } catch (e: any) {
            this.logger.warn(`Lỗi query damaged_stock_balances: ${e.message}`);
          }
        }

        let damagedItems: StockOverviewItem[] = damagedRows.map((r) => {
          const qty = Number(r.damaged_quantity || 0);
          return {
            id: `damaged-${r.id || r.product_sku}-${r.warehouse_id}`,
            productId: r.product_id,
            sku: r.product_sku,
            name: r.product_name || r.product_sku,
            productName: r.product_name || r.product_sku,
            category: r.category || 'Hàng lỗi',
            parentCategory: 'Hàng lỗi',
            subCategory: '',
            warehouse: r.warehouse_name || 'Kho hàng',
            warehouseId: r.warehouse_id,
            warehouseCode: r.warehouse_code,
            physicalStock: qty,
            physicalStockQuantity: qty,
            physicalQuantity: qty,
            stockQuantity: qty,
            reservedStock: 0,
            reservedQuantity: 0,
            availableStock: 0,
            availableQuantity: 0,
            status: 'DAMAGED' as any,
            damagedStock: qty,
            damagedQuantity: qty,
            batchNumber: r.batch_number || '',
            expiryDate: r.expiry_date ? new Date(r.expiry_date).toISOString() : undefined,
            mfgDate: r.mfg_date ? new Date(r.mfg_date).toISOString() : undefined,
            baseUnit: r.unit || 'Chai',
            unit: r.unit || 'Chai',
            units: [{ unitName: r.unit || 'Chai', conversionRate: 1, isBaseUnit: true }],
            activeReservations: [],
            minStockLevel: 0,
            updatedAt: r.updated_at ? new Date(r.updated_at) : new Date(),
          };
        });

        // Lọc theo kho hàng nếu có
        if (warehouseId !== 'ALL' || (q?.warehouse && q.warehouse !== 'ALL')) {
          const targetWh = (warehouseId !== 'ALL' ? warehouseId : q?.warehouse || '').toLowerCase();
          damagedItems = damagedItems.filter((i) => {
            return (
              i.warehouseId?.toLowerCase() === targetWh ||
              i.warehouseCode?.toLowerCase() === targetWh ||
              i.warehouse?.toLowerCase().includes(targetWh)
            );
          });
        }

        // Lọc theo tìm kiếm
        if (q?.search && q.search.trim()) {
          const s = q.search.trim().toLowerCase();
          damagedItems = damagedItems.filter(
            (i) => i.sku.toLowerCase().includes(s) || i.name.toLowerCase().includes(s),
          );
        }

        items = damagedItems;
      } else if (q.status === 'BELOW_MIN_STOCK') {
        if (warehouseId === 'ALL') {
          // Khi cùng chọn bộ lọc "Tất cả kho hàng" và "Dưới tồn tối thiểu":
          // Hiển thị toàn bộ các sản phẩm đang bị cảnh báo được cộng dồn từ tất cả các kho khác đang có trên hệ thống!
          const allAlerts = await this.getLowStockAlerts('ALL', currentUser);
          let alertItems: StockOverviewItem[] = allAlerts.map((a) => {
            const anyAlert = a as any;
            const avail = a.stockQuantity ?? a.availableQuantity ?? anyAlert.availableStock ?? 0;
            return {
              ...a,
              id: anyAlert.id || a.productId || a.sku,
              category: anyAlert.category || 'Sữa & Chế phẩm sữa',
              parentCategory: anyAlert.parentCategory || 'Sữa & Chế phẩm sữa',
              subCategory: anyAlert.subCategory || '',
              physicalStock: anyAlert.physicalStock ?? a.physicalStockQuantity ?? a.physicalQuantity ?? 0,
              reservedStock: anyAlert.reservedStock ?? a.reservedQuantity ?? 0,
              availableStock: avail,
              status: avail <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
              imageUrl: anyAlert.imageUrl,
            };
          });

          if (q?.search) {
            const searchLower = q.search.trim().toLowerCase();
            alertItems = alertItems.filter(
              (i) => i.sku.toLowerCase().includes(searchLower) || i.name.toLowerCase().includes(searchLower),
            );
          }

          if (q?.category && q.category !== 'ALL') {
            alertItems = alertItems.filter(
              (i) =>
                i.category.includes(q.category!) ||
                i.parentCategory === q.category ||
                i.subCategory === q.category,
            );
          }

          items = alertItems;
        } else {
          items = items.filter(
            (i) => i.isBelowMinStock || ((i.minStockLevel ?? 0) > 0 && i.availableStock <= (i.minStockLevel ?? 0)),
          );
        }
      } else {
        items = items.filter((i) => i.status === q.status);
      }
    }

    if (q?.status !== 'DAMAGED' && q?.warehouse && q.warehouse !== 'ALL' && warehouseId !== 'ALL') {
      const qWhLower = q.warehouse.toLowerCase();
      items = items.filter(
        (i) =>
          i.warehouseId === warehouseId ||
          i.warehouseId === q.warehouse ||
          i.warehouse?.toLowerCase().includes(qWhLower),
      );
    }

    // Nếu có tham số phân trang page hoặc limit: trả về cấu trúc phân trang kèm summary tổng quan
    if (q && (q.page !== undefined || q.limit !== undefined)) {
      const page = Math.max(1, Number(q.page) || 1);
      const limit = Math.max(1, Number(q.limit) || 10);
      const total = items.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const paginatedData = items.slice((page - 1) * limit, page * limit);

      let totalPhysical = 0;
      let totalReserved = 0;
      let totalAvailable = 0;
      let lowStockCount = 0;
      let outOfStockCount = 0;
      let nearOutOfStockCount = 0;

      for (const item of items) {
        totalPhysical += item.physicalStock;
        totalReserved += item.reservedStock;
        totalAvailable += item.availableStock;
        if (item.status === 'LOW_STOCK') lowStockCount++;
        if (item.status === 'OUT_OF_STOCK') outOfStockCount++;
        const isNearOutOfStock =
          item.availableStock > 0 &&
          (item.status === 'LOW_STOCK' ||
            Boolean(item.isBelowMinStock) ||
            ((item.minStockLevel || 0) > 0 && item.availableStock <= (item.minStockLevel || 0)));
        if (isNearOutOfStock) nearOutOfStockCount++;
      }

      return {
        data: paginatedData,
        total,
        page,
        limit,
        totalPages,
        summary: {
          totalPhysical,
          totalReserved,
          totalAvailable,
          lowStockCount,
          outOfStockCount,
          nearOutOfStockCount,
          totalSku: total,
        },
      };
    }

    return items;
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

    if (warehouseId === 'ALL') {
      try {
        const rows = await this.databaseService.query<{ product_sku: string; min_stock_level: string | null }>(
          `SELECT product_sku, COALESCE(MAX(min_stock_level), 0)::text AS min_stock_level
           FROM app_inventory_stock_balances
           WHERE product_sku = ANY($1::text[])
           GROUP BY product_sku`,
          [products.map((product) => product.sku.trim().toUpperCase())],
        );
        return new Map(rows.map((row) => [row.product_sku, Number(row.min_stock_level ?? 0)]));
      } catch {
        return new Map();
      }
    }

    const resolved = await this.resolveWarehouseId(warehouseId);
    const targetWhId = resolved ? resolved.id : DEFAULT_WAREHOUSE_ID;

    const rows = await this.databaseService.query<{ product_sku: string; min_stock_level: string | null }>(
      `SELECT product_sku, COALESCE(min_stock_level, 0)::text AS min_stock_level
       FROM app_inventory_stock_balances
       WHERE product_sku = ANY($1::text[]) AND warehouse_id = $2::uuid`,
      [products.map((product) => product.sku.trim().toUpperCase()), targetWhId],
    );
    return new Map(rows.map((row) => [row.product_sku, Number(row.min_stock_level ?? 0)]));
  }

  /**
   * Khai báo mức tồn tối thiểu theo SKU tại kho (SN-183).
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

    if (warehouseId === 'ALL') {
      throw new BadRequestException(
        'Mức tồn tối thiểu được quản lý gắn vào từng kho cụ thể. Vui lòng chọn một kho cụ thể để thiết lập mức tồn tối thiểu.',
      );
    }

    if (this.databaseService.isConnected()) {
      await this.ensureStockBalanceTable();
      const resolved = await this.resolveWarehouseId(warehouseId);
      const targetWhId = resolved ? resolved.id : DEFAULT_WAREHOUSE_ID;
      await this.databaseService.query(
        `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity, min_stock_level)
         VALUES ($1, $4::uuid, $2, $3)
         ON CONFLICT (product_sku, warehouse_id)
         DO UPDATE SET min_stock_level = EXCLUDED.min_stock_level, updated_at = CURRENT_TIMESTAMP`,
        [productSku, targetWhId === DEFAULT_WAREHOUSE_ID ? product.stockQuantity ?? 0 : 0, level, targetWhId],
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
  async getLowStockAlerts(warehouseId?: string, currentUser?: ICurrentUser): Promise<LowStockAlert[]> {
    const roles = currentUser?.roles || [];
    const isWarehouseStaff = roles.some((r) =>
      ['WAREHOUSE_MANAGER', 'WAREHOUSE_KEEPER', 'WAREHOUSE', 'WH_MANAGER'].includes(String(r)),
    ) && !roles.includes(UserRole.ADMIN);

    const effectiveWh = isWarehouseStaff
      ? (currentUser?.warehouseId || warehouseId)
      : warehouseId;

    if (effectiveWh && effectiveWh !== 'ALL') {
      const balances = await this.getStockOverview(effectiveWh, currentUser);
      const targetWarehouse = effectiveWh.trim().toUpperCase();
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

    // Khi ở bộ lọc "Tất cả kho hàng" (hoặc không chỉ định kho):
    // Cộng dồn toàn bộ cảnh báo đứt hàng của các bộ lọc kho thực tế (Miền Bắc, Miền Trung, Miền Nam, Miền Tây, và bất kỳ kho mới nào tạo sau này).
    // Xây dựng mở động từ bảng warehouses; lưu ý tuyệt đối không cộng thêm cảnh báo của bộ lọc "tất cả các kho".
    const activeWarehouses = await this.getAllActiveWarehouses();
    const alerts: LowStockAlert[] = [];

    for (const wh of activeWarehouses) {
      try {
        const whBalances = await this.getStockOverview(wh.id, currentUser);
        const whAlerts = whBalances
          .filter((row) => (row.minStockLevel ?? 0) > 0 && row.stockQuantity <= (row.minStockLevel ?? 0))
          .map((row): LowStockAlert => {
            const minStockLevel = row.minStockLevel ?? 0;
            return {
              ...row,
              warehouseId: wh.id,
              warehouse: wh.name,
              minStockLevel,
              isBelowMinStock: true,
              shortage: minStockLevel - row.stockQuantity,
            };
          });
        alerts.push(...whAlerts);
      } catch {
        // Bỏ qua lỗi từng kho lẻ
      }
    }

    return alerts.sort((a, b) => b.shortage - a.shortage);
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
    currentUserOrId: ICurrentUser | string,
  ): Promise<StockAdjustmentResult> {
    const productLookup = await this.productsService.findById(dto.productSku);
    const releaseLock = await this.acquireLock(productLookup.id);
    try {
      const product = await this.productsService.findById(dto.productSku);
      return await this.adjustStockLocked(product, dto, currentUserOrId);
    } finally {
      releaseLock();
    }
  }

  private async adjustStockLocked(
    product: ProductEntity,
    dto: AdjustStockDto,
    currentUserOrId: ICurrentUser | string,
  ): Promise<StockAdjustmentResult> {
    const rawWh = dto.warehouseId || (dto as any).warehouse_id || DEFAULT_WAREHOUSE_ID;

    const resolvedWh = await this.resolveWarehouseId(rawWh);
    if (!resolvedWh) {
      throw new NotFoundException(`Không tìm thấy thông tin kho hàng: "${rawWh}"`);
    }

    const warehouseId = resolvedWh.id;
    const warehouseCode = resolvedWh.code;
    const warehouseName = resolvedWh.name;

    // Kiểm tra phân quyền kho cho user
    if (typeof currentUserOrId === 'object' && currentUserOrId !== null) {
      const user = currentUserOrId as ICurrentUser;
      const roles = user.roles || [];
      const isAdmin = roles.includes(UserRole.ADMIN);

      const isManager = roles.includes(UserRole.WAREHOUSE_MANAGER) || roles.includes(UserRole.WH_MANAGER as any) || isAdmin;
      const isKeeper = (roles.includes(UserRole.WAREHOUSE_KEEPER) || roles.includes(UserRole.WAREHOUSE as any)) && !isManager;

      if (isKeeper) {
        // QUAN HỆ 1 - 1: Thủ kho chỉ được tác nghiệp điều chỉnh tồn kho đúng kho của mình
        let userWhId = user.warehouseId || user.warehouseCode;
        if (!userWhId && user.userId && this.databaseService?.isConnected()) {
          try {
            const row = await this.databaseService.query<{ id: string }>(
              `SELECT id FROM warehouses WHERE manager_id = $1::uuid
               UNION
               SELECT warehouse_id FROM user_warehouses WHERE user_id = $1::uuid LIMIT 1`,
              [user.userId],
            );
            if (row[0]?.id) userWhId = row[0].id;
          } catch {}
        }
        if (userWhId && warehouseId !== userWhId && warehouseCode !== userWhId) {
          throw new ForbiddenException(
            `Thủ kho chỉ có quyền tác nghiệp điều chỉnh tồn kho tại kho được phân công trực tiếp (${user.warehouseCode || user.warehouseId}).`,
          );
        }
      }
    }

    const userId =
      typeof currentUserOrId === 'string'
        ? currentUserOrId
        : (currentUserOrId.userId || currentUserOrId.username || 'unknown');

    dto.warehouseId = warehouseId;
    dto.warehouseLocation = `${warehouseName} - ${warehouseCode}`;

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

      // 1. Lấy tồn kho hiện tại của kho được chọn
      const currentWhInv = await client.query<{ on_hand: string }>(
        `SELECT on_hand::text FROM inventories WHERE product_id = $1 AND warehouse_id = $2::uuid FOR UPDATE`,
        [product.id, warehouseId],
      );
      previousQuantity = currentWhInv.rows[0] ? Number(currentWhInv.rows[0].on_hand) : 0;

      // 2. Validate xuất kho
      await this.validateStockAdjustment(client, product, dto, baseQuantityChange, previousQuantity);

      newQuantity = previousQuantity + baseQuantityChange;

      // 3. Lệnh SQL thực hiện UPDATE inventories SET on_hand = on_hand + quantity WHERE product_id = ... AND warehouse_id = ...
      const updateInvResult = await client.query(
        `UPDATE inventories
         SET on_hand = GREATEST(0, on_hand + $3), updated_at = CURRENT_TIMESTAMP
         WHERE product_id = $1 AND warehouse_id = $2::uuid`,
        [product.id, warehouseId, baseQuantityChange],
      );
      if (updateInvResult.rowCount === 0) {
        await client.query(
          `INSERT INTO inventories (product_id, warehouse_id, on_hand, allocated)
           VALUES ($1, $2::uuid, GREATEST(0, $3), 0)`,
          [product.id, warehouseId, baseQuantityChange],
        );
      }

      // 4. Đồng bộ app_inventory_stock_balances
      const updateBalResult = await client.query(
        `UPDATE app_inventory_stock_balances
         SET physical_quantity = GREATEST(0, physical_quantity + $3), updated_at = CURRENT_TIMESTAMP
         WHERE product_sku = $1 AND warehouse_id = $2::uuid`,
        [product.sku.toUpperCase(), warehouseId, baseQuantityChange],
      );
      if (updateBalResult.rowCount === 0) {
        await client.query(
          `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity)
           VALUES ($1, $2::uuid, GREATEST(0, $3))`,
          [product.sku.toUpperCase(), warehouseId, baseQuantityChange],
        );
      }

      // 5. Cập nhật lại tổng tồn chung của sản phẩm trên toàn bộ các kho đang hoạt động
      const totalRes = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(i.on_hand), 0)::text as total
         FROM inventories i
         JOIN warehouses w ON w.id = i.warehouse_id
         WHERE i.product_id = $1 AND (w.status IS NULL OR w.status = 'ACTIVE')`,
        [product.id],
      );
      const totalOverallStock = Number(totalRes.rows[0]?.total ?? newQuantity);

      await this.consumeOrderReservation(client, product.sku, dto.referenceCode, baseQuantityChange);

      transaction = this.createInventoryTransaction(
        product, dto, userId, conversion.unitName, conversion.conversionRate,
        baseQuantityChange, previousQuantity, newQuantity,
      );

      await client.query('COMMIT');

      // 6. Cập nhật tổng tồn trên productsService
      await this.productsService.setStockQuantity(product.id, totalOverallStock);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
   * Truy vấn sổ kho và lịch sử biến động giao dịch (SN-185: Thẻ kho hàng hóa)
   */
  async getTransactions(
    queryOrSku?: string | {
      sku?: string;
      warehouse?: string;
      startDate?: string;
      endDate?: string;
      type?: string;
      search?: string;
      limit?: number;
    },
    limitParam?: number,
  ): Promise<InventoryTransactionEntity[]> {
    const q = typeof queryOrSku === 'string' ? { sku: queryOrSku, limit: limitParam } : (queryOrSku || {});
    const sku = q.sku;
    const warehouse = q.warehouse;
    const startDate = q.startDate;
    const endDate = q.endDate;
    const type = q.type;
    const search = q.search;
    const limit = q.limit;

    // Ưu tiên 1: Đọc dữ liệu thật từ bảng app_inventory_transactions trong PostgreSQL nếu DB kết nối
    if (this.databaseService?.isConnected()) {
      try {
        await this.ensureStockTransactionsTable();
        const conditions: string[] = [];
        const params: any[] = [];
        let paramIdx = 1;

        if (sku && sku.trim() !== '') {
          const cleanSku = sku.trim().toUpperCase();
          if (cleanSku === 'LH-MILK-900G') {
            conditions.push(`(UPPER(sku) = $${paramIdx} OR UPPER(sku) = 'LH-MILK-POWDER-900G')`);
          } else if (cleanSku === 'LH-TEA-240ML') {
            conditions.push(`(UPPER(sku) = $${paramIdx} OR UPPER(sku) = 'LH-TEA-350ML')`);
          } else {
            conditions.push(`UPPER(sku) = $${paramIdx}`);
          }
          params.push(cleanSku);
          paramIdx++;
        }

        if (warehouse && warehouse.trim() !== '' && warehouse.toUpperCase() !== 'ALL') {
          const cleanWh = warehouse.trim().toLowerCase();
          if (cleanWh.includes('nam') || cleanWh.includes('mn') || cleanWh.includes('wh01') || cleanWh.includes('hồ chí minh')) {
            conditions.push(`(LOWER(warehouse) LIKE '%nam%' OR LOWER(warehouse) LIKE '%wh01%' OR LOWER(warehouse) LIKE '%hồ chí minh%')`);
          } else if (cleanWh.includes('bắc') || cleanWh.includes('bac') || cleanWh.includes('mb') || cleanWh.includes('wh02') || cleanWh.includes('hà nội')) {
            conditions.push(`(LOWER(warehouse) LIKE '%bắc%' OR LOWER(warehouse) LIKE '%wh02%' OR LOWER(warehouse) LIKE '%hà nội%')`);
          } else if (cleanWh.includes('trung') || cleanWh.includes('mt') || cleanWh.includes('wh03') || cleanWh.includes('đà nẵng')) {
            conditions.push(`(LOWER(warehouse) LIKE '%trung%' OR LOWER(warehouse) LIKE '%wh03%' OR LOWER(warehouse) LIKE '%đà nẵng%')`);
          } else if (cleanWh.includes('tây') || cleanWh.includes('tay') || cleanWh.includes('west') || cleanWh.includes('cần thơ')) {
            conditions.push(`(LOWER(warehouse) LIKE '%tây%' OR LOWER(warehouse) LIKE '%west%' OR LOWER(warehouse) LIKE '%cần thơ%')`);
          } else {
            conditions.push(`LOWER(warehouse) LIKE $${paramIdx}`);
            params.push(`%${cleanWh}%`);
            paramIdx++;
          }
        }

        if (type && type.trim() !== '' && type.toUpperCase() !== 'ALL') {
          conditions.push(`UPPER(transaction_type) = $${paramIdx}`);
          params.push(type.trim().toUpperCase());
          paramIdx++;
        }

        if (startDate && startDate.trim() !== '') {
          const start = new Date(startDate);
          if (!isNaN(start.getTime())) {
            start.setHours(0, 0, 0, 0);
            conditions.push(`created_at >= $${paramIdx}`);
            params.push(start);
            paramIdx++;
          }
        }

        if (endDate && endDate.trim() !== '') {
          const end = new Date(endDate);
          if (!isNaN(end.getTime())) {
            end.setHours(23, 59, 59, 999);
            conditions.push(`created_at <= $${paramIdx}`);
            params.push(end);
            paramIdx++;
          }
        }

        if (search && search.trim() !== '') {
          const s = `%${search.trim().toLowerCase()}%`;
          conditions.push(`(
            LOWER(reference_code) LIKE $${paramIdx} OR
            LOWER(product_name) LIKE $${paramIdx} OR
            LOWER(sku) LIKE $${paramIdx} OR
            LOWER(reason) LIKE $${paramIdx} OR
            LOWER(performed_by) LIKE $${paramIdx}
          )`);
          params.push(s);
          paramIdx++;
        }

        const max = limit && limit > 0 ? Number(limit) : 500;
        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const sql = `
          SELECT id, product_id, sku, product_name, transaction_type,
                 input_quantity, input_unit, conversion_rate, base_quantity_change, base_unit,
                 previous_stock, new_stock, reason, reference_code, warehouse, performed_by, created_at
          FROM app_inventory_transactions
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT ${max}
        `;

        const rows = await this.databaseService.query<any>(sql, params);
        if (rows && rows.length > 0) {
          return rows.map((r) => new InventoryTransactionEntity({
            id: r.id,
            productId: r.product_id,
            sku: r.sku,
            productName: r.product_name,
            transactionType: r.transaction_type,
            inputQuantity: Number(r.input_quantity),
            inputUnit: r.input_unit,
            conversionRate: Number(r.conversion_rate),
            baseQuantityChange: Number(r.base_quantity_change),
            baseUnit: r.base_unit,
            previousStock: Number(r.previous_stock),
            newStock: Number(r.new_stock),
            reason: r.reason,
            referenceCode: r.reference_code,
            warehouse: r.warehouse,
            performedBy: r.performed_by,
            createdAt: new Date(r.created_at),
          }));
        }
      } catch (err: any) {
        console.warn(`[INVENTORY_SERVICE] Query app_inventory_transactions thất bại, fallback in-memory: ${err?.message}`);
      }
    }

    // Ưu tiên 2: Fallback in-memory an toàn khi DB chưa có hoặc đang khởi động
    let list: InventoryTransactionEntity[] = [];
    for (const bucket of this.ledger.values()) {
      list = list.concat(bucket);
    }
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (sku && sku.trim() !== '') {
      const cleanSku = sku.trim().toUpperCase();
      list = list.filter((t) => {
        const tSku = t.sku.toUpperCase();
        if (tSku === cleanSku) return true;
        if (cleanSku === 'LH-MILK-900G' && tSku === 'LH-MILK-POWDER-900G') return true;
        if (cleanSku === 'LH-TEA-240ML' && tSku === 'LH-TEA-350ML') return true;
        return false;
      });
    }

    if (warehouse && warehouse.trim() !== '' && warehouse.toUpperCase() !== 'ALL') {
      const cleanWh = warehouse.trim().toLowerCase();
      list = list.filter((t) => {
        const tWh = (t.warehouse || '').toLowerCase();
        if (tWh.includes(cleanWh) || cleanWh.includes(tWh)) return true;
        const isSouth = (s: string) => s.includes('nam') || s.includes('mn') || s.includes('wh01') || s.includes('hồ chí minh');
        const isNorth = (s: string) => s.includes('bắc') || s.includes('bac') || s.includes('mb') || s.includes('wh02') || s.includes('hà nội');
        const isCentral = (s: string) => s.includes('trung') || s.includes('mt') || s.includes('wh03') || s.includes('đà nẵng');
        const isWest = (s: string) => s.includes('tây') || s.includes('tay') || s.includes('west') || s.includes('cần thơ');
        if (isSouth(cleanWh) && isSouth(tWh)) return true;
        if (isNorth(cleanWh) && isNorth(tWh)) return true;
        if (isCentral(cleanWh) && isCentral(tWh)) return true;
        if (isWest(cleanWh) && isWest(tWh)) return true;
        return false;
      });
    }

    if (type && type.trim() !== '' && type.toUpperCase() !== 'ALL') {
      const cleanType = type.trim().toUpperCase();
      list = list.filter((t) => (t.transactionType || t.type) === cleanType);
    }

    if (startDate && startDate.trim() !== '') {
      const start = new Date(startDate);
      if (!isNaN(start.getTime())) {
        start.setHours(0, 0, 0, 0);
        list = list.filter((t) => new Date(t.createdAt).getTime() >= start.getTime());
      }
    }

    if (endDate && endDate.trim() !== '') {
      const end = new Date(endDate);
      if (!isNaN(end.getTime())) {
        end.setHours(23, 59, 59, 999);
        list = list.filter((t) => new Date(t.createdAt).getTime() <= end.getTime());
      }
    }

    if (search && search.trim() !== '') {
      const s = search.trim().toLowerCase();
      list = list.filter((t) =>
        (t.referenceCode || '').toLowerCase().includes(s) ||
        (t.productName || '').toLowerCase().includes(s) ||
        (t.sku || '').toLowerCase().includes(s) ||
        (t.reason || '').toLowerCase().includes(s) ||
        (t.performedBy || '').toLowerCase().includes(s)
      );
    }

    const max = limit && limit > 0 ? Number(limit) : 500;
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
  async getAudits(query?: QueryAuditsDto, currentUser?: ICurrentUser): Promise<InventoryAuditEntity[]> {
    let list = Array.from(this.audits.values());

    const roles = currentUser?.roles || [];
    const isWarehouseStaff = roles.some((r) =>
      ['WAREHOUSE_MANAGER', 'WAREHOUSE_KEEPER', 'WAREHOUSE', 'WH_MANAGER'].includes(String(r)),
    ) && !roles.includes(UserRole.ADMIN);

    if (isWarehouseStaff) {
      const staffWhId = currentUser?.warehouseId;
      const staffWhName = (currentUser?.assignedWarehouse || currentUser?.warehouseName || '').toLowerCase();
      list = list.filter((a) => {
        if (staffWhId && a.warehouseId && a.warehouseId.toLowerCase() === staffWhId.toLowerCase()) {
          return true;
        }
        if (staffWhName) {
          const aWhName = (a.warehouseName || '').toLowerCase();
          return (
            aWhName.includes(staffWhName) ||
            staffWhName.includes(aWhName) ||
            (a.warehouseId && staffWhName.includes(a.warehouseId.toLowerCase()))
          );
        }
        return false;
      });
    }

    if (query?.status) {
      const statusUpper = query.status.trim().toUpperCase();
      list = list.filter((a) => a.status.toUpperCase() === statusUpper);
    }

    if (query?.warehouseId && !isWarehouseStaff) {
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

  // =========================================================================
  // QUẢN LÝ LÔ HÀNG & HẠN SỬ DỤNG THEO CHUẨN FEFO (SN-184 / EP-SN-229)
  // =========================================================================

  /**
   * Khởi tạo dữ liệu mẫu các lô hàng với nhiều trạng thái:
   * Hợp lệ, Sắp hết hạn (cận hạn), Đã quá hạn để phục vụ kiểm thử và offline fallback
   */
  private seedInitialBatches(): void {
    const addDays = (days: number): string => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().split('T')[0];
    };

    const initialBatches: Array<Partial<InventoryBatchEntity> & Record<string, unknown>> = [
      {
        id: '66666666-0000-0000-0000-000000000011',
        batchNumber: 'LOT-202610-A',
        productId: '33333333-0000-0000-0000-000000000001',
        productSku: 'LH-MILK-900G',
        productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        categoryName: 'Sữa & Chế phẩm sữa',
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
        baseUnit: 'Lon',
        mfgDate: '2026-09-01',
        expiryDate: '2027-09-01',
        quantity: 240,
        allocatedQuantity: 0,
        costPrice: 520000 / 24,
      },
      {
        id: '66666666-0000-0000-0000-000000000003',
        batchNumber: 'LOT-MILK-2026-NEAR',
        productId: '33333333-0000-0000-0000-000000000008',
        productSku: 'LH-FRESH-MILK-1L',
        productName: 'Sữa Tươi Thanh Trùng Nguyên Chất Loha Farm 1L',
        categoryName: 'Sữa tươi & Tiệt trùng',
        warehouseId: '11111111-0000-0000-0000-000000000002',
        warehouseName: 'Kho Miền Bắc (Hà Nội)',
        baseUnit: 'Chai',
        mfgDate: addDays(-75),
        expiryDate: addDays(15), // Cận hạn < 30 ngày (EXPIRING_SOON)
        quantity: 520,
        allocatedQuantity: 50,
        costPrice: 26000,
      },
      {
        id: '66666666-0000-0000-0000-000000000004',
        batchNumber: 'LOT-MILK-2026-SAFE',
        productId: '33333333-0000-0000-0000-000000000008',
        productSku: 'LH-FRESH-MILK-1L',
        productName: 'Sữa Tươi Thanh Trùng Nguyên Chất Loha Farm 1L',
        categoryName: 'Sữa tươi & Tiệt trùng',
        warehouseId: '11111111-0000-0000-0000-000000000002',
        warehouseName: 'Kho Miền Bắc (Hà Nội)',
        baseUnit: 'Chai',
        mfgDate: addDays(-10),
        expiryDate: addDays(180), // Hợp lệ (VALID)
        quantity: 1200,
        allocatedQuantity: 0,
        costPrice: 26000,
      },
      {
        id: '66666666-0000-0000-0000-000000000005',
        batchNumber: 'LOT-TEA-2026-EXP',
        productId: '33333333-0000-0000-0000-000000000004',
        productSku: 'LH-TEA-PEACH-450',
        productName: 'Trà Đào Hạt Chia Loha Tea Chai 450ml',
        categoryName: 'Nước giải khát & Trà',
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
        baseUnit: 'Chai',
        mfgDate: addDays(-190),
        expiryDate: addDays(-6), // Đã hết hạn (EXPIRED)
        quantity: 350,
        allocatedQuantity: 0,
        costPrice: 8500,
      },
      {
        id: '66666666-0000-0000-0000-000000000006',
        batchNumber: 'LOT-NRG-2026-NEAR',
        productId: '33333333-0000-0000-0000-000000000003',
        productSku: 'LH-ENERGY-BULL-250',
        productName: 'Nước Tăng Lực Loha Red Bull Lon 250ml',
        categoryName: 'Nước tăng lực & Thể thao',
        warehouseId: '11111111-0000-0000-0000-000000000004',
        warehouseName: 'Kho Miền Trung (Đà Nẵng)',
        baseUnit: 'Lon',
        mfgDate: addDays(-160),
        expiryDate: addDays(20), // Cận hạn < 30 ngày (EXPIRING_SOON)
        quantity: 800,
        allocatedQuantity: 100,
        costPrice: 7800,
      },
      {
        id: '66666666-0000-0000-0000-000000000007',
        batchNumber: 'LOT-NEST-2026-SAFE',
        productId: '33333333-0000-0000-0000-000000000009',
        productSku: 'LH-NEST-PREM-100G',
        productName: 'Hộp Quà Yến Sào Tinh Chế Thượng Hạng 100g',
        categoryName: 'Nước yến & Bổ dưỡng',
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
        baseUnit: 'Hộp',
        mfgDate: addDays(-40),
        expiryDate: addDays(320), // Hợp lệ (VALID)
        quantity: 45,
        allocatedQuantity: 5,
        costPrice: 3100000,
      },
      {
        id: '66666666-0000-0000-0000-000000000008',
        batchNumber: 'LOT-NUTS-2026-EXP',
        productId: '33333333-0000-0000-0000-000000000010',
        productSku: 'LH-NUTS-MIX-250G',
        productName: 'Hạt Hỗn Hợp Macca Óc Chó Hạnh Nhân Sấy Giòn 250g',
        categoryName: 'Ngũ cốc & Hạt dinh dưỡng',
        warehouseId: '11111111-0000-0000-0000-000000000003',
        warehouseName: 'Kho Miền Tây (Cần Thơ)',
        baseUnit: 'Hũ',
        mfgDate: addDays(-200),
        expiryDate: addDays(-14), // Đã hết hạn (EXPIRED)
        quantity: 120,
        allocatedQuantity: 0,
        costPrice: 88000,
      },
    ];

    for (const b of initialBatches) {
      const entity = new InventoryBatchEntity(b);
      this.batches.set(entity.id, entity);
    }
  }

  /**
   * Đồng bộ lô hàng từ cơ sở dữ liệu PostgreSQL
   */
  private async syncBatchesFromDatabase(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      const rows = await this.databaseService.query<{
        id: string;
        batch_number: string;
        product_id: string;
        warehouse_id: string;
        location_id?: string;
        mfg_date?: string;
        expiry_date: string;
        quantity: string | number;
        allocated_quantity: string | number;
        cost_price: string | number;
        product_sku?: string;
        product_name?: string;
        category_name?: string;
        base_unit?: string;
        warehouse_name?: string;
      }>(
        `SELECT b.id, b.batch_number, b.product_id, b.warehouse_id, b.location_id,
                b.mfg_date, b.expiry_date, b.quantity, b.allocated_quantity, b.cost_price,
                p.sku as product_sku, p.name as product_name, p.base_unit,
                c.name as category_name,
                w.name as warehouse_name
         FROM inventory_batches b
         LEFT JOIN products p ON b.product_id = p.id
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN warehouses w ON b.warehouse_id = w.id
         WHERE b.quantity > 0 OR b.status = 'ACTIVE';`
      );

      if (rows && rows.length > 0) {
        for (const r of rows) {
          const entity = new InventoryBatchEntity({
            id: r.id,
            batchNumber: r.batch_number,
            productId: r.product_id,
            warehouseId: r.warehouse_id,
            locationId: r.location_id,
            mfgDate: r.mfg_date,
            expiryDate: r.expiry_date,
            quantity: Number(r.quantity) || 0,
            allocatedQuantity: Number(r.allocated_quantity) || 0,
            costPrice: Number(r.cost_price) || 0,
            productSku: r.product_sku || '',
            productName: r.product_name || '',
            categoryName: r.category_name,
            baseUnit: r.base_unit || 'Đơn vị',
            warehouseName: r.warehouse_name || DEFAULT_WAREHOUSE_NAME,
          });
          this.batches.set(entity.id, entity);
        }
      }
    } catch {
      // Fallback êm ái
    }
  }

  /**
   * Truy vấn danh sách lô hàng kèm tính toán trạng thái theo ngưỡng cảnh báo cận hạn (SN-184 AC-2 & AC-3)
   */
  async getBatches(
    query: QueryBatchesDto = {},
    user?: ICurrentUser,
  ): Promise<PaginatedBatchesResponse> {
    if (this.databaseService?.isConnected()) {
      await this.syncBatchesFromDatabase();
    }
    if (this.batches.size === 0) {
      this.seedInitialBatches();
    }
    await this.syncWithGoodsReceipts();

    const threshold = query.expiryThresholdDays && query.expiryThresholdDays > 0 ? query.expiryThresholdDays : 30;
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;

    let items = Array.from(this.batches.values()).map(
      (b) => new InventoryBatchEntity(b, threshold),
    );

    // 1. Lọc theo kho (warehouseId):
    // Cho phép cả Thủ kho và Quản lý kho tra cứu toàn bộ mạng lưới kho ('ALL' hoặc không truyền), hoặc lọc theo bất kỳ kho cụ thể nào khi cần kiểm tra.
    if (query.warehouseId && query.warehouseId !== 'ALL') {
      const targetWh = query.warehouseId.toLowerCase().trim();
      items = items.filter(
        (b) =>
          b.warehouseId.toLowerCase() === targetWh ||
          b.warehouseName.toLowerCase().includes(targetWh),
      );
    }

    // 3. Lọc theo sản phẩm (productId hoặc sku)
    if (query.productId && query.productId !== 'ALL') {
      const pid = query.productId.toLowerCase().trim();
      items = items.filter((b) => b.productId.toLowerCase() === pid);
    }
    if (query.sku && query.sku !== 'ALL') {
      const skuLower = query.sku.toLowerCase().trim();
      items = items.filter((b) => b.productSku.toLowerCase() === skuLower);
    }

    // 4. Tìm kiếm từ khóa (Số lô, SKU, Tên sản phẩm, Tên kho)
    if (query.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      items = items.filter(
        (b) =>
          b.batchNumber.toLowerCase().includes(q) ||
          b.productSku.toLowerCase().includes(q) ||
          b.productName.toLowerCase().includes(q) ||
          b.warehouseName.toLowerCase().includes(q),
      );
    }

    // 5. Lọc theo trạng thái lô (VALID, EXPIRING_SOON, EXPIRED)
    if (query.status && query.status !== BatchStatusFilter.ALL) {
      items = items.filter((b) => b.status === query.status);
    }

    // 6. Sắp xếp theo chuẩn FEFO (First Expired, First Out)
    items.sort((a, b) => {
      const tA = new Date(a.expiryDate).getTime();
      const tB = new Date(b.expiryDate).getTime();
      return tA - tB;
    });

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = items.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      total,
      page,
      limit,
      totalPages,
      thresholdDays: threshold,
    };
  }

  /**
   * Thống kê tổng số lượng lô, số lô hợp lệ, sắp hết hạn và đã hết hạn (SN-184 AC-3)
   */
  async getBatchStats(
    warehouseId?: string,
    thresholdDays = 30,
    user?: ICurrentUser,
  ): Promise<BatchStatsResponse> {
    const listRes = await this.getBatches(
      {
        warehouseId,
        expiryThresholdDays: thresholdDays,
        limit: 10000,
        page: 1,
      },
      user,
    );

    const all = listRes.data;
    const validCount = all.filter((b) => b.status === 'VALID').length;
    const expiringSoonCount = all.filter((b) => b.status === 'EXPIRING_SOON').length;
    const expiredCount = all.filter((b) => b.status === 'EXPIRED').length;
    const totalQuantity = all.reduce((sum, b) => sum + b.quantity, 0);

    return {
      totalBatches: all.length,
      validCount,
      expiringSoonCount,
      expiredCount,
      totalQuantity,
      thresholdDays,
    };
  }

  /**
   * Đồng bộ lô hàng từ các phiếu nhập kho đã xác nhận (Goods Receipts - SN-178 / SN-184)
   */
  public async syncWithGoodsReceipts(): Promise<void> {
    if (!this.goodsReceiptsService) return;
    try {
      const confirmedReceipts = await this.goodsReceiptsService.getConfirmedReceiptsForSync();
      if (!Array.isArray(confirmedReceipts)) return;
      for (const receipt of confirmedReceipts) {
        for (const item of (receipt.items || [])) {
          if (!item.batchNumber) continue;
          const baseQty = Number(item.baseQuantity) || (Number(item.packageQuantity) * Number(item.conversionFactor || 1));
          if (baseQty <= 0) continue;

          await this.upsertBatchFromReceipt(
            {
              batchNumber: item.batchNumber,
              productId: item.productId,
              productSku: item.productCode || (item as any).productSku,
              productName: item.productName,
              warehouseId: receipt.warehouseId,
              warehouseName: receipt.warehouseName,
              baseUnit: item.unitName || item.unitId,
              mfgDate: item.mfgDate,
              expiryDate: item.expiryDate,
              quantity: baseQty,
              costPrice: Number(item.unitCost) || 0,
            },
            false,
          );
        }
      }
    } catch (err: any) {
      console.warn('[INVENTORY_SERVICE] Lỗi đồng bộ lô hàng từ phiếu nhập:', err?.message);
    }
  }

  /**
   * Đồng bộ và cập nhật lô hàng từ phiếu nhập kho hoặc các nghiệp vụ kho khác (SN-178 / SN-184)
   */
  async upsertBatchFromReceipt(
    item: {
      batchNumber: string;
      productId: string;
      productSku?: string;
      productName?: string;
      warehouseId: string;
      warehouseName?: string;
      baseUnit?: string;
      mfgDate?: string | Date;
      expiryDate?: string | Date;
      quantity: number;
      costPrice?: number;
    },
    isNewConfirmation = false,
  ): Promise<InventoryBatchEntity> {
    if (this.databaseService?.isConnected()) {
      await this.syncBatchesFromDatabase();
    }
    if (this.batches.size === 0) {
      this.seedInitialBatches();
    }

    const bNum = (item.batchNumber || '').trim();
    if (!bNum) return null as any;

    let finalWhId = item.warehouseId || DEFAULT_WAREHOUSE_ID;
    let finalWhName = item.warehouseName || DEFAULT_WAREHOUSE_NAME;
    const resolvedWh = await this.resolveWarehouseId(item.warehouseId);
    if (resolvedWh) {
      finalWhId = resolvedWh.id;
      finalWhName = resolvedWh.name;
    }

    const pid = (item.productId || '').trim().toLowerCase();
    const sku = (item.productSku || '').trim().toUpperCase();
    const wid = finalWhId.trim().toLowerCase();
    const baseQty = Number(item.quantity) || 0;

    let prodSku = sku;
    let prodName = item.productName || '';
    let prodUnit = item.baseUnit || 'Đơn vị';
    if (!prodSku || !prodName || prodUnit === 'Đơn vị') {
      try {
        let p = null;
        if (item.productId) {
          p = await this.productsService?.findById(item.productId);
        }
        if (!p && prodSku) {
          p = await this.productsService?.findById(prodSku);
        }
        if (p) {
          if (!prodSku) prodSku = p.sku;
          if (!prodName) prodName = p.name;
          if (prodUnit === 'Đơn vị') prodUnit = p.baseUnit || 'Hộp';
        }
      } catch {}
    }

    const parseDateStr = (d?: string | Date): string => {
      if (!d) return '';
      if (d instanceof Date) return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
      const s = String(d).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
      const parsed = new Date(s);
      return !isNaN(parsed.getTime()) ? parsed.toISOString().split('T')[0] : s;
    };

    const mfgStr = parseDateStr(item.mfgDate);
    const expStr = parseDateStr(item.expiryDate);

    // Tìm xem lô đã có trong bộ nhớ chưa (theo batchNumber + product + warehouse)
    let existing = Array.from(this.batches.values()).find(
      (b) =>
        b.batchNumber.toLowerCase() === bNum.toLowerCase() &&
        (b.productId.toLowerCase() === pid || (sku && b.productSku.toUpperCase() === sku)) &&
        (b.warehouseId.toLowerCase() === wid || !item.warehouseId),
    );

    if (existing) {
      if (isNewConfirmation) {
        existing.quantity += baseQty;
      } else {
        existing.quantity = Math.max(existing.quantity, baseQty);
      }
      existing.availableQuantity = Math.max(0, existing.quantity - existing.allocatedQuantity);
      if (item.costPrice) existing.costPrice = Number(item.costPrice);
      if (mfgStr) existing.mfgDate = mfgStr;
      if (expStr) existing.expiryDate = expStr;
      if (prodName) existing.productName = prodName;
      if (prodSku) existing.productSku = prodSku;
      if (prodUnit && prodUnit !== 'Đơn vị') existing.baseUnit = prodUnit;
      existing.updatedAt = new Date();
      return existing;
    } else {
      const entity = new InventoryBatchEntity({
        id: randomUUID(),
        batchNumber: bNum,
        productId: item.productId,
        productSku: prodSku || item.productSku || '',
        productName: prodName || item.productName || '',
        warehouseId: finalWhId,
        warehouseName: finalWhName,
        baseUnit: prodUnit,
        mfgDate: mfgStr || undefined,
        expiryDate: expStr || new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0],
        quantity: baseQty,
        allocatedQuantity: 0,
        availableQuantity: baseQty,
        costPrice: Number(item.costPrice) || 0,
      });
      this.batches.set(entity.id, entity);
      return entity;
    }
  }

  /**
   * Xác nhận và cộng dồn tồn kho từ phiếu nhập kho (SN-178: Ghi thẻ kho, cập nhật stock_balances & products)
   */
  async processGoodsReceiptConfirmation(receipt: {
    code: string;
    warehouseId: string;
    warehouseName?: string;
    items: Array<{
      productId: string;
      productSku?: string;
      productName?: string;
      baseQuantity: number;
      unitCost?: number;
      batchNumber?: string;
      mfgDate?: string | Date;
      expiryDate?: string | Date;
      notes?: string;
    }>;
    userId?: string;
    receivedByName?: string;
  }): Promise<void> {
    const warehouseId = receipt.warehouseId || DEFAULT_WAREHOUSE_ID;
    const resolvedWh = await this.resolveWarehouseId(warehouseId);
    const finalWarehouseId = resolvedWh ? resolvedWh.id : warehouseId;
    const finalWarehouseName = resolvedWh ? resolvedWh.name : (receipt.warehouseName || DEFAULT_WAREHOUSE_NAME);

    for (const item of receipt.items) {
      const baseQty = Number(item.baseQuantity) || 0;
      if (baseQty <= 0) continue;

      let product: ProductEntity | null = null;
      try {
        if (item.productId) {
          product = await this.productsService.findById(item.productId);
        }
      } catch {}
      if (!product && item.productSku) {
        try {
          product = await this.productsService.findById(item.productSku);
        } catch {}
      }

      const prodId = product ? product.id : item.productId;
      const prodSku = product ? product.sku : (item.productSku || '');
      const prodName = product ? product.name : (item.productName || '');
      const baseUnit = product ? product.baseUnit : 'Đơn vị';
      const costPrice = Number(item.unitCost) || 0;

      // 1. Cập nhật tồn kho sản phẩm (ProductsService)
      if (product) {
        await this.productsService.updateStock(product.id, baseQty);
      }

      // 2. Cập nhật vào Database PostgreSQL nếu đang kết nối
      if (this.databaseService?.isConnected()) {
        try {
          // inventories
          await this.databaseService.query(
            `INSERT INTO inventories (warehouse_id, product_id, on_hand, allocated, created_at, updated_at)
             VALUES ($1::uuid, $2, $3, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (warehouse_id, product_id)
             DO UPDATE SET on_hand = inventories.on_hand + $3, updated_at = CURRENT_TIMESTAMP`,
            [finalWarehouseId, prodId, baseQty],
          );

          // app_inventory_stock_balances
          if (prodSku) {
            await this.databaseService.query(
              `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity, updated_at)
               VALUES ($1, $2::uuid, $3, CURRENT_TIMESTAMP)
               ON CONFLICT (product_sku, warehouse_id)
               DO UPDATE SET physical_quantity = app_inventory_stock_balances.physical_quantity + $3, updated_at = CURRENT_TIMESTAMP`,
              [prodSku.toUpperCase(), finalWarehouseId, baseQty],
            );
          }

          // inventory_batches
          if (item.batchNumber && item.expiryDate) {
            const expDateStr = item.expiryDate instanceof Date 
              ? item.expiryDate.toISOString().split('T')[0] 
              : String(item.expiryDate).split('T')[0];
            const mfgDateStr = item.mfgDate 
              ? (item.mfgDate instanceof Date ? item.mfgDate.toISOString().split('T')[0] : String(item.mfgDate).split('T')[0]) 
              : null;
            await this.databaseService.query(
              `INSERT INTO inventory_batches (warehouse_id, product_id, batch_number, mfg_date, expiry_date, quantity, cost_price, created_at, updated_at)
               VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT (warehouse_id, product_id, batch_number)
               DO UPDATE SET quantity = inventory_batches.quantity + $6, cost_price = $7, updated_at = CURRENT_TIMESTAMP`,
              [finalWarehouseId, prodId, item.batchNumber.trim(), mfgDateStr, expDateStr, baseQty, costPrice],
            );
          }

          // app_inventory_transactions
          await this.databaseService.query(
            `INSERT INTO app_inventory_transactions (
              id, product_id, sku, product_name, transaction_type,
              input_quantity, input_unit, conversion_rate, base_quantity_change, base_unit,
              previous_stock, new_stock, reason, reference_code, warehouse, performed_by, created_at
            ) VALUES (
              $1, $2, $3, $4, 'IMPORT',
              $5, $6, 1, $7, $8,
              $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP
            )`,
            [
              randomUUID(), prodId, prodSku, prodName,
              baseQty, baseUnit, baseQty, baseUnit,
              product?.stockQuantity ? product.stockQuantity - baseQty : 0,
              product?.stockQuantity ?? baseQty,
              'Nhập kho hàng hóa từ nhà cung cấp',
              receipt.code, finalWarehouseName, receipt.receivedByName || receipt.userId || 'Thủ kho'
            ]
          );
        } catch {
          // Bỏ qua lỗi DB và fallback an toàn
        }
      }

      // 3. Đồng bộ lô hàng vào bộ nhớ (Inventory Batches map)
      if (item.batchNumber) {
        await this.upsertBatchFromReceipt(
          {
            batchNumber: item.batchNumber,
            productId: prodId,
            productSku: prodSku,
            productName: prodName,
            warehouseId: finalWarehouseId,
            warehouseName: finalWarehouseName,
            baseUnit,
            mfgDate: item.mfgDate,
            expiryDate: item.expiryDate || new Date(Date.now() + 180 * 86400000),
            quantity: baseQty,
            costPrice,
          },
          true,
        );
      }

      // 4. Ghi sổ cái in-memory ledger
      const prevStock = product ? (product.stockQuantity - baseQty) : 0;
      const newStock = product ? product.stockQuantity : baseQty;
      const tx = new InventoryTransactionEntity({
        id: randomUUID(),
        productId: prodId,
        sku: prodSku,
        productName: prodName,
        transactionType: 'IMPORT',
        inputQuantity: baseQty,
        inputUnit: baseUnit,
        conversionRate: 1,
        baseQuantityChange: baseQty,
        baseUnit,
        previousStock: Math.max(0, prevStock),
        newStock,
        reason: 'Nhập kho hàng hóa từ nhà cung cấp',
        referenceCode: receipt.code,
        warehouse: finalWarehouseName,
        performedBy: receipt.receivedByName || receipt.userId || 'Thủ kho',
        createdAt: new Date(),
      });
      this.writeLedger(tx);

      // 5. Cập nhật tồn kho theo kho vào memoryWarehouseBalances
      const whKey = finalWarehouseId.toLowerCase().trim();
      const skuKey = prodSku.toUpperCase().trim();
      if (skuKey) {
        const whMap = this.memoryWarehouseBalances.get(whKey) || new Map<string, number>();
        const currentWhQty = whMap.get(skuKey) ?? (
          (whKey === DEFAULT_WAREHOUSE_ID.toLowerCase() || whKey.includes('0001') || whKey.includes('kho-mn'))
            ? (product?.stockQuantity ? product.stockQuantity - baseQty : 0)
            : 0
        );
        whMap.set(skuKey, currentWhQty + baseQty);
        this.memoryWarehouseBalances.set(whKey, whMap);
      }
    }
  }

  /**
   * Tự sinh số lô hàng kết nối hệ thống ngẫu nhiên, không trùng lặp theo chuẩn LOT-YYMMDD-XXXX (SN-178 / SN-184)
   */
  async generateBatchNumber(
    productId?: string,
    sku?: string,
    dateStr?: string,
  ): Promise<{ batchNumber: string; success: boolean }> {
    if (this.databaseService?.isConnected()) {
      await this.syncBatchesFromDatabase();
    }
    const now = dateStr ? new Date(dateStr) : new Date();
    const targetDate = isNaN(now.getTime()) ? new Date() : now;
    const yy = String(targetDate.getFullYear()).slice(-2);
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const datePart = `${yy}${mm}${dd}`;

    // Bảng ký tự Crockford Base32: 32 ký tự tránh nhầm lẫn (không có I, L, O, U)
    const charset = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const existingBatches = new Set(
      Array.from(this.batches.values()).map((b) => b.batchNumber),
    );

    let batchNumber = '';
    let attempts = 0;
    do {
      let randPart = '';
      for (let i = 0; i < 4; i++) {
        const randIndex = Math.floor(Math.random() * charset.length);
        randPart += charset[randIndex];
      }
      batchNumber = `LOT-${datePart}-${randPart}`;
      attempts++;
    } while (existingBatches.has(batchNumber) && attempts < 100);

    return {
      batchNumber,
      success: true,
    };
  }

  /**
   * Kiểm tra điều kiện xuất kho của lô hàng và cơ chế Ghi Đè Quản Lý Kho (SN-184 AC-4)
   * Không cho xuất lô đã quá hạn, trừ khi Quản lý kho xác nhận ghi đè kèm lý do
   */
  async checkBatchDispatch(
    dto: CheckBatchDispatchDto,
    user?: ICurrentUser,
  ): Promise<{
    allowed: boolean;
    isOverridden: boolean;
    warning?: string;
    batch: Record<string, unknown>;
    overrideReason?: string;
    overriddenBy?: string;
    overriddenAt?: Date;
    status?: string;
  }> {
    if (this.databaseService?.isConnected()) {
      await this.syncBatchesFromDatabase();
    }
    if (this.batches.size === 0) {
      this.seedInitialBatches();
    }

    let batch: InventoryBatchEntity | undefined;
    if (dto.batchId) {
      batch = this.batches.get(dto.batchId);
    }
    if (!batch && dto.batchNumber) {
      const bNum = dto.batchNumber.toLowerCase().trim();
      batch = Array.from(this.batches.values()).find(
        (b) =>
          b.batchNumber.toLowerCase() === bNum &&
          (!dto.warehouseId || b.warehouseId === dto.warehouseId),
      );
    }

    if (!batch) {
      throw new NotFoundException(
        `Không tìm thấy lô hàng với mã/số lô: ${dto.batchId || dto.batchNumber || 'chưa xác định'}`,
      );
    }

    // Kiểm tra số lượng tồn khả dụng
    if (batch.availableQuantity < dto.quantity) {
      throw new BadRequestException(
        `Số lượng xuất (${dto.quantity} ${batch.baseUnit}) vượt quá tồn khả dụng của lô ${batch.batchNumber} (còn ${batch.availableQuantity} ${batch.baseUnit}).`,
      );
    }

    // Tiêu chí 4: Kiểm tra hạn sử dụng của lô
    const isExpired = batch.daysRemaining < 0;
    if (isExpired) {
      // Nếu không có lý do ghi đè -> Chặn ngay lập tức
      if (!dto.managerOverrideReason || !dto.managerOverrideReason.trim()) {
        throw new BadRequestException(
          `Lô hàng "${batch.batchNumber}" đã QUÁ HẠN SỬ DỤNG từ ngày ${batch.expiryDate} (quá hạn ${Math.abs(batch.daysRemaining)} ngày). ` +
          `Quy chuẩn quản lý kho chặn xuất lô đã quá hạn cho đại lý. ` +
          `Chỉ Quản lý kho mới có thẩm quyền xác nhận ghi đè kèm lý do cụ thể để xuất lô này.`,
        );
      }

      // Có lý do ghi đè -> Kiểm tra quyền của người dùng (Warehouse Manager hoặc Admin)
      const roles = (user?.roles || []).map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.WAREHOUSE_MANAGER) ||
        roles.includes(UserRole.WH_MANAGER);

      if (!isManagerOrAdmin) {
        throw new ForbiddenException(
          `Bạn không có quyền xác nhận ghi đè xuất lô quá hạn. Chỉ Quản lý kho (Warehouse Manager) hoặc Quản trị viên (Admin) mới có thẩm quyền này.`,
        );
      }

      const overrideReason = dto.managerOverrideReason.trim();
      if (overrideReason.length < 5) {
        throw new BadRequestException('Lý do ghi đè của Quản lý kho phải có tối thiểu 5 ký tự.');
      }

      return {
        allowed: true,
        isOverridden: true,
        warning: `Lô hàng quá hạn đã được Quản lý kho xác nhận ghi đè thành công.`,
        batch: batch.toJSON(),
        overrideReason,
        overriddenBy: (user as any)?.fullName || user?.username || 'Quản lý kho',
        overriddenAt: new Date(),
        status: 'EXPIRED',
      };
    }

    return {
      allowed: true,
      isOverridden: false,
      batch: batch.toJSON(),
      status: batch.status,
    };
  }

  /**
   * Xóa sản phẩm khỏi kho hàng:
   * - Chỉ xóa được khi tất cả các loại tồn (thực tế, tạm giữ, khả dụng) đều bằng 0
   * - Xóa bản ghi trong inventories và app_inventory_stock_balances của kho đó
   */
  async removeProductFromWarehouse(
    warehouseId: string,
    sku: string,
    productId?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.databaseService?.isConnected()) {
      await this.databaseService?.ensureConnection?.();
    }

    if (!warehouseId) {
      throw new BadRequestException('Vui lòng cung cấp mã ID kho hàng cần xóa sản phẩm');
    }

    // 1. Tìm thông tin sản phẩm
    let prod: { id: string; sku: string; name: string } | null = null;
    if (productId) {
      const rows = await this.databaseService.query<{ id: string; sku: string; name: string }>(
        `SELECT id, sku, name FROM products WHERE id = $1::uuid`,
        [productId],
      );
      prod = rows[0] || null;
    }
    if (!prod && sku) {
      const rows = await this.databaseService.query<{ id: string; sku: string; name: string }>(
        `SELECT id, sku, name FROM products WHERE UPPER(TRIM(sku)) = UPPER(TRIM($1))`,
        [sku],
      );
      prod = rows[0] || null;
    }

    const resolvedSku = prod?.sku || sku;
    const resolvedProdId = prod?.id || productId;

    // 2. Kiểm tra các loại tồn kho của sản phẩm tại kho này
    let onHand = 0;
    let allocated = 0;
    if (resolvedProdId) {
      const invRows = await this.databaseService.query<{ on_hand: number; allocated: number }>(
        `SELECT on_hand, allocated FROM inventories WHERE warehouse_id = $1::uuid AND product_id = $2::uuid`,
        [warehouseId, resolvedProdId],
      );
      if (invRows[0]) {
        onHand = Number(invRows[0].on_hand || 0);
        allocated = Number(invRows[0].allocated || 0);
      }
    }

    let physicalQuantity = 0;
    if (resolvedSku) {
      const balRows = await this.databaseService.query<{ physical_quantity: number }>(
        `SELECT physical_quantity FROM app_inventory_stock_balances WHERE warehouse_id = $1::uuid AND UPPER(TRIM(product_sku)) = UPPER(TRIM($2))`,
        [warehouseId, resolvedSku],
      );
      if (balRows[0]) {
        physicalQuantity = Number(balRows[0].physical_quantity || 0);
      }
    }

    let reservedQuantity = 0;
    if (resolvedSku) {
      const resRows = await this.databaseService.query<{ total_res: string }>(
        `SELECT COALESCE(SUM(base_quantity), 0)::text as total_res FROM app_order_inventory_reservations WHERE warehouse_id = $1::uuid AND UPPER(TRIM(product_sku)) = UPPER(TRIM($2)) AND status = 'RESERVED' AND base_quantity > 0`,
        [warehouseId, resolvedSku],
      );
      reservedQuantity = Number(resRows[0]?.total_res || 0);
    }

    const totalActual = Math.max(onHand, physicalQuantity);
    const totalHolding = Math.max(allocated, reservedQuantity);

    // Ràng buộc nghiêm ngặt: Phải hết mọi loại tồn, không giữ tồn khách
    if (totalActual > 0 || totalHolding > 0) {
      throw new BadRequestException(
        `Sản phẩm "${prod?.name || resolvedSku}" vẫn còn số lượng trong kho (Tồn thực tế: ${totalActual}, Đang giữ cho khách: ${totalHolding}). Không thể xóa sản phẩm khỏi kho! Bạn cần xuất kho hoặc điều chỉnh hết tồn về 0 trước khi xóa.`,
      );
    }

    // 3. Tiến hành xóa sản phẩm khỏi kho trong database
    if (resolvedProdId) {
      await this.databaseService.query(
        `DELETE FROM inventories WHERE warehouse_id = $1::uuid AND product_id = $2::uuid`,
        [warehouseId, resolvedProdId],
      );
    }
    if (resolvedSku) {
      await this.databaseService.query(
        `DELETE FROM app_inventory_stock_balances WHERE warehouse_id = $1::uuid AND UPPER(TRIM(product_sku)) = UPPER(TRIM($2))`,
        [warehouseId, resolvedSku],
      );
    }

    return {
      success: true,
      message: `Đã xóa sản phẩm "${prod?.name || resolvedSku}" khỏi kho thành công!`,
    };
  }

  /**
   * SN-188: Gợi ý lô xuất kho theo nguyên tắc FEFO (Hạn dùng gần nhất xuất trước)
   * GET /api/inventory/batches/suggest-fefo?skuCode=...&quantity=...&warehouseId=...
   */
  async suggestFefoBatch(params: {
    skuCode?: string;
    sku?: string;
    productId?: string;
    quantity?: number;
    warehouseId?: string;
  }): Promise<{
    suggestedBatch: any;
    allBatches: any[];
    isSufficient: boolean;
    requiredQuantity: number;
  }> {
    if (this.databaseService?.isConnected()) {
      await this.syncBatchesFromDatabase();
    }
    if (this.batches.size === 0) {
      this.seedInitialBatches();
    }
    await this.syncWithGoodsReceipts();

    const targetSku = (params.skuCode || params.sku || '').trim().toLowerCase();
    const targetPid = (params.productId || '').trim().toLowerCase();
    const targetWh = (params.warehouseId || '').trim().toLowerCase();
    const requiredQty = Number(params.quantity) || 1;

    // Lọc các lô của sản phẩm tại kho
    let candidates = Array.from(this.batches.values()).map(
      (b) => new InventoryBatchEntity(b),
    );

    candidates = candidates.filter((b) => {
      // Khớp sản phẩm theo SKU hoặc ProductId
      const matchProduct =
        (targetSku && b.productSku.toLowerCase() === targetSku) ||
        (targetPid && b.productId.toLowerCase() === targetPid);

      if (!matchProduct) return false;

      // Khớp kho nếu có truyền
      if (targetWh && targetWh !== 'all') {
        const matchWh =
          b.warehouseId.toLowerCase() === targetWh ||
          b.warehouseName.toLowerCase().includes(targetWh);
        if (!matchWh) return false;
      }

      // Chỉ lấy lô còn hạn và còn tồn khả dụng > 0
      return b.status !== 'EXPIRED' && b.availableQuantity > 0;
    });

    // Sắp xếp theo chuẩn FEFO: ExpiryDate tăng dần (hạn gần nhất xếp trước)
    candidates.sort((a, b) => {
      const getExpMs = (dateStr: string): number => {
        if (!dateStr) return Infinity;
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? Infinity : d.getTime();
      };
      const timeA = getExpMs(a.expiryDate);
      const timeB = getExpMs(b.expiryDate);
      if (timeA !== timeB) return timeA - timeB;
      const createdA = a.createdAt instanceof Date && !isNaN(a.createdAt.getTime()) ? a.createdAt.getTime() : 0;
      const createdB = b.createdAt instanceof Date && !isNaN(b.createdAt.getTime()) ? b.createdAt.getTime() : 0;
      return createdA - createdB;
    });

    if (candidates.length === 0) {
      return {
        suggestedBatch: null,
        allBatches: [],
        isSufficient: false,
        requiredQuantity: requiredQty,
      };
    }

    // Ưu tiên lô cận date nhất còn đủ số lượng yêu cầu
    let chosen = candidates.find((b) => b.availableQuantity >= requiredQty);
    // Nếu không có lô đơn lẻ nào đủ, chọn lô cận date nhất đầu tiên
    if (!chosen) {
      chosen = candidates[0];
    }

    return {
      suggestedBatch: chosen.toJSON(),
      allBatches: candidates.map((c, idx) => ({
        ...c.toJSON(),
        isFefoRecommended: idx === 0,
      })),
      isSufficient: chosen.availableQuantity >= requiredQty,
      requiredQuantity: requiredQty,
    };
  }

  /**
   * SN-188: Lấy danh sách tất cả các lô khả dụng của một SKU tại kho (phục vụ Popup Đổi Lô)
   * GET /api/inventory/batches/by-sku?skuCode=...&warehouseId=...
   */
  async getBatchesBySku(params: {
    skuCode?: string;
    sku?: string;
    productId?: string;
    warehouseId?: string;
  }): Promise<{
    skuCode: string;
    fefoSuggestedBatchNo: string | null;
    batches: any[];
  }> {
    const res = await this.suggestFefoBatch({
      ...params,
      quantity: 1,
    });

    return {
      skuCode: params.skuCode || params.sku || '',
      fefoSuggestedBatchNo: res.suggestedBatch
        ? res.suggestedBatch.batchNumber || res.suggestedBatch.batch_number
        : null,
      batches: res.allBatches,
    };
  }

  // =========================================================================
  // SN-214: QUẢN LÝ PHIẾU ĐIỀU CHỈNH TỒN KHO CÓ PHÊ DUYỆT (Hàng hỏng, mất, huỷ)
  // =========================================================================

  async ensureStockAdjustmentsTable(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    if (!this.stockAdjustmentsSchemaPromise) {
      this.stockAdjustmentsSchemaPromise = (async () => {
        await this.databaseService.query(`
          CREATE TABLE IF NOT EXISTS app_stock_adjustments (
            id TEXT PRIMARY KEY,
            adjustment_code TEXT NOT NULL UNIQUE,
            warehouse_id TEXT NOT NULL,
            warehouse_name TEXT NOT NULL,
            reason TEXT NOT NULL,
            reason_detail TEXT,
            total_loss_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'PENDING',
            items JSONB NOT NULL DEFAULT '[]'::jsonb,
            creator_id TEXT NOT NULL,
            creator_name TEXT NOT NULL,
            creator_role TEXT,
            approver_id TEXT,
            approver_name TEXT,
            approved_at TIMESTAMPTZ,
            reject_reason TEXT,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX IF NOT EXISTS idx_stock_adj_code ON app_stock_adjustments(adjustment_code);
          CREATE INDEX IF NOT EXISTS idx_stock_adj_status ON app_stock_adjustments(status);
          CREATE INDEX IF NOT EXISTS idx_stock_adj_created ON app_stock_adjustments(created_at DESC);
        `);

        try {
          const countRes = await this.databaseService.query<{ count: string }>(
            `SELECT count(*)::text as count FROM app_stock_adjustments`,
          );
          const count = Number(countRes[0]?.count ?? 0);
          if (count === 0 && this.adjustments.size > 0) {
            for (const adj of this.adjustments.values()) {
              await this.databaseService.query(
                `INSERT INTO app_stock_adjustments (
                  id, adjustment_code, warehouse_id, warehouse_name, reason,
                  reason_detail, total_loss_value, status, items,
                  creator_id, creator_name, creator_role, approver_id, approver_name,
                  approved_at, reject_reason, note, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
                ON CONFLICT (id) DO NOTHING`,
                [
                  adj.id,
                  adj.adjustmentCode,
                  adj.warehouseId,
                  adj.warehouseName,
                  adj.reason,
                  adj.reasonDetail || '',
                  adj.totalLossValue,
                  adj.status,
                  JSON.stringify(adj.items || []),
                  adj.creatorId,
                  adj.creatorName,
                  adj.creatorRole || 'WAREHOUSE_KEEPER',
                  adj.approverId || null,
                  adj.approverName || null,
                  adj.approvedAt || null,
                  adj.rejectReason || null,
                  adj.note || null,
                  adj.createdAt,
                  adj.updatedAt,
                ],
              );
            }
          }
        } catch (seedErr: any) {
          console.warn('[INVENTORY_SERVICE] Không thể nạp khởi tạo app_stock_adjustments:', seedErr?.message);
        }
      })().catch((err: unknown) => {
        console.warn('[INVENTORY_SERVICE] Lỗi tạo bảng app_stock_adjustments:', (err as any)?.message);
      });
    }
    return this.stockAdjustmentsSchemaPromise;
  }

  private async syncAdjustmentsFromDatabase(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      const rows = await this.databaseService.query<any>(
        `SELECT * FROM app_stock_adjustments ORDER BY created_at DESC`,
      );
      for (const r of rows) {
        const items = Array.isArray(r.items) ? r.items : JSON.parse(r.items || '[]');
        const adj = new StockAdjustmentEntity({
          id: r.id,
          adjustmentCode: r.adjustment_code,
          warehouseId: r.warehouse_id,
          warehouseName: r.warehouse_name,
          reason: r.reason,
          reasonDetail: r.reason_detail,
          totalLossValue: Number(r.total_loss_value || 0),
          status: r.status,
          items,
          creatorId: r.creator_id,
          creatorName: r.creator_name,
          creatorRole: r.creator_role,
          approverId: r.approver_id,
          approverName: r.approver_name,
          approvedAt: r.approved_at ? new Date(r.approved_at) : undefined,
          rejectReason: r.reject_reason,
          note: r.note,
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
        });
        this.adjustments.set(adj.id, adj);
      }
    } catch (err: any) {
      console.warn('[INVENTORY_SERVICE] Lỗi đồng bộ app_stock_adjustments từ DB:', err?.message);
    }
  }

  private seedInitialAdjustments(): void {
    const now = Date.now();
    const seed1 = new StockAdjustmentEntity({
      id: 'adj-seed-001',
      adjustmentCode: 'PDC-20261018-001',
      warehouseId: DEFAULT_WAREHOUSE_ID,
      warehouseName: DEFAULT_WAREHOUSE_NAME,
      reason: 'DAMAGED',
      reasonDetail: 'Hàng bị móp vỏ thùng và bể vỡ trong lúc dỡ hàng từ xe tải',
      totalLossValue: 1100000,
      status: 'APPROVED',
      creatorId: 'usr-wh-keeper',
      creatorName: 'Thủ kho Nguyễn Văn Kho',
      creatorRole: 'WAREHOUSE_KEEPER',
      approverId: 'usr-wh-manager',
      approverName: 'Quản lý kho Trần Văn Quản',
      approvedAt: new Date(now - 86400000 * 2),
      note: 'Đã lập biên bản sự việc và xử lý tồn kho',
      createdAt: new Date(now - 86400000 * 2 - 3600000),
      updatedAt: new Date(now - 86400000 * 2),
      items: [
        {
          id: 'adj-item-001',
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
          unit: 'Lon',
          currentStock: 340,
          adjustedQuantity: 2,
          unitPrice: 550000,
          lossValue: 1100000,
          reason: 'DAMAGED',
          note: 'Móp méo 2 lon',
        },
      ],
    });

    const seed2 = new StockAdjustmentEntity({
      id: 'adj-seed-002',
      adjustmentCode: 'PDC-20261020-002',
      warehouseId: DEFAULT_WAREHOUSE_ID,
      warehouseName: DEFAULT_WAREHOUSE_NAME,
      reason: 'EXPIRED',
      reasonDetail: 'Sản phẩm cận date hỏng màng co và quá hạn sử dụng tại kệ B-02',
      totalLossValue: 560000,
      status: 'PENDING',
      creatorId: 'usr-wh-keeper',
      creatorName: 'Thủ kho Nguyễn Văn Kho',
      creatorRole: 'WAREHOUSE_KEEPER',
      note: 'Đề nghị duyệt huỷ để dọn dẹp kệ kho',
      createdAt: new Date(now - 3600000 * 4),
      updatedAt: new Date(now - 3600000 * 4),
      items: [
        {
          id: 'adj-item-002',
          productId: 'prod-002',
          productSku: 'LH-NUT-180ML',
          productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
          unit: 'Hộp',
          currentStock: 1200,
          adjustedQuantity: 20,
          unitPrice: 28000,
          lossValue: 560000,
          reason: 'EXPIRED',
          note: 'Hết hạn sử dụng lô EXP-202610',
        },
      ],
    });

    this.adjustments.set(seed1.id, seed1);
    this.adjustments.set(seed2.id, seed2);
  }

  /**
   * SN-214: Lấy danh sách phiếu điều chỉnh tồn kho có lọc
   */
  async getStockAdjustments(
    query?: QueryStockAdjustmentsDto,
    currentUser?: ICurrentUser,
  ): Promise<StockAdjustmentEntity[]> {
    let list = Array.from(this.adjustments.values());

    const roles = currentUser?.roles || [];
    const isWarehouseStaff =
      roles.some((r) =>
        ['WAREHOUSE_MANAGER', 'WAREHOUSE_KEEPER', 'WAREHOUSE', 'WH_MANAGER'].includes(String(r)),
      ) && !roles.includes(UserRole.ADMIN);

    if (isWarehouseStaff) {
      const staffWhId = currentUser?.warehouseId;
      const staffWhName = (currentUser?.assignedWarehouse || currentUser?.warehouseName || '').toLowerCase();
      list = list.filter((a) => {
        if (staffWhId && a.warehouseId && a.warehouseId.toLowerCase() === staffWhId.toLowerCase()) {
          return true;
        }
        if (staffWhName) {
          const aWhName = (a.warehouseName || '').toLowerCase();
          return (
            aWhName.includes(staffWhName) ||
            staffWhName.includes(aWhName) ||
            (a.warehouseId && staffWhName.includes(a.warehouseId.toLowerCase()))
          );
        }
        return true;
      });
    }

    if (query?.status && query.status !== 'ALL') {
      const statusUpper = query.status.trim().toUpperCase();
      list = list.filter((a) => a.status.toUpperCase() === statusUpper);
    }

    if (query?.reason && query.reason !== 'ALL') {
      const reasonUpper = query.reason.trim().toUpperCase();
      list = list.filter((a) => a.reason.toUpperCase() === reasonUpper);
    }

    if (query?.warehouseId && query.warehouseId !== 'ALL' && !isWarehouseStaff) {
      const whId = query.warehouseId.trim().toUpperCase();
      list = list.filter((a) => a.warehouseId.toUpperCase() === whId);
    }

    if (query?.search) {
      const s = query.search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.adjustmentCode.toLowerCase().includes(s) ||
          (a.note && a.note.toLowerCase().includes(s)) ||
          a.creatorName.toLowerCase().includes(s) ||
          (a.approverName && a.approverName.toLowerCase().includes(s)) ||
          (a.reasonDetail && a.reasonDetail.toLowerCase().includes(s)),
      );
    }

    if (query?.fromDate) {
      const from = new Date(query.fromDate);
      if (!isNaN(from.getTime())) {
        list = list.filter((a) => new Date(a.createdAt).getTime() >= from.getTime());
      }
    }

    if (query?.toDate) {
      const to = new Date(query.toDate);
      if (!isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        list = list.filter((a) => new Date(a.createdAt).getTime() <= to.getTime());
      }
    }

    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * SN-214: Xem chi tiết phiếu điều chỉnh tồn kho
   */
  async getStockAdjustmentById(id: string): Promise<StockAdjustmentEntity> {
    const adj =
      this.adjustments.get(id) ||
      Array.from(this.adjustments.values()).find(
        (a) => a.adjustmentCode === id || a.id === id,
      );
    if (!adj) {
      throw new NotFoundException(`Không tìm thấy phiếu điều chỉnh tồn kho ${id}`);
    }
    return adj;
  }

  /**
   * SN-214: Lập phiếu điều chỉnh tồn kho (Chờ duyệt)
   * - Bắt buộc chọn lý do: DAMAGED, LOST, EXPIRED, OTHER (AC-1 & AC-2)
   * - Bắt buộc ghi rõ giá trị tổn thất (VNĐ) (AC-2)
   */
  async createStockAdjustment(
    dto: CreateStockAdjustmentDto,
    creator?: ICurrentUser,
  ): Promise<StockAdjustmentEntity> {
    if (!dto.reason || !['DAMAGED', 'LOST', 'EXPIRED', 'OTHER'].includes(dto.reason)) {
      throw new BadRequestException('Bắt buộc chọn lý do hợp lệ (Hàng hỏng, Hàng mất, Hàng hết hạn).');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Phiếu điều chỉnh phải chứa ít nhất một sản phẩm.');
    }

    let calculatedLoss = 0;
    for (const item of dto.items) {
      if (!item.adjustedQuantity || item.adjustedQuantity <= 0) {
        throw new BadRequestException(
          `Số lượng điều chỉnh của sản phẩm ${item.productName || item.productSku} phải lớn hơn 0.`,
        );
      }
      calculatedLoss += Number(item.lossValue || item.adjustedQuantity * item.unitPrice || 0);
    }

    const totalLossValue = Number(dto.totalLossValue ?? calculatedLoss);
    if (totalLossValue < 0) {
      throw new BadRequestException('Giá trị tổn thất (VNĐ) không được âm.');
    }

    const warehouseId = dto.warehouseId || DEFAULT_WAREHOUSE_ID;
    const warehouseName = dto.warehouseName || DEFAULT_WAREHOUSE_NAME;

    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const randCode = Math.floor(1000 + Math.random() * 9000);
    const adjustmentCode = `PDC-${dateStr}-${randCode}`;
    const id = `adj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const creatorId = creator?.userId || creator?.username || 'usr-wh-keeper';
    const creatorName = (creator as any)?.fullName || creator?.username || 'Thủ kho';
    const creatorRoles = creator?.roles || [];
    const creatorRole = creatorRoles.length > 0 ? String(creatorRoles[0]) : 'WAREHOUSE_KEEPER';

    const items: StockAdjustmentItemEntity[] = dto.items.map((item, idx) => ({
      id: `adj-item-${Date.now()}-${idx + 1}`,
      productId: item.productId,
      productSku: item.productSku,
      productName: item.productName,
      unit: item.unit,
      currentStock: Number(item.currentStock ?? 0),
      adjustedQuantity: Number(item.adjustedQuantity),
      unitPrice: Number(item.unitPrice ?? 0),
      lossValue: Number(item.lossValue ?? item.adjustedQuantity * item.unitPrice),
      reason: item.reason || dto.reason,
      note: item.note?.trim(),
    }));

    const adjustment = new StockAdjustmentEntity({
      id,
      adjustmentCode,
      warehouseId,
      warehouseName,
      reason: dto.reason,
      reasonDetail: dto.reasonDetail?.trim(),
      totalLossValue,
      status: 'PENDING',
      items,
      creatorId,
      creatorName,
      creatorRole,
      note: dto.note?.trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.adjustments.set(adjustment.id, adjustment);

    if (this.databaseService?.isConnected()) {
      try {
        await this.ensureStockAdjustmentsTable();
        await this.databaseService.query(
          `INSERT INTO app_stock_adjustments (
            id, adjustment_code, warehouse_id, warehouse_name, reason,
            reason_detail, total_loss_value, status, items,
            creator_id, creator_name, creator_role, approver_id, approver_name,
            approved_at, reject_reason, note, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (id) DO NOTHING`,
          [
            adjustment.id,
            adjustment.adjustmentCode,
            adjustment.warehouseId,
            adjustment.warehouseName,
            adjustment.reason,
            adjustment.reasonDetail || '',
            adjustment.totalLossValue,
            adjustment.status,
            JSON.stringify(adjustment.items),
            adjustment.creatorId,
            adjustment.creatorName,
            adjustment.creatorRole,
            null,
            null,
            null,
            null,
            adjustment.note || null,
            adjustment.createdAt,
            adjustment.updatedAt,
          ],
        );
      } catch (err: any) {
        console.warn('[INVENTORY_SERVICE] Lỗi lưu phiếu điều chỉnh vào DB:', err?.message);
      }
    }

    return adjustment;
  }

  /**
   * SN-214: Phê duyệt phiếu điều chỉnh tồn kho
   * - Chỉ Quản lý kho (WAREHOUSE_MANAGER, WH_MANAGER, ADMIN) được duyệt (AC-3)
   * - Người lập và người duyệt KHÔNG ĐƯỢC là một (creatorId !== approverId) (AC-3)
   * - Ghi nhận Thẻ kho với transactionType: 'ADJUSTMENT' (AC-4)
   * - Khấu trừ tồn kho thực tế
   */
  async approveStockAdjustment(
    id: string,
    approver?: ICurrentUser,
  ): Promise<StockAdjustmentEntity> {
    const adjustment =
      this.adjustments.get(id) ||
      Array.from(this.adjustments.values()).find(
        (a) => a.adjustmentCode === id || a.id === id,
      );

    if (!adjustment) {
      throw new NotFoundException(`Không tìm thấy phiếu điều chỉnh tồn kho ${id}`);
    }

    if (adjustment.status !== 'PENDING') {
      throw new BadRequestException(
        `Phiếu điều chỉnh đã ở trạng thái ${adjustment.status}, không thể phê duyệt lại.`,
      );
    }

    // Kiểm tra quyền Quản lý kho / Admin
    const approverRoles = (approver?.roles || []).map((r) => String(r).toUpperCase());
    const isManagerOrAdmin =
      approverRoles.some((r) =>
        ['ADMIN', 'WAREHOUSE_MANAGER', 'WH_MANAGER'].includes(r),
      ) || (approver as any)?.role === 'ADMIN' || (approver as any)?.role === 'WAREHOUSE_MANAGER';

    if (!isManagerOrAdmin) {
      throw new ForbiddenException(
        'Chỉ Quản lý kho hoặc Quản trị viên mới có quyền phê duyệt phiếu điều chỉnh tồn kho.',
      );
    }

    // Kiểm tra quy tắc SN-214: creatorId !== approverId
    const approverUserId = approver?.userId;
    const approverUsername = approver?.username;

    const isSamePerson =
      Boolean(approverUserId && adjustment.creatorId && approverUserId === adjustment.creatorId) ||
      Boolean(
        approverUsername &&
          adjustment.creatorName &&
          approverUsername.toLowerCase() === adjustment.creatorName.toLowerCase(),
      );

    if (isSamePerson) {
      throw new BadRequestException(
        'Chỉ Quản lý kho được duyệt và người lập với người duyệt không được là một người (Quy tắc SN-214: creatorId !== approverId).',
      );
    }

    const reasonMap: Record<string, string> = {
      DAMAGED: 'Hàng hỏng hóc, bể vỡ',
      LOST: 'Hàng thất thoát, mất',
      EXPIRED: 'Hàng hết hạn sử dụng',
      OTHER: 'Khác',
    };
    const reasonText = reasonMap[adjustment.reason] || adjustment.reason;

    // Tiến hành trừ tồn kho và ghi nhận Thẻ kho (AC-4)
    for (const item of adjustment.items) {
      const currentBook = item.currentStock;
      const newStock = Math.max(0, currentBook - item.adjustedQuantity);

      // 1. Cập nhật productsService stock
      try {
        await this.productsService.setStockQuantity(item.productId, newStock);
      } catch (e) {
        try {
          const p = await this.productsService.findById(item.productSku);
          if (p) {
            await this.productsService.setStockQuantity(p.id, newStock);
          }
        } catch {}
      }

      // 2. Cập nhật DB inventories & app_inventory_stock_balances nếu có DB
      if (this.databaseService?.isConnected()) {
        try {
          await this.databaseService.query(
            `UPDATE app_inventory_stock_balances
             SET physical_quantity = GREATEST(0, physical_quantity - $2), updated_at = CURRENT_TIMESTAMP
             WHERE product_sku = UPPER($1)`,
            [item.productSku, item.adjustedQuantity],
          );
          await this.databaseService.query(
            `UPDATE inventories
             SET on_hand = GREATEST(0, on_hand - $2), updated_at = CURRENT_TIMESTAMP
             WHERE product_id = $1`,
            [item.productId, item.adjustedQuantity],
          );
        } catch (e) {
          // Fallback handled in-memory
        }
      }

      // 3. Ghi Thẻ kho với transactionType = 'ADJUSTMENT' (AC-4)
      const tx = new InventoryTransactionEntity({
        productId: item.productId,
        sku: item.productSku,
        productName: item.productName,
        transactionType: 'ADJUSTMENT',
        inputQuantity: item.adjustedQuantity,
        inputUnit: item.unit,
        conversionRate: 1,
        baseQuantityChange: -item.adjustedQuantity,
        baseUnit: item.unit,
        previousStock: currentBook,
        newStock: newStock,
        reason: `Điều chỉnh tồn kho [${adjustment.adjustmentCode}] - Lý do: ${reasonText}. Giá trị tổn thất: ${Number(adjustment.totalLossValue).toLocaleString('vi-VN')} đ${item.note ? ` (${item.note})` : ''}`,
        referenceCode: adjustment.adjustmentCode,
        warehouse: adjustment.warehouseName,
        performedBy: (approver as any)?.fullName || approver?.username || 'Quản lý kho',
        createdAt: new Date(),
      });

      this.writeLedger(tx);
    }

    // Cập nhật trạng thái phiếu
    adjustment.status = 'APPROVED';
    adjustment.approverId = approverUserId || 'usr-approver';
    adjustment.approverName = (approver as any)?.fullName || approverUsername || 'Quản lý kho';
    adjustment.approvedAt = new Date();
    adjustment.updatedAt = new Date();

    this.adjustments.set(adjustment.id, adjustment);

    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `UPDATE app_stock_adjustments
           SET status = $1, approver_id = $2, approver_name = $3, approved_at = $4, updated_at = CURRENT_TIMESTAMP
           WHERE id = $5`,
          [
            adjustment.status,
            adjustment.approverId,
            adjustment.approverName,
            adjustment.approvedAt,
            adjustment.id,
          ],
        );
      } catch (err: any) {
        console.warn('[INVENTORY_SERVICE] Lỗi cập nhật trạng thái duyệt vào DB:', err?.message);
      }
    }

    return adjustment;
  }

  /**
   * SN-214: Từ chối phiếu điều chỉnh tồn kho
   * - Chỉ Quản lý kho (WAREHOUSE_MANAGER, WH_MANAGER, ADMIN)
   * - Ghi rõ lý do từ chối
   */
  async rejectStockAdjustment(
    id: string,
    dto: RejectStockAdjustmentDto,
    approver?: ICurrentUser,
  ): Promise<StockAdjustmentEntity> {
    const adjustment =
      this.adjustments.get(id) ||
      Array.from(this.adjustments.values()).find(
        (a) => a.adjustmentCode === id || a.id === id,
      );

    if (!adjustment) {
      throw new NotFoundException(`Không tìm thấy phiếu điều chỉnh tồn kho ${id}`);
    }

    if (adjustment.status !== 'PENDING') {
      throw new BadRequestException(
        `Phiếu điều chỉnh đã ở trạng thái ${adjustment.status}, không thể từ chối.`,
      );
    }

    if (!dto?.rejectReason?.trim()) {
      throw new BadRequestException('Bắt buộc ghi rõ lý do từ chối phiếu điều chỉnh.');
    }

    const approverRoles = (approver?.roles || []).map((r) => String(r).toUpperCase());
    const isManagerOrAdmin =
      approverRoles.some((r) =>
        ['ADMIN', 'WAREHOUSE_MANAGER', 'WH_MANAGER'].includes(r),
      ) || (approver as any)?.role === 'ADMIN' || (approver as any)?.role === 'WAREHOUSE_MANAGER';

    if (!isManagerOrAdmin) {
      throw new ForbiddenException(
        'Chỉ Quản lý kho hoặc Quản trị viên mới có quyền từ chối phiếu điều chỉnh tồn kho.',
      );
    }

    adjustment.status = 'REJECTED';
    adjustment.rejectReason = dto.rejectReason.trim();
    adjustment.approverId = approver?.userId || 'usr-approver';
    adjustment.approverName = (approver as any)?.fullName || approver?.username || 'Quản lý kho';
    adjustment.updatedAt = new Date();

    this.adjustments.set(adjustment.id, adjustment);

    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `UPDATE app_stock_adjustments
           SET status = $1, reject_reason = $2, approver_id = $3, approver_name = $4, updated_at = CURRENT_TIMESTAMP
           WHERE id = $5`,
          [
            adjustment.status,
            adjustment.rejectReason,
            adjustment.approverId,
            adjustment.approverName,
            adjustment.id,
          ],
        );
      } catch (err: any) {
        console.warn('[INVENTORY_SERVICE] Lỗi cập nhật từ chối phiếu vào DB:', err?.message);
      }
    }

    return adjustment;
  }


  /**
   * SN-229 / SN-220: Xuất báo cáo tồn kho ra tệp Excel (.xlsx) gửi Kế toán
   * Giữ nguyên ba cột tồn: Tồn Thực Tế, Tồn Tạm Giữ, Tồn Khả Dụng
   * Tên tệp chứa mã kho và ngày xuất theo múi giờ hệ thống (vi-VN): TonKho_KHO01_YYYY-MM-DD.xlsx
   */
  async exportStockExcel(
    query?: {
      warehouse?: string;
      warehouseId?: string;
      category?: string;
      status?: string;
      search?: string;
    },
    currentUser?: ICurrentUser,
  ): Promise<{ buffer: Buffer; fileName: string; totalItems: number }> {
    const rawWh = query?.warehouseId || query?.warehouse;

    // 1. Lấy toàn bộ dữ liệu thỏa mãn bộ lọc (bao gồm tất cả các trang)
    const items = await this.getStockOverview(query, currentUser);

    if (!items || items.length === 0) {
      throw new BadRequestException('Không tìm thấy dữ liệu tồn kho nào phù hợp với bộ lọc để xuất Excel');
    }

    // 2. Xác định mã kho và tên kho
    let warehouseCode = 'ALL';
    let warehouseName = 'Tất cả kho hàng';

    if (rawWh && rawWh !== 'ALL') {
      const resolved = await this.resolveWarehouseId(rawWh);
      if (resolved) {
        warehouseCode = resolved.code || 'KHO01';
        warehouseName = resolved.name || 'Kho hàng';
      } else {
        const stdWh = STANDARD_WAREHOUSES.find(
          (w) => w.id === rawWh || w.code === rawWh || w.name === rawWh,
        );
        if (stdWh) {
          warehouseCode = stdWh.code;
          warehouseName = stdWh.name;
        } else {
          warehouseCode = rawWh;
        }
      }
    } else {
      const roles = currentUser?.roles || [];
      const isAdmin = roles.includes(UserRole.ADMIN);
      const isManager = roles.includes(UserRole.WAREHOUSE_MANAGER) || roles.includes(UserRole.WH_MANAGER as any) || isAdmin;
      const isKeeper = (roles.includes(UserRole.WAREHOUSE_KEEPER) || roles.includes(UserRole.WAREHOUSE as any)) && !isManager;
      if (isKeeper) {
        const myWhId = currentUser?.warehouseId || currentUser?.warehouseCode || currentUser?.assignedWarehouse;
        if (myWhId) {
          const resolved = await this.resolveWarehouseId(myWhId);
          if (resolved) {
            warehouseCode = resolved.code;
            warehouseName = resolved.name;
          }
        }
      }
    }

    // 3. Thời gian xuất theo múi giờ Việt Nam (UTC+7)
    const now = new Date();
    const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
    const vnTime = new Date(utcTime + 7 * 3600000);
    const yyyy = vnTime.getFullYear();
    const mm = String(vnTime.getMonth() + 1).padStart(2, '0');
    const dd = String(vnTime.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const timeFormatted = `${dd}/${mm}/${yyyy} ${String(vnTime.getHours()).padStart(2, '0')}:${String(vnTime.getMinutes()).padStart(2, '0')}:${String(vnTime.getSeconds()).padStart(2, '0')}`;

    const cleanWhCode = warehouseCode.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `TonKho_${cleanWhCode}_${dateStr}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'LOHA SALES & WAREHOUSE SYSTEM';
    workbook.lastModifiedBy = currentUser?.username || 'Quản lý kho';
    workbook.created = vnTime;
    workbook.modified = vnTime;

    const ws = workbook.addWorksheet('Bao_Cao_Ton_Kho', {
      views: [{ showGridLines: true, state: 'frozen', ySplit: 5 }],
    });

    // 4. Thiết lập độ rộng 11 cột
    ws.columns = [
      { key: 'stt', width: 8 },
      { key: 'sku', width: 18 },
      { key: 'productName', width: 44 },
      { key: 'category', width: 22 },
      { key: 'baseUnit', width: 14 },
      { key: 'warehouse', width: 28 },
      { key: 'physicalStock', width: 16 },
      { key: 'reservedStock', width: 16 },
      { key: 'availableStock', width: 16 },
      { key: 'minStock', width: 16 },
      { key: 'status', width: 20 },
    ];

    // Hàng 1: Tên đơn vị / Doanh nghiệp
    ws.mergeCells('A1:K1');
    const row1 = ws.getCell('A1');
    row1.value = 'HỆ THỐNG QUẢN LÝ BÁN HÀNG & PHÂN PHỐI B2B LOHA';
    row1.font = { name: 'Arial', size: 13, bold: true, color: { argb: 'FF1E3A8A' } };
    row1.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 24;

    // Hàng 2: Tiêu đề báo cáo
    ws.mergeCells('A2:K2');
    const row2 = ws.getCell('A2');
    row2.value = 'BÁO CÁO TỒN KHO HÀNG HÓA';
    row2.font = { name: 'Arial', size: 15, bold: true, color: { argb: 'FF0F172A' } };
    row2.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 28;

    // Hàng 3: Metadata kho & thời điểm xuất
    ws.mergeCells('A3:K3');
    const row3 = ws.getCell('A3');
    const exporterName = currentUser?.username || 'Quản lý kho';
    row3.value = `Kho hàng: ${warehouseName} (${warehouseCode}) | Thời điểm xuất: ${timeFormatted} | Người lập: ${exporterName}`;
    row3.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF475569' } };
    row3.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(3).height = 20;

    // Hàng 4: Bộ lọc áp dụng
    ws.mergeCells('A4:K4');
    const row4 = ws.getCell('A4');
    let statusText = 'Tất cả trạng thái';
    if (query?.status === 'BELOW_MIN_STOCK') statusText = 'Dưới tồn tối thiểu';
    else if (query?.status === 'IN_STOCK') statusText = 'Còn hàng';
    else if (query?.status === 'OUT_OF_STOCK') statusText = 'Hết hàng (Tồn khả dụng = 0)';
    const filterCat = query?.category && query.category !== 'ALL' ? `Nhóm hàng: ${query.category}` : 'Tất cả nhóm hàng';
    const filterSearch = query?.search?.trim() ? `Từ khóa: "${query.search.trim()}"` : 'Tất cả sản phẩm';
    row4.value = `Phạm vi bộ lọc: [ ${filterCat} ] • [ Trạng thái: ${statusText} ] • [ ${filterSearch} ] • [ Tổng cộng: ${items.length} mặt hàng ] • [ Mẫu tồn kho chuẩn hệ thống ]`;
    row4.font = { name: 'Arial', size: 9.5, italic: true, color: { argb: 'FF64748B' } };
    row4.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(4).height = 20;

    // Hàng 5: Tiêu đề các cột chuẩn hóa
    const headers = [
      'STT',
      'Mã SKU',
      'Tên sản phẩm',
      'Nhóm ngành hàng',
      'ĐVT cơ sở',
      'Kho hàng',
      'Tồn Thực Tế',
      'Tồn Tạm Giữ',
      'Tồn Khả Dụng',
      'Tồn Tối Thiểu',
      'Tình Trạng',
    ];

    const headerRow = ws.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
      };
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
    });

    let sumPhysical = 0;
    let sumReserved = 0;
    let sumAvailable = 0;

    // 5. Đổ dữ liệu các dòng
    items.forEach((item, index) => {
      const physical = Number(item.physicalStock ?? item.physicalStockQuantity ?? item.physicalQuantity ?? 0);
      const reserved = Number(item.reservedStock ?? item.reservedQuantity ?? 0);
      const available = Number(item.availableStock ?? item.availableQuantity ?? item.stockQuantity ?? (physical - reserved));
      const minStock = Number(item.minStockLevel || 0);

      sumPhysical += physical;
      sumReserved += reserved;
      sumAvailable += available;

      let statusStr = 'Còn hàng';
      if (available <= 0) {
        statusStr = 'Hết hàng';
      } else if (item.isBelowMinStock || (minStock > 0 && available <= minStock)) {
        statusStr = 'Dưới tồn tối thiểu';
      }

      const dataRow = ws.addRow([
        index + 1,
        String(item.sku || ''),
        item.name || item.productName || item.sku,
        item.category || item.parentCategory || 'Chung',
        item.baseUnit || 'Đơn vị',
        item.warehouse || warehouseName,
        physical,
        reserved,
        available,
        minStock,
        statusStr,
      ]);

      dataRow.height = 22;

      // Căn chỉnh và định dạng số
      dataRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }; // STT
      dataRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' }; // SKU
      dataRow.getCell(2).numFmt = '@'; // Định dạng text để giữ nguyên số 0 đầu
      dataRow.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' }; // Tên SP
      dataRow.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' }; // Ngành hàng
      dataRow.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' }; // ĐVT
      dataRow.getCell(6).alignment = { horizontal: 'left', vertical: 'middle' }; // Kho

      // 3 CỘT TỒN ĐỊNH DẠNG SỐ #,##0
      dataRow.getCell(7).numFmt = '#,##0';
      dataRow.getCell(7).alignment = { horizontal: 'right', vertical: 'middle' };
      dataRow.getCell(8).numFmt = '#,##0';
      dataRow.getCell(8).alignment = { horizontal: 'right', vertical: 'middle' };
      dataRow.getCell(9).numFmt = '#,##0';
      dataRow.getCell(9).alignment = { horizontal: 'right', vertical: 'middle' };
      dataRow.getCell(10).numFmt = '#,##0';
      dataRow.getCell(10).alignment = { horizontal: 'right', vertical: 'middle' };
      dataRow.getCell(11).alignment = { horizontal: 'center', vertical: 'middle' };

      // Border mờ
      dataRow.eachCell((cell) => {
        cell.font = { name: 'Arial', size: 10 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
      });

      // Highlight nếu dưới tồn tối thiểu hoặc hết hàng
      if (statusStr === 'Hết hàng') {
        dataRow.getCell(11).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFE11D48' } };
      } else if (statusStr === 'Dưới tồn tối thiểu') {
        dataRow.getCell(11).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFD97706' } };
      }
    });

    // 6. DÒNG TỔNG CỘNG (TOTAL ROW)
    const totalRowIndex = 5 + items.length + 1;
    ws.mergeCells(`A${totalRowIndex}:F${totalRowIndex}`);
    const totalLabelCell = ws.getCell(`A${totalRowIndex}`);
    totalLabelCell.value = `TỔNG CỘNG (${items.length} mặt hàng)`;
    totalLabelCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    totalLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const totalRow = ws.getRow(totalRowIndex);
    totalRow.height = 26;

    // Gán giá trị tổng cộng cho 3 cột tồn (Công thức SUM kết hợp giá trị tính sẵn)
    const startDataRow = 6;
    const endDataRow = 5 + items.length;

    const cellPhys = ws.getCell(`G${totalRowIndex}`);
    cellPhys.value = {
      formula: `SUM(G${startDataRow}:G${endDataRow})`,
      result: sumPhysical,
    };
    cellPhys.numFmt = '#,##0';
    cellPhys.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF1E40AF' } };
    cellPhys.alignment = { horizontal: 'right', vertical: 'middle' };

    const cellRes = ws.getCell(`H${totalRowIndex}`);
    cellRes.value = {
      formula: `SUM(H${startDataRow}:H${endDataRow})`,
      result: sumReserved,
    };
    cellRes.numFmt = '#,##0';
    cellRes.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFB45309' } };
    cellRes.alignment = { horizontal: 'right', vertical: 'middle' };

    const cellAvail = ws.getCell(`I${totalRowIndex}`);
    cellAvail.value = {
      formula: `SUM(I${startDataRow}:I${endDataRow})`,
      result: sumAvailable,
    };
    cellAvail.numFmt = '#,##0';
    cellAvail.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF047857' } };
    cellAvail.alignment = { horizontal: 'right', vertical: 'middle' };

    totalRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF1F5F9' },
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF0F172A' } },
        bottom: { style: 'double', color: { argb: 'FF0F172A' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    });

    // Kích hoạt bộ lọc AutoFilter
    ws.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: 5 + items.length, column: 11 },
    };

    const uint8Array = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.from(uint8Array);

    return {
      buffer,
      fileName,
      totalItems: items.length,
    };
  }

  /**
   * Xử lý sản phẩm lỗi (Đưa sang tồn kho bán hàng hoặc Tiêu hủy)
   */
  async processDamagedStock(
    dto: {
      warehouseId: string;
      productId: string;
      productSku: string;
      batchNumber?: string;
      expiryDate?: string;
      action: 'TO_STOCK' | 'DESTROY';
      quantity: number;
      reason: string;
    },
    currentUser?: ICurrentUser,
  ): Promise<{ success: boolean; message: string; remainingQuantity: number }> {
    const qty = Number(dto.quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new BadRequestException('Số lượng xử lý phải lớn hơn 0');
    }
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('Vui lòng nhập lý do xử lý');
    }

    const batch = dto.batchNumber ? dto.batchNumber.trim() : '';
    const sku = dto.productSku.toUpperCase().trim();
    let remaining = 0;

    if (this.databaseService?.isConnected()) {
      const client = await this.databaseService.getClient();
      try {
        await client.query('BEGIN');

        // 1. Tìm bản ghi hàng lỗi trong damaged_stock_balances
        const checkSql = `
          SELECT id, quantity, warehouse_id, product_id, product_sku, batch_number
          FROM damaged_stock_balances
          WHERE (warehouse_id = $1 OR warehouse_id::text = $1)
            AND (UPPER(product_sku) = $2 OR product_id = $3)
            AND (batch_number = $4 OR ($4 = '' AND (batch_number IS NULL OR batch_number = '')))
          LIMIT 1 FOR UPDATE;
        `;
        const checkRes = await client.query(checkSql, [dto.warehouseId, sku, dto.productId, batch]);

        if (!checkRes.rows[0]) {
          throw new NotFoundException('Không tìm thấy sản phẩm lỗi này tại kho đã chọn');
        }

        const currentDamaged = Number(checkRes.rows[0].quantity || 0);
        if (qty > currentDamaged) {
          throw new BadRequestException(
            `Số lượng xử lý (${qty}) vượt quá số lượng lỗi hiện có (${currentDamaged})`,
          );
        }

        remaining = Math.max(0, currentDamaged - qty);

        // 2. Trừ số lượng khỏi damaged_stock_balances
        await client.query(
          `UPDATE damaged_stock_balances
           SET quantity = $1, updated_at = NOW()
           WHERE id = $2;`,
          [remaining, checkRes.rows[0].id],
        );

        const performedBy = currentUser?.username || (currentUser as any)?.fullName || 'Quản lý kho';

        // 3. Thực hiện nghiệp vụ được chọn
        if (dto.action === 'TO_STOCK') {
          // A. Cộng vào inventories (kho bán hàng)
          const targetProdId = checkRes.rows[0].product_id || dto.productId;
          await client.query(
            `INSERT INTO inventories (warehouse_id, product_id, on_hand, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3, NOW(), NOW())
             ON CONFLICT (warehouse_id, product_id)
             DO UPDATE SET on_hand = inventories.on_hand + $3, updated_at = NOW();`,
            [dto.warehouseId, targetProdId, qty],
          );

          // B. Cộng vào app_inventory_stock_balances
          await client.query(
            `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity, updated_at)
             VALUES ($1, $2::uuid, $3, NOW())
             ON CONFLICT (product_sku, warehouse_id)
             DO UPDATE SET physical_quantity = app_inventory_stock_balances.physical_quantity + $3, updated_at = NOW();`,
            [sku, dto.warehouseId, qty],
          );

          // C. Nếu có số lô, cộng vào inventory_batches với đầy đủ expiry_date
          if (batch) {
            // Tìm thông tin hạn sử dụng và ngày sản xuất gốc của lô nếu có
            let resolvedExpiryDate: any = dto.expiryDate || null;
            let resolvedMfgDate: any = null;
            let resolvedCost: number = 0;

            const existingBatchRes = await client.query(
              `SELECT expiry_date, mfg_date, cost_price
               FROM inventory_batches
               WHERE (batch_number = $1 OR batch_no = $1)
               ORDER BY created_at DESC LIMIT 1;`,
              [batch],
            );
            if (existingBatchRes.rows[0]) {
              const fb = existingBatchRes.rows[0];
              if (!resolvedExpiryDate && fb.expiry_date) {
                resolvedExpiryDate = fb.expiry_date;
              }
              resolvedMfgDate = fb.mfg_date || null;
              resolvedCost = Number(fb.cost_price || 0);
            }

            // Nếu vẫn chưa có expiry_date, gán mặc định 1 năm để FEFO luôn hoạt động chính xác
            if (!resolvedExpiryDate) {
              const d = new Date();
              d.setFullYear(d.getFullYear() + 1);
              resolvedExpiryDate = d.toISOString().split('T')[0];
            }

            await client.query(
              `INSERT INTO inventory_batches (
                 warehouse_id, product_id, batch_number, batch_no, sku_code,
                 expiry_date, mfg_date, cost_price, quantity, status, created_at, updated_at
               )
               VALUES (
                 $1::uuid, $2::uuid, $3, $3, $4,
                 $5, $6, $7, $8, 'ACTIVE', NOW(), NOW()
               )
               ON CONFLICT (warehouse_id, product_id, batch_number)
               DO UPDATE SET
                 quantity = inventory_batches.quantity + $8,
                 expiry_date = COALESCE(inventory_batches.expiry_date, EXCLUDED.expiry_date),
                 updated_at = NOW();`,
              [
                dto.warehouseId,
                targetProdId,
                batch,
                sku,
                resolvedExpiryDate,
                resolvedMfgDate,
                resolvedCost,
                qty,
              ],
            );
          }

          // D. Ghi thẻ kho giao dịch
          await client.query(
            `INSERT INTO app_inventory_transactions (
               id, product_id, sku, product_name, transaction_type,
               input_quantity, input_unit, conversion_rate, base_quantity_change, base_unit,
               previous_stock, new_stock, reason, reference_code, warehouse, performed_by, created_at
             ) VALUES ($1, $2, $3, $4, 'IMPORT', $5, $6, 1, $5, $6, 0, $5, $7, $8, $9, $10, NOW());`,
            [
              `tx-dmg-restore-${Date.now()}`,
              targetProdId,
              sku,
              sku,
              qty,
              'Cơ sở',
              `Chuyển từ kho hàng lỗi sang tồn kho bán hàng: ${dto.reason.trim()}`,
              `DAMAGED-RESTORE`,
              dto.warehouseId,
              performedBy,
            ],
          );
        } else {
          // B. Tiêu hủy (DESTROY): Ghi thẻ kho xuất hủy
          const targetProdId = checkRes.rows[0].product_id || dto.productId;
          await client.query(
            `INSERT INTO app_inventory_transactions (
               id, product_id, sku, product_name, transaction_type,
               input_quantity, input_unit, conversion_rate, base_quantity_change, base_unit,
               previous_stock, new_stock, reason, reference_code, warehouse, performed_by, created_at
             ) VALUES ($1, $2, $3, $4, 'DISCARD', $5, $6, 1, (-1 * $5::numeric), $6, $5, 0, $7, $8, $9, $10, NOW());`,
            [
              `tx-dmg-destroy-${Date.now()}`,
              targetProdId,
              sku,
              sku,
              qty,
              'Cơ sở',
              `Tiêu hủy hàng lỗi: ${dto.reason.trim()}`,
              `DAMAGED-DESTROY`,
              dto.warehouseId,
              performedBy,
            ],
          );
        }

        await client.query('COMMIT');
      } catch (err: any) {
        await client.query('ROLLBACK');
        this.logger.error(`Lỗi processDamagedStock: ${err.message}`);
        throw err;
      } finally {
        client.release();
      }
    }

    return {
      success: true,
      message:
        dto.action === 'TO_STOCK'
          ? `Đã chuyển ${qty} sản phẩm sang tồn kho bán hàng thành công.`
          : `Đã hoàn tất tiêu hủy ${qty} sản phẩm lỗi.`,
      remainingQuantity: remaining,
    };
  }
}


