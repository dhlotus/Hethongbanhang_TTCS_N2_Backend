import { PriceListEntity } from '../entities/price-list.entity';

export interface PaginatedPriceListsResponse {
  data: PriceListEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
