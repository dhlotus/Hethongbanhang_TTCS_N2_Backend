import { IsEnum, IsOptional, IsString } from 'class-validator';

export type SalesReportGroupBy =
  | 'sales_rep'
  | 'region'
  | 'customer'
  | 'category'
  | 'product';

export class QueryMultidimensionalSalesReportDto {
  @IsOptional()
  @IsEnum(['sales_rep', 'region', 'customer', 'category', 'product'], {
    message: 'Chiều nhóm phải là: sales_rep, region, customer, category, hoặc product',
  })
  groupBy?: SalesReportGroupBy = 'sales_rep';

  @IsOptional()
  @IsString()
  timeRange?: string = 'this_month'; // 'today' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'custom'

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsString()
  salesRepId?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
