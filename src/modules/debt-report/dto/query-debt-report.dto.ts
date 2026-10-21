import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { AgingDebtGroupEnum, DebtPriorityLevelEnum } from '../enums/aging-debt-group.enum';

export { AgingDebtGroupEnum, DebtPriorityLevelEnum };

/**
 * DTO truy vấn bộ lọc Báo cáo công nợ quá hạn theo tuổi nợ (SN-230)
 */
export class QueryDebtReportDto {
  /**
   * Ngày chốt báo cáo (YYYY-MM-DD)
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  asOfDate?: string;

  /**
   * Lọc theo mã hoặc ID đại lý cụ thể
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  agencyId?: string;

  /**
   * Lọc theo nhân viên kinh doanh phụ trách
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  salesRepName?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  salesRepId?: string;

  /**
   * Lọc theo nhóm tuổi nợ (CURRENT, AGE_1_30, AGE_31_60, AGE_61_90, AGE_OVER_90)
   */
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

  /**
   * Lọc theo mức độ ưu tiên xử lý (CRITICAL, HIGH, MEDIUM, LOW, SETTLED)
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const upper = value.trim().toUpperCase();
      if (upper === 'ALL' || !upper) return undefined;
      return upper;
    }
    return value;
  })
  @IsEnum(DebtPriorityLevelEnum)
  priority?: DebtPriorityLevelEnum;

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
    const allowed = ['oldestDebtDays', 'remainingDebt', 'overdueAmount', 'agencyName', 'code', 'priority'];
    return allowed.includes(value) ? value : 'oldestDebtDays';
  })
  @IsString()
  sortBy?: 'oldestDebtDays' | 'remainingDebt' | 'overdueAmount' | 'agencyName' | 'code' | 'priority' = 'oldestDebtDays';

  @IsOptional()
  @Transform(({ value }) => {
    const val = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return val === 'asc' ? 'asc' : 'desc';
  })
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}
