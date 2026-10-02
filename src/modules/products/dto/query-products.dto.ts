import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * DTO Tìm kiếm và phân trang sản phẩm (GET /api/products)
 * Tuân thủ chuẩn API Contract SN-138 / SN-139 / SN-20
 */
export class QueryProductsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số trang phải là số nguyên' })
  @Min(1, { message: 'Trang tối thiểu là 1' })
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Giới hạn số dòng phải là số nguyên' })
  @Min(1, { message: 'Giới hạn tối thiểu là 1' })
  @Max(100, { message: 'Giới hạn tối đa là 100' })
  limit?: number = 20;

  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm phải là chuỗi ký tự' })
  search?: string;

  @IsOptional()
  @IsString({ message: 'Danh mục cha phải là chuỗi ký tự' })
  parentCategory?: string;

  @IsOptional()
  @IsString({ message: 'Danh mục con phải là chuỗi ký tự' })
  subCategory?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'], {
    message: 'Trạng thái phải là ACTIVE hoặc INACTIVE',
  })
  status?: 'ACTIVE' | 'INACTIVE';
}
