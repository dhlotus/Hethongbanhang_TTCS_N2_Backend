import { CategoryStatus } from '../../../common/enums/category-status.enum';

/**
 * Thực thể Nhóm Hàng (Bảng categories / nhom_hang) - SN-150 / SN-22 (Sprint 2):
 * Quản lý cấu trúc cây nhiều cấp (Tree Structure: Ngành hàng cha -> Nhóm phụ -> Phân loại con),
 * hỗ trợ phân cấp đệ quy, liên kết sản phẩm và bảo vệ toàn vẹn dữ liệu.
 */
export class CategoryEntity {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  level: number;
  description?: string | null;
  status: CategoryStatus;
  productCount?: number;
  children?: CategoryEntity[];
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<CategoryEntity> & Record<string, unknown>) {
    Object.assign(this, partial);

    // Chuẩn hóa parentId từ camelCase hoặc snake_case parent_id
    if (partial.parent_id !== undefined && this.parentId === undefined) {
      this.parentId = (partial.parent_id as string | null) || null;
    } else if (this.parentId === undefined) {
      this.parentId = null;
    }

    if (this.level === undefined || this.level === null) {
      this.level = 1;
    }

    if (!this.status) {
      this.status = CategoryStatus.ACTIVE;
    }

    if (this.description === undefined) {
      this.description = null;
    }

    if (this.productCount === undefined) {
      this.productCount = 0;
    }

    if (!this.children) {
      this.children = [];
    }

    if (!this.createdAt) {
      this.createdAt = new Date();
    }

    if (!this.updatedAt) {
      this.updatedAt = new Date();
    }
  }

  get parent_id(): string | null {
    return this.parentId;
  }

  get product_count(): number {
    return this.productCount ?? 0;
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
      code: this.code,
      name: this.name,
      parentId: this.parentId,
      parent_id: this.parentId,
      level: this.level,
      description: this.description,
      status: this.status,
      productCount: this.productCount ?? 0,
      product_count: this.productCount ?? 0,
      children: this.children?.map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c)) ?? [],
      createdAt: this.createdAt,
      created_at: this.createdAt,
      updatedAt: this.updatedAt,
      updated_at: this.updatedAt,
    };
  }
}
