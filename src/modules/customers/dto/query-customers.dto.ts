import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CustomerStatus } from '../enums/customer-status.enum';

/**
 * DTO truy vấn danh sách Đại lý (SN-35)
 */
export class QueryCustomersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page phải là số nguyên' })
  @Min(1, { message: 'Page phải lớn hơn hoặc bằng 1' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit phải là số nguyên' })
  @Min(1, { message: 'Limit phải lớn hơn hoặc bằng 1' })
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  salesRepId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unassignedOnly?: boolean;

  @IsOptional()
  @IsEnum(CustomerStatus, { message: 'Trạng thái lọc không hợp lệ' })
  status?: CustomerStatus;
}
