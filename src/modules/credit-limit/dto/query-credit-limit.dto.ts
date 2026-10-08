import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CreditStatus } from '../enums/credit-status.enum';

/**
 * DTO lọc và tìm kiếm danh sách hạn mức công nợ (SN-34)
 */
export class QueryCreditLimitDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CreditStatus)
  status?: CreditStatus;

  @IsOptional()
  @IsString()
  customerGroup?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string = 'debtUsagePercentage';

  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
