import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * DTO truy vấn Lịch sử chuyển giao / phân công địa bàn (SN-35)
 * Hỗ trợ lọc đa tiêu chí, phân trang và tìm kiếm
 */
export class QueryAssignmentHistoryDto {
  /**
   * Trang hiện tại (1-indexed)
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page phải là số nguyên' })
  @Min(1, { message: 'Page phải lớn hơn hoặc bằng 1' })
  page?: number = 1;

  /**
   * Giới hạn số lượng bản ghi trên một trang (tối đa 100)
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit phải là số nguyên' })
  @Min(1, { message: 'Limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'Limit tối đa là 100' })
  limit?: number = 20;

  /**
   * Từ khóa tìm kiếm: tên đại lý, mã đại lý, lý do, người thực hiện, mã đợt bàn giao
   */
  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm phải là chuỗi' })
  search?: string;

  /**
   * ID nhân viên kinh doanh chuyển giao (bàn giao)
   */
  @IsOptional()
  @IsString({ message: 'fromSalesRepId phải là chuỗi' })
  fromSalesRepId?: string;

  /**
   * ID nhân viên kinh doanh tiếp nhận
   */
  @IsOptional()
  @IsString({ message: 'toSalesRepId phải là chuỗi' })
  toSalesRepId?: string;

  /**
   * ID đại lý cụ thể
   */
  @IsOptional()
  @IsString({ message: 'customerId phải là chuỗi' })
  customerId?: string;

  /**
   * Mã đợt bàn giao hàng loạt (BATCH-...)
   */
  @IsOptional()
  @IsString({ message: 'transferBatchId phải là chuỗi' })
  transferBatchId?: string;

  /**
   * Lọc lịch sử từ ngày (định dạng YYYY-MM-DD hoặc ISO string)
   */
  @IsOptional()
  @IsString({ message: 'startDate phải là chuỗi' })
  startDate?: string;

  /**
   * Lọc lịch sử đến ngày (định dạng YYYY-MM-DD hoặc ISO string)
   */
  @IsOptional()
  @IsString({ message: 'endDate phải là chuỗi' })
  endDate?: string;
}

