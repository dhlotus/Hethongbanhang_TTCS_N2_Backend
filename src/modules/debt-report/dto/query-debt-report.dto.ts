import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AgingDebtGroup } from '../enums/aging-debt-group.enum';

/**
 * DTO truy vấn bộ lọc Sổ công nợ và Phân tích tuổi nợ (SN-203)
 */
export class QueryDebtReportDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true || value === '1') return true;
    if (value === 'false' || value === false || value === '0') return false;
    return undefined;
  })
  @IsBoolean()
  isOverdueOnly?: boolean;

  @IsOptional()
  @IsEnum(AgingDebtGroup)
  agingGroup?: AgingDebtGroup;

  @IsOptional()
  @IsString()
  customerGroup?: string;

  @IsOptional()
  @IsString()
  region?: string;

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
}
