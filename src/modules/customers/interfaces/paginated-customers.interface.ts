import { CustomerEntity } from '../entities/customer.entity';

/**
 * Interface cấu trúc kết quả phân trang danh sách Đại lý (SN-37)
 */
export interface PaginatedCustomersResult {
  data: CustomerEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  unassignedCount?: number;
  activeCount?: number;
  totalCreditLimit?: number;
  totalCurrentDebt?: number;
}

