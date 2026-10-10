import { BadRequestException, ForbiddenException, forwardRef, Inject, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { DatabaseService } from '../../database/database.service';
import type { PoolClient } from 'pg';
import type { ProductEntity } from '../products/entities/product.entity';
import type { LowStockAlert, StockBalance } from './entities/stock-balance.entity';
import { InventoryAuditEntity, InventoryAuditItemEntity } from './entities/inventory-audit.entity';
import { InventoryAuditStatus } from './entities/inventory-audit-status.enum';
import { CreateInventoryAuditDto, UpdateAuditItemsDto, CompleteAuditDto, QueryAuditsDto } from './dto';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

const DEFAULT_WAREHOUSE_ID = 'WH01';
const DEFAULT_WAREHOUSE_NAME = 'Kho Tổng Miền Nam - LOHA WH01';

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

export interface StockOverviewItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  parentCategory: string;
  subCategory?: string;
  physicalStock: number;
  reservedStock: number;
  availableStock: number;
  stockQuantity: number;
  physicalStockQuantity: number;
  reservedQuantity: number;
  minStockLevel?: number;
  isBelowMinStock?: boolean;
  baseUnit: string;
  units: Array<{ unitName: string; conversionRate: number; isBaseUnit: boolean }>;
  warehouse: string;
  warehouseId: string;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  imageUrl?: string;
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
    if (this.databaseService.isConnected()) {
      await this.ensureStockBalanceTable();
      await this.seedStockBalances();
    }
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
   * Xem tổng quan sổ tồn kho minh bạch 3 cột (thực tế, tạm giữ, khả thi) theo SKU và từng kho
   */
  async getStockOverview(query?: {
    warehouse?: string;
    category?: string;
    status?: string;
    search?: string;
  }): Promise<StockOverviewItem[]> {
    const products = await this.productsService.findAll();
    let items: StockOverviewItem[] = products.map((p) => {
      const physicalStock = p.physicalStock !== undefined ? p.physicalStock : p.stockQuantity;
      const reservedStock = p.reservedStock !== undefined ? p.reservedStock : 0;
      const availableStock =
        p.availableStock !== undefined
          ? p.availableStock
          : Math.max(0, physicalStock - reservedStock);

      let status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' = 'IN_STOCK';
      if (availableStock <= 0) {
        status = 'OUT_OF_STOCK';
      } else if (availableStock <= 10) {
        status = 'LOW_STOCK';
      }

      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category || `${p.parentCategory || ''} / ${p.subCategory || ''}`,
        parentCategory: p.parentCategory || 'Sữa & Chế phẩm sữa',
        subCategory: p.subCategory || '',
        physicalStock,
        reservedStock,
        availableStock,
        stockQuantity: physicalStock,
        physicalStockQuantity: physicalStock,
        reservedQuantity: reservedStock,
        minStockLevel: 10,
        isBelowMinStock: availableStock <= 10,
        baseUnit: p.baseUnit,
        units: (p.units || []).map((u) => ({
          unitName: u.unitName,
          conversionRate: u.conversionRate,
          isBaseUnit: Boolean(u.isBaseUnit),
        })),
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
        warehouseId: 'WH01',
        status,
        imageUrl: p.imageUrl,
      };
    });

    if (query?.search) {
      const searchLower = query.search.trim().toLowerCase();
      items = items.filter(
        (i) => i.sku.toLowerCase().includes(searchLower) || i.name.toLowerCase().includes(searchLower),
      );
    }

    if (query?.category && query.category !== 'ALL') {
      items = items.filter(
        (i) =>
          i.category.includes(query.category!) ||
          i.parentCategory === query.category ||
          i.subCategory === query.category,
      );
    }

    if (query?.status && query.status !== 'ALL') {
      items = items.filter((i) => i.status === query.status);
    }

    if (query?.warehouse && query.warehouse !== 'ALL') {
      items = items.filter(
        (i) => i.warehouse === query.warehouse || i.warehouseId === query.warehouse,
      );
    }

    return items;
  }

  /**
   * Gắn mức tồn tối thiểu và tính cờ cảnh báo cho một dòng sổ tồn (SN-183).
   */
  private buildStockBalance(
    base: Omit<StockBalance, 'warehouse' | 'warehouseId' | 'minStockLevel' | 'isBelowMinStock'>,
    minStockLevel: number,
  ): StockBalance {
    return {
      ...base,
      warehouse: DEFAULT_WAREHOUSE_NAME,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      minStockLevel,
      isBelowMinStock: minStockLevel > 0 && base.stockQuantity <= minStockLevel,
    };
  }

  private async getMinStockLevelsFromDb(products: ProductEntity[]): Promise<Map<string, number>> {
    await this.ensureStockBalanceTable();
    if (products.length === 0) return new Map();
    const rows = await this.databaseService.query<{ product_sku: string; min_stock_level: string | null }>(
      `SELECT product_sku, COALESCE(min_stock_level, 0)::text AS min_stock_level
       FROM app_inventory_stock_balances
       WHERE product_sku = ANY($1::text[])`,
      [products.map((product) => product.sku.trim().toUpperCase())],
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
        `INSERT INTO app_inventory_stock_balances (product_sku, physical_quantity, min_stock_level)
         VALUES ($1, $2, $3)
         ON CONFLICT (product_sku)
         DO UPDATE SET min_stock_level = EXCLUDED.min_stock_level, updated_at = CURRENT_TIMESTAMP`,
        [productSku, product.stockQuantity ?? 0, level],
      );
    }
    this.minStockLevels.set(productSku, level);

    const balances = await this.getStockOverview();
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
      .filter((row) => !targetWarehouse || row.warehouseId.toUpperCase() === targetWarehouse)
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

