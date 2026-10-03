import { ProductStatus } from '../../../common/enums/product-status.enum';

/**
 * Thực thể Sản phẩm / SKU (Bảng products) - SN-138 & SN-20:
 * Quản lý thông tin SKU, danh mục 2 cấp, quy cách đóng gói, tồn kho,
 * giá bán và giá vốn nhạy cảm (bảo mật theo vai trò RBAC).
 */
export class ProductEntity {
  id: string;
  sku: string;
  name: string;
  parentCategory: string;
  subCategory: string;
  category: string;
  baseUnit: string;
  packagingSpec?: string;
  price: number;
  costPrice: number;
  margin?: number;
  stockQuantity: number;
  status: ProductStatus;
  imageUrl?: string;
  description?: string;
  hasTransactions: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<ProductEntity> & Record<string, unknown>) {
    Object.assign(this, partial);

    // Chuẩn hóa parentCategory và subCategory từ category hoặc các trường alias
    const parent =
      partial.parentCategory ||
      (partial.parent_category as string) ||
      '';
    const sub =
      partial.subCategory ||
      (partial.sub_category as string) ||
      '';

    if (parent) this.parentCategory = parent;
    if (sub) this.subCategory = sub;

    // Chuẩn hóa category theo định dạng: ${parentCategory} / ${subCategory}
    if (!this.category && (this.parentCategory || this.subCategory)) {
      this.category = `${this.parentCategory || ''} / ${this.subCategory || ''}`.trim();
    } else if (this.category && (!this.parentCategory || !this.subCategory)) {
      const parts = this.category.split('/');
      if (parts.length >= 2) {
        this.parentCategory = this.parentCategory || parts[0].trim();
        this.subCategory = this.subCategory || parts[1].trim();
      } else {
        this.parentCategory = this.parentCategory || this.category;
        this.subCategory = this.subCategory || this.category;
      }
    }

    // Đơn vị và quy cách
    if (!this.baseUnit && partial.base_unit) {
      this.baseUnit = partial.base_unit as string;
    }
    if (!this.packagingSpec && partial.packaging_spec) {
      this.packagingSpec = partial.packaging_spec as string;
    }
    if (this.costPrice === undefined && partial.cost_price !== undefined) {
      this.costPrice = Number(partial.cost_price);
    }
    if (this.stockQuantity === undefined && partial.stock_quantity !== undefined) {
      this.stockQuantity = Number(partial.stock_quantity);
    }
    if (!this.imageUrl && partial.image_url) {
      this.imageUrl = partial.image_url as string;
    }

    // Tính toán margin (%) nếu price > 0 và costPrice hợp lệ
    if (this.price > 0 && typeof this.costPrice === 'number') {
      this.margin = Number((((this.price - this.costPrice) / this.price) * 100).toFixed(2));
    } else if (this.margin === undefined) {
      this.margin = 0;
    }

    if (this.stockQuantity === undefined) this.stockQuantity = 0;
    if (!this.status) this.status = ProductStatus.ACTIVE;
    if (this.hasTransactions === undefined) this.hasTransactions = false;
    if (!this.createdAt) this.createdAt = new Date();
    if (!this.updatedAt) this.updatedAt = new Date();
  }

  // Alias getters cho snake_case tương thích schema database
  get parent_category(): string {
    return this.parentCategory;
  }

  get sub_category(): string {
    return this.subCategory;
  }

  get base_unit(): string {
    return this.baseUnit;
  }

  get packaging_spec(): string | undefined {
    return this.packagingSpec;
  }

  get cost_price(): number {
    return this.costPrice;
  }

  get stock_quantity(): number {
    return this.stockQuantity;
  }

  get image_url(): string | undefined {
    return this.imageUrl;
  }

  get created_at(): Date {
    return this.createdAt;
  }

  get updated_at(): Date {
    return this.updatedAt;
  }

  /**
   * Serialize đối tượng đảm bảo cung cấp đầy đủ cả camelCase (frontend) và snake_case (database schema)
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      sku: this.sku,
      name: this.name,
      parentCategory: this.parentCategory,
      parent_category: this.parentCategory,
      subCategory: this.subCategory,
      sub_category: this.subCategory,
      category: this.category,
      baseUnit: this.baseUnit,
      base_unit: this.baseUnit,
      packagingSpec: this.packagingSpec,
      packaging_spec: this.packagingSpec,
      price: this.price,
      costPrice: this.costPrice,
      cost_price: this.costPrice,
      margin: this.margin,
      stockQuantity: this.stockQuantity,
      stock_quantity: this.stockQuantity,
      status: this.status,
      imageUrl: this.imageUrl,
      image_url: this.imageUrl,
      description: this.description,
      hasTransactions: this.hasTransactions,
      createdAt: this.createdAt,
      created_at: this.createdAt,
      updatedAt: this.updatedAt,
      updated_at: this.updatedAt,
    };
  }
}
