import { Injectable } from '@nestjs/common';
import { ProductsService } from '../products/products.service';
import { AdjustStockDto } from './dto/adjust-stock.dto';

export interface StockAdjustmentResult {
  success: boolean;
  message: string;
  sku: string;
  previousQuantity: number;
  newQuantity: number;
  quantityChange: number;
  reason: string;
  adjustedBy: string;
  timestamp: string;
}

@Injectable()
export class InventoryService {
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
    const { data: products } = await this.productsService.findAll({
      limit: 1000,
    });
    return products.map((p) => ({
      sku: p.sku,
      name: p.name,
      stockQuantity: p.stockQuantity,
      baseUnit: p.baseUnit,
      warehouse: 'Kho Tổng Miền Nam - LOHA WH01',
    }));
  }

  /**
   * Điều chỉnh tồn kho hàng hóa (Chỉ Thủ kho và Quản trị viên được phép)
   */
  async adjustStock(
    dto: AdjustStockDto,
    userId: string,
  ): Promise<StockAdjustmentResult> {
    const product = await this.productsService.findById(dto.productSku);
    const previousQuantity = product.stockQuantity;

    const updated = await this.productsService.updateStock(
      product.id,
      dto.quantityChange,
    );

    return {
      success: true,
      message: `Điều chỉnh tồn kho cho SKU ${product.sku} thành công`,
      sku: product.sku,
      previousQuantity,
      newQuantity: updated.stockQuantity,
      quantityChange: dto.quantityChange,
      reason: dto.reason,
      adjustedBy: userId,
      timestamp: new Date().toISOString(),
    };
  }
}
