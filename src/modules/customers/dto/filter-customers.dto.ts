import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CustomerStatus } from '../entities/customer.entity';

/**
 * DTO Lọc và Tìm kiếm Danh sách Đại lý (SN-37 & EP-03 / S3-08)
 * Hỗ trợ Nhân viên kinh doanh tìm kiếm nhanh khách trong tuyến khi đi thị trường.
 */
export class FilterCustomersDto {
  /**
   * Từ khóa tìm kiếm: Mã đại lý (code), tên đại lý (name), hoặc số điện thoại (phone)
   */
  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm phải là chuỗi' })
  search?: string;

  /**
   * Khu vực / Địa bàn kinh doanh (ví dụ: Miền Bắc, Miền Trung, Miền Nam)
   */
  @IsOptional()
  @IsString({ message: 'Khu vực phải là chuỗi' })
  region?: string;

  /**
   * Phân nhóm khách hàng (AGENT_LEVEL_1, AGENT_LEVEL_2, RETAIL, ...)
   */
  @IsOptional()
  @IsString({ message: 'Nhóm khách hàng phải là chuỗi' })
  customerGroup?: string;

  /**
   * ID Nhân viên kinh doanh phụ trách
   */
  @IsOptional()
  @IsString({ message: 'ID nhân viên kinh doanh phải là chuỗi' })
  salesRepId?: string;

  /**
   * Chỉ lấy các đại lý chưa được phân công nhân sự phụ trách (SN-35)
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unassignedOnly?: boolean;

  /**
   * Trạng thái hoạt động của đại lý (ACTIVE, LOCKED, INACTIVE hoặc ALL)
   */
  @IsOptional()
  @IsString({ message: 'Trạng thái đại lý phải là chuỗi' })
  status?: CustomerStatus | string;

  /**
   * Trang hiện tại (1-indexed)
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số trang phải là số nguyên' })
  @Min(1, { message: 'Số trang tối thiểu là 1' })
  page?: number = 1;

  /**
   * Giới hạn số lượng bản ghi trên một trang
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng phần tử trên trang phải là số nguyên' })
  @Min(1, { message: 'Giới hạn tối thiểu là 1' })
  @Max(100, { message: 'Giới hạn tối đa là 100' })
  limit?: number = 20;
}
