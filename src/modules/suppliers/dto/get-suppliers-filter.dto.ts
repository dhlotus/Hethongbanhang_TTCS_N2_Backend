import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SupplierStatus } from '../../../common/enums/supplier-status.enum';

/**
 * DTO Lọc và Phân trang Danh sách Nhà Cung Cấp (SN-25):
 * - Hỗ trợ phân trang (page, limit)
 * - Tìm kiếm đa trường (search: mã, tên, MST, SĐT, email)
 * - Lọc theo trạng thái hoạt động (ACTIVE / INACTIVE)
 */
export class GetSuppliersFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Trang phải là số nguyên' })
  @Min(1, { message: 'Trang phải lớn hơn hoặc bằng 1' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng mỗi trang phải là số nguyên' })
  @Min(1, { message: 'Số lượng mỗi trang phải lớn hơn hoặc bằng 1' })
  limit?: number = 20;

  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm phải là chuỗi ký tự' })
  search?: string;

  @IsOptional()
  @IsEnum(SupplierStatus, {
    message: 'Trạng thái phải là ACTIVE hoặc INACTIVE',
  })
  status?: SupplierStatus;
}
