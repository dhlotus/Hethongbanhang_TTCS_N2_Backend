import { CategoryStatus } from '../../../common/enums/category-status.enum';

/**
 * Interface cấu trúc cây nhóm hàng phân cấp (Tree Structure) - SN-150 / SN-22:
 * Hỗ trợ biểu diễn trực quan đa cấp (Cấp 1: Ngành hàng cha, Cấp 2: Nhóm phụ, Cấp 3: Phân loại con)
 * kèm số lượng sản phẩm liên kết (productCount).
 */
export interface CategoryTreeNode {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  parent_id?: string | null;
  level: number;
  description?: string | null;
  status: CategoryStatus;
  productCount: number;
  product_count?: number;
  children: CategoryTreeNode[];
  createdAt: Date;
  created_at?: Date;
  updatedAt: Date;
  updated_at?: Date;
}
