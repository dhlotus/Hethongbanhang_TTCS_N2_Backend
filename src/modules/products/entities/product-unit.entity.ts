/**
 * Entity Đơn vị tính & Quy cách đóng gói (SN-148 / EP-02 / Bảng product_units)
 * Hỗ trợ đa đơn vị tính: Lon, Lốc, Thùng kèm hệ số quy đổi về đơn vị cơ sở.
 */
export class ProductUnitEntity {
  /** Mã định danh đơn vị tính */
  id: string;

  /** Mã sản phẩm (liên kết với ProductEntity) */
  productId: string;

  /** Tên đơn vị tính hiển thị (VD: Lon, Lốc, Thùng, Hộp, Chai) */
  unitName: string;

  /**
   * Hệ số nhân quy đổi ra đơn vị tính cơ sở (conversion_factor > 0).
   * Ví dụ: Đơn vị cơ sở là "Lon" (hệ số = 1), "Lốc" (hệ số = 6), "Thùng" (hệ số = 24).
   * 1 Thùng = 24 Lon.
   */
  conversionFactor: number;

  /** Đánh dấu đây có phải đơn vị cơ sở nhỏ nhất hay không */
  isBaseUnit: boolean;

  /** Mã vạch riêng của quy cách đóng gói (nếu có) */
  barcode?: string;

  /** Thời điểm tạo */
  createdAt: Date;

  /** Thời điểm cập nhật lần cuối */
  updatedAt: Date;

  constructor(partial: Partial<ProductUnitEntity>) {
    Object.assign(this, partial);
    if (!this.id) {
      this.id = `unit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    }
    if (!this.createdAt) this.createdAt = new Date();
    if (!this.updatedAt) this.updatedAt = new Date();
    if (this.isBaseUnit === undefined) this.isBaseUnit = false;
    if (this.conversionFactor === undefined) this.conversionFactor = 1;
  }
}
