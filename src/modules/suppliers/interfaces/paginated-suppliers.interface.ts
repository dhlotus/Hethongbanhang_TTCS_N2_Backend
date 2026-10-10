import { SupplierEntity } from '../entities/supplier.entity';

export interface SupplierSummaryDto {
  total: number;
  active: number;
  inactive: number;
  withReceipts: number;
}

export interface PaginatedSuppliersResponse {
  data: SupplierEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: SupplierSummaryDto;
}
