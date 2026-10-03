import { ProductEntity } from '../entities/product.entity';

/**
 * Interface cấu trúc phản hồi phân trang danh sách sản phẩm (SN-138):
 * Khớp 100% với PaginatedProductsResponse tại Frontend.
 */
export interface PaginatedProductsResponse {
  data: ProductEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
