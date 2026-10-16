import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export enum BatchStatusFilter {
  ALL = 'ALL',
  VALID = 'VALID',
  EXPIRING_SOON = 'EXPIRING_SOON',
  EXPIRED = 'EXPIRED',
}

/**
 * DTO truy vấn danh sách lô hàng và hạn sử dụng (SN-184)
 * Tuân thủ CODE_CONVENTION: PascalCase cho DTO/Enum, camelCase cho properties.
 */
export class QueryBatchesDto {
  @IsOptional()
  @IsString({ message: 'Mã kho (warehouseId) phải là chuỗi' })
  warehouseId?: string;

  @IsOptional()
  @IsString({ message: 'Mã sản phẩm (productId) phải là chuỗi' })
  productId?: string;

  @IsOptional()
  @IsString({ message: 'Mã SKU phải là chuỗi' })
  sku?: string;

  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm phải là chuỗi' })
  search?: string;

  @IsOptional()
  @IsEnum(BatchStatusFilter, { message: 'Trạng thái lọc phải là ALL, VALID, EXPIRING_SOON, hoặc EXPIRED' })
  status?: BatchStatusFilter;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const num = Number(value);
    return isNaN(num) || num <= 0 ? 30 : num;
  })
  @IsNumber({}, { message: 'Ngưỡng cảnh báo cận hạn (expiryThresholdDays) phải là số' })
  @Min(1, { message: 'Ngưỡng cảnh báo cận hạn phải lớn hơn hoặc bằng 1 ngày' })
  expiryThresholdDays?: number = 30;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const num = Number(value);
    return isNaN(num) || num <= 0 ? 1 : Math.floor(num);
  })
  @IsNumber({}, { message: 'Số trang phải là số' })
  @Min(1, { message: 'Số trang tối thiểu là 1' })
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    const num = Number(value);
    return isNaN(num) || num <= 0 ? 20 : Math.floor(num);
  })
  @IsNumber({}, { message: 'Giới hạn số dòng phải là số' })
  @Min(1, { message: 'Giới hạn số dòng tối thiểu là 1' })
  limit?: number = 20;
}
