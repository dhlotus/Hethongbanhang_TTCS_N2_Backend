/**
 * Entity Chi tiết Dòng Bảng giá (PriceListItemEntity):
 * Đại diện cho giá bán và giá sàn của một sản phẩm trong bảng giá B2B
 */
export class PriceListItemEntity {
  id: string;
  priceListId: string;
  productId: string;
  productCode: string;
  productName: string;
  price: number;
  minPrice: number;
  baseUnit?: string;

  constructor(partial: Partial<PriceListItemEntity>) {
    Object.assign(this, partial);
    this.price = Number(this.price) || 0;
    this.minPrice = Number(this.minPrice) || 0;
  }
}
