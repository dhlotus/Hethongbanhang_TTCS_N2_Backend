import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ProductStatus } from '../../../common/enums/product-status.enum';

/**
 * DTO Lọc và Phân trang Sản phẩm / SKU (SN-138):
 * - Hỗ trợ phân trang (page, limit)
 * - Tìm kiếm đa trường (search: sku, tên)
 * - Lọc theo danh mục 2 cấp và trạng thái hoạt động
 */
export class GetProductsFilterDto {
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
  @IsString({ message: 'Danh mục chính phải là chuỗi ký tự' })
  parentCategory?: string;

  @IsOptional()
  @IsString({ message: 'Danh mục phụ phải là chuỗi ký tự' })
  subCategory?: string;

  @IsOptional()
  @IsString({ message: 'Ngành hàng phải là chuỗi ký tự' })
  category?: string;

  @IsOptional()
  @IsEnum(ProductStatus, { message: 'Trạng thái phải là ACTIVE hoặc INACTIVE' })
  status?: ProductStatus;
}
