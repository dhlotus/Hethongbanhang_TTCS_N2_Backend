import { CustomerAssignmentHistoryEntity } from '../entities/customer-assignment-history.entity';
import { PaginatedCustomersResult } from './paginated-customers.interface';

/**
 * Cấu trúc trả về khi chuyển giao địa bàn đại lý hàng loạt (SN-35)
 */
export interface BulkTransferTerritoryResult {
  message: string;
  transferBatchId: string;
  transferredCount: number;
  fromSalesRep: {
    id: string;
    name: string;
  };
  toSalesRep: {
    id: string;
    name: string;
  };
  transferredCustomers: Array<{
    id: string;
    code: string;
    name: string;
    region?: string;
  }>;
}

/**
 * Cấu trúc kết quả phân trang lịch sử chuyển giao & phân công địa bàn (SN-35)
 */
export interface PaginatedAssignmentHistoryResult {
  data: CustomerAssignmentHistoryEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Cấu trúc danh sách đại lý kèm số lượng đại lý chưa phân công (SN-35)
 */
export interface PaginatedCustomersWithUnassignedResult extends PaginatedCustomersResult {
  unassignedCount: number;
}
