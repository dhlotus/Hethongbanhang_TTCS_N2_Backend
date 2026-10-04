import { SupplierEntity } from '../entities/supplier.entity';

export interface PaginatedSuppliersResponse {
  data: SupplierEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
