import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { DatabaseService } from '../../database/database.service';

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

  constructor(
    private readonly productsService: ProductsService,
    private readonly databaseService: DatabaseService,
  ) {}

  onModuleInit(): void {
    if (this.ledger.size === 0) {
      this.seedInitialTransactions();
    }
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
   * Xem tồn kho khả dụng của danh mục sản phẩm kèm đơn vị quy đổi
   */
  async getStockOverview(): Promise<
    Array<{
      sku: string;
      name: string;
      stockQuantity: number;
      physicalStockQuantity: number;
      reservedQuantity: number;
      baseUnit: string;
      units: Array<{ unitName: string; conversionRate: number; isBaseUnit: boolean }>;
      warehouse: string;
    }>
  > {
    const products = await this.productsService.findAll();
    const reservationResult = await this.databaseService.query<{ product_sku: string; reserved: string }>(
      `SELECT product_sku, COALESCE(SUM(base_quantity), 0)::text AS reserved
       FROM app_order_inventory_reservations WHERE status = 'RESERVED' GROUP BY product_sku`,
    );
    const reservations = new Map(
      reservationResult.map((row) => [row.product_sku.toUpperCase(), Number(row.reserved)]),
    );
    return products.map((p) => {
      const reservedQuantity = reservations.get(p.sku.toUpperCase()) ?? 0;
      return {
        sku: p.sku,
        name: p.name,
        stockQuantity: Math.max(0, p.stockQuantity - reservedQuantity),
        physicalStockQuantity: p.stockQuantity,
        reservedQuantity,
        baseUnit: p.baseUnit,
        units: (p.units || []).map((u) => ({
          unitName: u.unitName,
          conversionRate: u.conversionRate,
          isBaseUnit: u.isBaseUnit,
        })),
        warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
      };
    });
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
    // Cần productId để acquire lock — lookup trước khi vào critical section
    const productLookup = await this.productsService.findById(dto.productSku);
    const productId = productLookup.id;

    // === CRITICAL SECTION BẮT ĐẦU ===
    const releaseLock = await this.acquireLock(productId);
    try {
      // Đọc lại trạng thái tươi nhất bên trong lock (tránh stale read)
      const product = await this.productsService.findById(dto.productSku);
      const previousQuantity = product.stockQuantity;

      // 1. Phân giải đơn vị tính và hệ số quy đổi về đơn vị cơ sở
      const unitConversion = this.productsService.findUnitConversion(
        product,
        dto.unit || dto.unitName,
      );
      const { unitName, conversionRate } = unitConversion;

      // 2. Tính toán lượng biến động quy về đơn vị cơ sở (Base Quantity Change)
      const baseQuantityChange = Math.round(dto.quantityChange * conversionRate);

      const referenceCode = dto.referenceCode?.trim() || '';
      const client = await this.databaseService.getClient();
      let newStockQuantity = previousQuantity;
      let transaction: InventoryTransactionEntity;
      let transactionOpen = false;
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const sku = product.sku.trim().toUpperCase();
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sku]);
        const reservedResult = await client.query<{ reserved: string }>(
          `SELECT COALESCE(SUM(base_quantity), 0)::text AS reserved
           FROM app_order_inventory_reservations WHERE product_sku = $1 AND status = 'RESERVED'`,
          [sku],
        );
        const totalReserved = Number(reservedResult.rows[0]?.reserved ?? 0);
        let orderReservation = 0;
        if (baseQuantityChange < 0 && referenceCode) {
          const orderReservationResult = await client.query<{ reserved: string }>(
            `SELECT COALESCE(SUM(r.base_quantity), 0)::text AS reserved
             FROM app_order_inventory_reservations r
             JOIN app_order_records o ON o.id = r.order_id
             WHERE UPPER(o.order_code) = UPPER($1) AND r.product_sku = $2 AND r.status = 'RESERVED'`,
            [referenceCode, sku],
          );
          orderReservation = Number(orderReservationResult.rows[0]?.reserved ?? 0);
        }
        if (baseQuantityChange < 0 && orderReservation > 0 && Math.abs(baseQuantityChange) > orderReservation) {
          throw new BadRequestException(
            `Số lượng xuất vượt quá phần đang giữ của đơn ${referenceCode} (${orderReservation} ${product.baseUnit}).`,
          );
        }
        const isReservedOrderExport = baseQuantityChange < 0 && orderReservation > 0;
        const availableForManualExport = product.stockQuantity - totalReserved;
        if (baseQuantityChange < 0 && !isReservedOrderExport && Math.abs(baseQuantityChange) > availableForManualExport) {
          throw new BadRequestException(
            `Tồn khả dụng chỉ còn ${availableForManualExport} ${product.baseUnit}; ${totalReserved} đang được giữ cho đơn hàng.`,
          );
        }

      // 3. Ràng buộc chống tồn kho âm tuyệt đối (bên trong lock — an toàn)
      if (product.stockQuantity + baseQuantityChange < 0) {
        throw new BadRequestException(
          `Số lượng xuất kho (${Math.abs(dto.quantityChange)} ${unitName} = ${Math.abs(baseQuantityChange)} ${product.baseUnit}) vượt quá tồn kho khả dụng hiện tại (${product.stockQuantity} ${product.baseUnit}).`,
        );
      }

      // 4. Cập nhật tồn kho thực tế theo đơn vị cơ sở
      const updated = await this.productsService.updateStock(
        product.id,
        baseQuantityChange,
      );
      newStockQuantity = updated.stockQuantity;

      // 5. Ghi sổ kho — SNAPSHOT BẤT BIẾN (Fix #4: dùng ledger Map thay array)
      const normalizedReferenceCode =
        referenceCode ||
        (dto.quantityChange >= 0
          ? `PNK-${Date.now().toString().slice(-6)}`
          : `PXK-${Date.now().toString().slice(-6)}`);

      transaction = new InventoryTransactionEntity({
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        transactionType: dto.quantityChange >= 0 ? 'IMPORT' : 'EXPORT',
        inputQuantity: dto.quantityChange,
        inputUnit: unitName,
        conversionRate, // SNAPSHOT HỆ SỐ QUY ĐỔI CỐ ĐỊNH — không thay đổi dù sau này đơn vị bị sửa
        baseQuantityChange,
        baseUnit: product.baseUnit,
        previousStock: previousQuantity,
        newStock: newStockQuantity,
        reason: dto.reason.trim(),
        referenceCode: normalizedReferenceCode,
        warehouse: dto.warehouseLocation || 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: userId,
        createdAt: new Date(),
      });

      this.writeLedger(transaction);

        if (baseQuantityChange < 0 && orderReservation > 0) {
          let remaining = Math.abs(baseQuantityChange);
          const rows = await client.query<{ id: string; base_quantity: string }>(
            `SELECT r.id, r.base_quantity::text FROM app_order_inventory_reservations r
             JOIN app_order_records o ON o.id = r.order_id
             WHERE UPPER(o.order_code) = UPPER($1) AND r.product_sku = $2 AND r.status = 'RESERVED'
             ORDER BY r.id FOR UPDATE OF r`,
            [referenceCode, sku],
          );
          for (const row of rows.rows) {
            if (remaining <= 0) break;
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
            remaining -= consumed;
          }
        }
        await client.query('COMMIT');
        transactionOpen = false;
      } catch (error) {
        if (transactionOpen) await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      const actionText = dto.quantityChange >= 0 ? 'Nhập kho' : 'Xuất kho';
      const signText = dto.quantityChange >= 0 ? '+' : '';

      return {
        success: true,
        message: `${actionText} thành công: ${signText}${dto.quantityChange} ${unitName} (Quy đổi: ${signText}${baseQuantityChange} ${product.baseUnit}). Tồn mới: ${newStockQuantity} ${product.baseUnit}.`,
        sku: product.sku,
        productName: product.name,
        inputQuantity: dto.quantityChange,
        inputUnit: unitName,
        unitName,
        conversionRate,
        conversionFactor: conversionRate,
        baseQuantityChange,
        baseUnit: product.baseUnit,
        previousQuantity,
        newQuantity: newStockQuantity,
        quantityChange: baseQuantityChange,
        reason: dto.reason,
        referenceCode: transaction.referenceCode,
        adjustedBy: userId,
        timestamp: transaction.createdAt.toISOString(),
      };
    } finally {
      // === CRITICAL SECTION KẾT THÚC — luôn release dù có exception ===
      releaseLock();
    }
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
