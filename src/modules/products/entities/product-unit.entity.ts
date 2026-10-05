/**
 * Thực thể Đơn vị tính quy đổi của Sản phẩm (SN-23 & EP-02)
 * Cho phép 1 SKU khai báo nhiều đơn vị: lon, lốc, thùng kèm hệ số quy đổi về đơn vị cơ sở.
 */
export class ProductUnitEntity {
  id: string;
  productId?: string;
  unitName: string;
  conversionRate: number; // Hệ số quy đổi về đơn vị cơ sở (Ví dụ: Thùng = 24 Lon -> conversionRate = 24)
  isBaseUnit: boolean;    // true nếu là đơn vị tính cơ sở nhỏ nhất
  barcode?: string;
  price?: number;         // Giá bán riêng theo đơn vị này (nếu có)
  costPrice?: number;     // Giá vốn riêng theo đơn vị này (nếu có)
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<ProductUnitEntity> & Record<string, unknown>) {
    this.id = (partial.id as string) || `unit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.productId = (partial.productId || partial.product_id) as string | undefined;
    this.unitName = ((partial.unitName || partial.unit_name) as string || '').trim();
    
    const rate = partial.conversionRate !== undefined 
      ? Number(partial.conversionRate) 
      : (partial.conversion_factor !== undefined ? Number(partial.conversion_factor) : 1);
    this.conversionRate = Number.isFinite(rate) && rate > 0 ? rate : 1;

    this.isBaseUnit = Boolean(
      partial.isBaseUnit !== undefined ? partial.isBaseUnit : partial.is_base_unit,
    );
    this.barcode = (partial.barcode as string) || undefined;
    this.price = partial.price !== undefined ? Number(partial.price) : undefined;
    this.costPrice = partial.costPrice !== undefined 
      ? Number(partial.costPrice) 
      : (partial.cost_price !== undefined ? Number(partial.cost_price) : undefined);
    
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
    this.updatedAt = partial.updatedAt ? new Date(partial.updatedAt) : new Date();
  }

  get unit_name(): string {
    return this.unitName;
  }

  get conversion_factor(): number {
    return this.conversionRate;
  }

  get is_base_unit(): boolean {
    return this.isBaseUnit;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      productId: this.productId,
      product_id: this.productId,
      unitName: this.unitName,
      unit_name: this.unitName,
      conversionRate: this.conversionRate,
      conversion_factor: this.conversionRate,
      isBaseUnit: this.isBaseUnit,
      is_base_unit: this.isBaseUnit,
      barcode: this.barcode,
      price: this.price,
      costPrice: this.costPrice,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
