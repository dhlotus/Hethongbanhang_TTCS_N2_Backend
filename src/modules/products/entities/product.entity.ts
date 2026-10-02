/**
 * Entity Sản phẩm & SKU hàng hóa (SN-138 / SN-139 / SN-20 / EP-02)
 * Đại diện cho một SKU sản phẩm trong hệ thống bán hàng & kho B2B.
 */
export class ProductEntity {
  /** Mã định danh nội bộ hệ thống (UUID hoặc prefixed id) */
  id: string;

  /** Mã SKU sản phẩm (in hoa, duy nhất trên toàn hệ thống) */
  sku: string;

  /** Tên sản phẩm hiển thị */
  name: string;

  /** Ngành hàng / Danh mục cha (VD: Sữa & Chế phẩm sữa) */
  parentCategory: string;

  /** Phân loại con / Danh mục con (VD: Sữa bột công thức) */
  subCategory: string;

  /** Chuỗi danh mục đầy đủ dạng cây (VD: Sữa & Chế phẩm sữa / Sữa bột công thức) */
  category: string;

  /** Đơn vị tính cơ sở (VD: Lon, Hộp, Hũ, Túi, Chai) */
  baseUnit: string;

  /** Quy cách đóng gói lưu kho (VD: 24 lon/thùng) */
  packagingSpec?: string;

  /** Giá bán niêm yết (VNĐ) */
  price: number;

  /**
   * Giá vốn cơ sở (Cost Price - SN-10).
   * Trường nhạy cảm, chỉ ADMIN và SALES_MANAGER có quyền xem.
   */
  costPrice: number;

  /**
   * Biên lợi nhuận % (Margin = ((price - costPrice) / price) * 100).
   * Trường nhạy cảm, chỉ ADMIN và SALES_MANAGER có quyền xem.
   */
  margin: number;

  /** Số lượng tồn kho thực tế */
  stockQuantity: number;

  /** Trạng thái kinh doanh sản phẩm */
  status: 'ACTIVE' | 'INACTIVE';

  /** Mã vạch sản phẩm (EAN-13, barcode) */
  barcode?: string;

  /** Đường dẫn hình ảnh minh họa sản phẩm */
  imageUrl?: string;

  /** Đánh dấu sản phẩm đã phát sinh giao dịch kho hoặc đơn hàng hay chưa */
  hasTransactions: boolean;

  /** Mô tả chi tiết sản phẩm */
  description?: string;

  /** Thời điểm khởi tạo */
  createdAt: Date;

  /** Thời điểm cập nhật lần cuối */
  updatedAt: Date;

  constructor(partial: Partial<ProductEntity>) {
    Object.assign(this, partial);
    if (!this.createdAt) this.createdAt = new Date();
    if (!this.updatedAt) this.updatedAt = new Date();
    if (this.hasTransactions === undefined) this.hasTransactions = false;
    if (this.stockQuantity === undefined) this.stockQuantity = 0;
    if (this.status === undefined) this.status = 'ACTIVE';

    // Tự động đồng bộ cấu trúc cây ngành hàng
    if (!this.category && (this.parentCategory || this.subCategory)) {
      this.category = [this.parentCategory, this.subCategory]
        .filter(Boolean)
        .join(' / ');
    } else if (this.category && (!this.parentCategory || !this.subCategory)) {
      const parts = this.category.split('/').map((s) => s.trim());
      if (parts.length >= 2) {
        if (!this.parentCategory) this.parentCategory = parts[0];
        if (!this.subCategory) this.subCategory = parts.slice(1).join(' / ');
      } else {
        if (!this.parentCategory) this.parentCategory = parts[0];
        if (!this.subCategory) this.subCategory = parts[0];
      }
    }
  }
}
