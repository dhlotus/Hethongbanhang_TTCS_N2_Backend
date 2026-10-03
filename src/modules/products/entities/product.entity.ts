import { ProductUnitEntity } from './product-unit.entity';

/**
 * Entity Sản phẩm & SKU Hàng hóa (EP-02 / Bảng products)
 * Hỗ trợ danh mục, giá bán, giá vốn bảo mật và đa đơn vị tính quy đổi.
 */
export class ProductEntity {
  id: string;
  sku: string;
  name: string;
  category: string;
  baseUnit: string;
  price: number;
  costPrice: number;
  margin: number;
  stockQuantity: number;
  status: 'ACTIVE' | 'INACTIVE';
  barcode?: string;
  description?: string;

  /** Danh sách các đơn vị tính và hệ số quy đổi (Lon, Lốc, Thùng) */
  units: ProductUnitEntity[];

  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<ProductEntity>) {
    Object.assign(this, partial);
    if (!this.createdAt) this.createdAt = new Date();
    if (!this.updatedAt) this.updatedAt = new Date();

    if (!this.units) {
      this.units = [];
    }

    // Luôn đảm bảo có ít nhất đơn vị cơ sở (Base Unit) với hệ số = 1
    if (this.baseUnit && !this.units.some((u) => u.isBaseUnit)) {
      this.units.unshift(
        new ProductUnitEntity({
          productId: this.id,
          unitName: this.baseUnit,
          conversionFactor: 1,
          isBaseUnit: true,
          barcode: this.barcode,
        }),
      );
    }
  }
}
