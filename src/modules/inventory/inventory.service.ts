import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';

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

  constructor(private readonly productsService: ProductsService) {}

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
      baseUnit: string;
      units: Array<{ unitName: string; conversionRate: number; isBaseUnit: boolean }>;
      warehouse: string;
    }>
  > {
    const products = await this.productsService.findAll();
    return products.map((p) => ({
      sku: p.sku,
      name: p.name,
      stockQuantity: p.stockQuantity,
      baseUnit: p.baseUnit,
      units: (p.units || []).map((u) => ({
        unitName: u.unitName,
        conversionRate: u.conversionRate,
        isBaseUnit: u.isBaseUnit,
      })),
      warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
    }));
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

      // 5. Ghi sổ kho — SNAPSHOT BẤT BIẾN (Fix #4: dùng ledger Map thay array)
      const referenceCode =
        dto.referenceCode?.trim() ||
        (dto.quantityChange >= 0
          ? `PNK-${Date.now().toString().slice(-6)}`
          : `PXK-${Date.now().toString().slice(-6)}`);

      const transaction = new InventoryTransactionEntity({
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
        newStock: updated.stockQuantity,
        reason: dto.reason.trim(),
        referenceCode,
        warehouse: dto.warehouseLocation || 'Kho Tổng Miền Nam - LOHA WH01',
        performedBy: userId,
        createdAt: new Date(),
      });

      this.writeLedger(transaction);

      const actionText = dto.quantityChange >= 0 ? 'Nhập kho' : 'Xuất kho';
      const signText = dto.quantityChange >= 0 ? '+' : '';

      return {
        success: true,
        message: `${actionText} thành công: ${signText}${dto.quantityChange} ${unitName} (Quy đổi: ${signText}${baseQuantityChange} ${product.baseUnit}). Tồn mới: ${updated.stockQuantity} ${product.baseUnit}.`,
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
        newQuantity: updated.stockQuantity,
        quantityChange: baseQuantityChange,
        reason: dto.reason,
        referenceCode,
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
