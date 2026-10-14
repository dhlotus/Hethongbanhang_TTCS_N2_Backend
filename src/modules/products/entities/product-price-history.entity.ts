/**
 * Thực thể Lịch sử thay đổi giá sản phẩm (SN-29)
 * Ánh xạ bảng product_price_histories trong cơ sở dữ liệu PostgreSQL.
 *
 * Quy tắc bất biến:
 * Bảng này chỉ cho phép INSERT và SELECT.
 * Tuyệt đối không cung cấp hàm/endpoint sửa (UPDATE) hoặc xóa (DELETE).
 */
export class ProductPriceHistory {
  id: string;
  productId: string;
  oldPrice: number;
  newPrice: number;
  changedBy: string;
  changedAt: Date;

  constructor(partial: Partial<ProductPriceHistory> & Record<string, unknown>) {
    this.id = (partial.id as string) || '';
    this.productId = (partial.productId || partial.product_id) as string;
    this.oldPrice = Number(partial.oldPrice ?? partial.old_price ?? 0);
    this.newPrice = Number(partial.newPrice ?? partial.new_price ?? 0);
    this.changedBy = (partial.changedBy || partial.changed_by || 'Hệ thống') as string;
    this.changedAt = partial.changedAt
      ? new Date(partial.changedAt)
      : partial.changed_at
      ? new Date(partial.changed_at as string | number | Date)
      : new Date();
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      productId: this.productId,
      product_id: this.productId,
      oldPrice: this.oldPrice,
      old_price: this.oldPrice,
      newPrice: this.newPrice,
      new_price: this.newPrice,
      changedBy: this.changedBy,
      changed_by: this.changedBy,
      changedAt: this.changedAt,
      changed_at: this.changedAt,
    };
  }
}
