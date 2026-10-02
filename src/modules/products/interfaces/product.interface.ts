import { ProductEntity } from '../entities/product.entity';

/**
 * Cấu trúc phản hồi phân trang danh sách sản phẩm
 * Khớp chuẩn API Contract: GET /api/products
 */
export interface PaginatedProductsResult {
  data: ProductEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Kết quả xóa sản phẩm thành công
 */
export interface DeleteProductResult {
  success: boolean;
  message: string;
  deletedId: string;
}
