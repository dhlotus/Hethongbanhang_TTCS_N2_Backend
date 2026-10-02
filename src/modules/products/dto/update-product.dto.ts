import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

/**
 * DTO Cập nhật thông tin sản phẩm (PATCH /api/products/:id)
 * Tuân thủ chuẩn API Contract SN-138 / SN-139 / SN-20
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString({ message: 'Mã SKU phải là chuỗi ký tự' })
  sku?: string;

  @IsOptional()
  @IsString({ message: 'Tên sản phẩm phải là chuỗi ký tự' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Danh mục cha phải là chuỗi ký tự' })
  parentCategory?: string;

  @IsOptional()
  @IsString({ message: 'Danh mục con phải là chuỗi ký tự' })
  subCategory?: string;

  @IsOptional()
  @IsString({ message: 'Ngành hàng phải là chuỗi ký tự' })
  category?: string;

  @IsOptional()
  @IsString({ message: 'Đơn vị cơ sở phải là chuỗi ký tự' })
  baseUnit?: string;

  @IsOptional()
  @IsString({ message: 'Quy cách đóng gói phải là chuỗi ký tự' })
  packagingSpec?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Giá bán phải là số hợp lệ' })
  @IsPositive({ message: 'Giá bán phải là số dương lớn hơn 0' })
  price?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giá vốn phải là số hợp lệ' })
  @Min(0, { message: 'Giá vốn không được âm' })
  costPrice?: number;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'], {
    message: 'Trạng thái phải là ACTIVE hoặc INACTIVE',
  })
  status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional()
  @IsNumber({}, { message: 'Số lượng tồn phải là số' })
  @Min(0, { message: 'Số lượng tồn không được âm' })
  stockQuantity?: number;

  @IsOptional()
  @IsString({ message: 'Mã vạch barcode phải là chuỗi ký tự' })
  barcode?: string;

  @IsOptional()
  @IsString({ message: 'Đường dẫn ảnh phải là chuỗi ký tự' })
  imageUrl?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  description?: string;
}
