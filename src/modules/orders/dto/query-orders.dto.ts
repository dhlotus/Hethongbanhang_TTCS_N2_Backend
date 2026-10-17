import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { OrderStatus } from '../entities/order-status.enum';

/**
 * DTO Lọc và phân trang danh sách đơn hàng
 */
export class QueryOrdersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: OrderStatus | string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @IsOptional()
  @IsString()
  salesRepId?: string;

  @IsOptional()
  @IsString()
  assignedUser?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsString()
  dateType?: 'CREATED' | 'DELIVERY' | string;

  @IsOptional()
  forShipment?: boolean | string;

  @IsOptional()
  @IsString()
  warehouseId?: string;
}
