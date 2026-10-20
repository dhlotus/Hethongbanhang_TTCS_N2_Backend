import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO truy vấn Sổ Chi Tiết Công Nợ Đại Lý (SN-231)
 */
export class QueryDebtLedgerDto {
  /**
   * Mã đại lý (DL-0001...) hoặc Customer ID
   */
  @IsNotEmpty({ message: 'Vui lòng chọn đại lý cần xem sổ chi tiết' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  agencyId: string;

  /**
   * Ngày bắt đầu kỳ đối chiếu (YYYY-MM-DD)
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  fromDate?: string;

  /**
   * Ngày kết thúc kỳ đối chiếu (YYYY-MM-DD)
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  toDate?: string;

  /**
   * Lọc loại chứng từ (INVOICE, PAYMENT, RETURN, ADJUSTMENT, ALL)
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const upper = value.trim().toUpperCase();
      return upper === 'ALL' || !upper ? undefined : upper;
    }
    return undefined;
  })
  @IsString()
  documentType?: string;

  /**
   * Tìm kiếm từ khóa theo mã chứng từ hoặc diễn giải
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : undefined))
  @IsString()
  search?: string;
}
