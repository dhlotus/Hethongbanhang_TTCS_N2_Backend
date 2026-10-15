import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AgingDebtGroupEnum } from '../enums/aging-debt-group.enum';

/**
 * Re-export AgingDebtGroupEnum để tiện sử dụng
 */
export { AgingDebtGroupEnum };

/**
 * DTO truy vấn bộ lọc Sổ công nợ và Phân tích tuổi nợ (SN-203)
 */
export class QueryDebtReportDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  debtStatus?: 'IN_TERM' | 'OVERDUE' | 'ALL';

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true || value === '1') return true;
    if (value === 'false' || value === false || value === '0') return false;
    return undefined;
  })
  @IsBoolean()
  isOverdue?: boolean;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true || value === '1') return true;
    if (value === 'false' || value === false || value === '0') return false;
    return undefined;
  })
  @IsBoolean()
  isOverdueOnly?: boolean;

  @IsOptional()
  @IsEnum(AgingDebtGroupEnum)
  agingGroup?: AgingDebtGroupEnum;

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

  @IsOptional()
  @IsString()
  sortBy?: 'oldestDebtDays' | 'remainingDebt' | 'overdueAmount' | 'agencyName' | 'code';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}
