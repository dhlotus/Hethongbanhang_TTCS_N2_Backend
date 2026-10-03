import { BadRequestException, Injectable } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';

export interface StockAdjustmentResult {
  success: boolean;
  message: string;
  sku: string;
  previousQuantity: number;
  newQuantity: number;
  quantityChange: number;
  packageQuantity: number;
  unitName: string;
  conversionFactor: number;
  baseQuantityChange: number;
  baseUnit: string;
  reason: string;
  adjustedBy: string;
  timestamp: string;
  transactionId: string;
}

@Injectable()
export class InventoryService {
  private transactions: InventoryTransactionEntity[] = [];

  constructor(private readonly productsService: ProductsService) {}

  /**
   * Xem tồn kho khả dụng của danh mục sản phẩm
   */
  async getStockOverview(): Promise<
    Array<{
      sku: string;
      name: string;
      stockQuantity: number;
      baseUnit: string;
      warehouse: string;
    }>
  > {
    const products = await this.productsService.findAll();
    return products.map((p) => ({
      sku: p.sku,
      name: p.name,
      stockQuantity: p.stockQuantity,
      baseUnit: p.baseUnit,
      warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
    }));
  }

  /**
   * Điều chỉnh tồn kho hàng hóa có hỗ trợ đơn vị tính quy đổi (Lon, Lốc, Thùng)
   * Tự động quy đổi số lượng bao gói về đơn vị cơ sở khi ghi sổ tồn kho
   * Đóng băng snapshot hệ số quy đổi trong sổ giao dịch để chống sai lệch lịch sử
   */
  async adjustStock(
    dto: AdjustStockDto,
    userId: string,
  ): Promise<StockAdjustmentResult> {
    const product = await this.productsService.findById(dto.productSku);
    const resolvedUnit = this.resolveUnit(product, dto.unitId, dto.unitName);

    const conversionFactor = resolvedUnit ? resolvedUnit.conversionFactor : 1;
    const unitName = resolvedUnit ? resolvedUnit.unitName : product.baseUnit;
    const packageQuantity = dto.quantityChange;
    const baseQuantityChange = packageQuantity * conversionFactor;

    const previousQuantity = product.stockQuantity;
    const updated = await this.productsService.updateStock(
      product.id,
      baseQuantityChange,
    );

    const transaction = new InventoryTransactionEntity({
      sku: product.sku,
      productName: product.name,
      unitId: resolvedUnit?.id,
      unitName,
      packageQuantity,
      conversionFactor,
      baseQuantityChange,
      baseUnit: product.baseUnit,
      previousQuantity,
      newQuantity: updated.stockQuantity,
      reason: dto.reason,
      adjustedBy: userId,
    });
    this.transactions.unshift(transaction);

    return {
      success: true,
      message: `Điều chỉnh tồn kho cho SKU ${product.sku} thành công (${packageQuantity} ${unitName} = ${baseQuantityChange} ${product.baseUnit})`,
      sku: product.sku,
      previousQuantity,
      newQuantity: updated.stockQuantity,
      quantityChange: packageQuantity,
      packageQuantity,
      unitName,
      conversionFactor,
      baseQuantityChange,
      baseUnit: product.baseUnit,
      reason: dto.reason,
      adjustedBy: userId,
      timestamp: transaction.timestamp,
      transactionId: transaction.id,
    };
  }

  /**
   * Truy vấn danh sách lịch sử biến động sổ kho bất biến
   */
  async getTransactions(sku?: string): Promise<InventoryTransactionEntity[]> {
    if (!sku) {
      return [...this.transactions];
    }
    const normalizedSku = sku.trim().toLowerCase();
    return this.transactions.filter(
      (tx) => tx.sku.toLowerCase() === normalizedSku,
    );
  }

  /**
   * Helper tìm đơn vị tính tương ứng của sản phẩm
   */
  private resolveUnit(
    product: { units?: Array<{ id: string; unitName: string; conversionFactor: number; isBaseUnit: boolean }>; baseUnit: string },
    unitId?: string,
    unitName?: string,
  ): { id?: string; unitName: string; conversionFactor: number; isBaseUnit: boolean } | undefined {
    const units = product.units || [];

    if (unitId) {
      const match = units.find((u) => u.id === unitId);
      if (!match) {
        throw new BadRequestException(
          `Không tìm thấy đơn vị tính ID "${unitId}" cho sản phẩm ${product.baseUnit}`,
        );
      }
      return match;
    }

    if (unitName) {
      const match = units.find(
        (u) => u.unitName.toLowerCase() === unitName.trim().toLowerCase(),
      );
      if (!match) {
        throw new BadRequestException(
          `Đơn vị tính "${unitName}" không tồn tại cho sản phẩm này`,
        );
      }
      return match;
    }

    return units.find((u) => u.isBaseUnit) || {
      unitName: product.baseUnit,
      conversionFactor: 1,
      isBaseUnit: true,
    };
  }
}
