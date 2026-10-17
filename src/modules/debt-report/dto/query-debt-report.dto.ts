import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { AgingDebtGroupEnum } from '../enums/aging-debt-group.enum';

/**
 * Re-export AgingDebtGroupEnum để tiện sử dụng
 */
export { AgingDebtGroupEnum };

/**
 * DTO truy vấn bộ lọc Sổ công nợ và Phân tích tuổi nợ (SN-203)
 * Tối ưu hóa sanitization, chuẩn hóa giá trị mặc định, lọc sạch chuỗi rỗng và giá trị sentinel (ALL).
 */
export class QueryDebtReportDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const upper = value.trim().toUpperCase();
      if (upper === 'IN_TERM' || upper === 'OVERDUE') return upper;
      if (upper === 'ALL' || !upper) return undefined;
    }
    return undefined;
  })
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
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const upper = value.trim().toUpperCase();
      if (upper === 'ALL' || !upper) return undefined;
      return upper;
    }
    return value;
  })
  @IsEnum(AgingDebtGroupEnum)
  agingGroup?: AgingDebtGroupEnum;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  customerGroup?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  region?: string;

  @IsOptional()
  @Transform(({ value }) => {
    const num = parseInt(value, 10);
    return isNaN(num) || num < 1 ? 1 : num;
  })
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => {
    const num = parseInt(value, 10);
    return isNaN(num) || num < 1 ? 20 : Math.min(num, 100);
  })
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @Transform(({ value }) => {
    const allowed = ['oldestDebtDays', 'remainingDebt', 'overdueAmount', 'agencyName', 'code'];
    return allowed.includes(value) ? value : 'oldestDebtDays';
  })
  @IsString()
  sortBy?: 'oldestDebtDays' | 'remainingDebt' | 'overdueAmount' | 'agencyName' | 'code' = 'oldestDebtDays';

  @IsOptional()
  @Transform(({ value }) => {
    const val = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return val === 'asc' ? 'asc' : 'desc';
  })
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
