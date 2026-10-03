import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { ProductStatus } from '../../../common/enums/product-status.enum';

/**
 * DTO Tạo mới Sản phẩm / SKU (SN-138 & SN-20):
 * - Ràng buộc dữ liệu đầu vào nghiêm ngặt
 * - Tự động chuẩn hóa SKU (uppercase, kiểm tra không chứa khoảng trắng)
 * - Tự động liên kết danh mục 2 cấp parentCategory / subCategory / category
 */
export class CreateProductDto {
  @IsNotEmpty({ message: 'Mã SKU không được để trống' })
  @IsString({ message: 'Mã SKU phải là chuỗi ký tự' })
  @Matches(/^\S+$/, { message: 'Mã SKU không được chứa khoảng trắng' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  sku: string;

  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  @IsString({ message: 'Tên sản phẩm phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  @IsNotEmpty({ message: 'Danh mục chính (parentCategory) không được để trống' })
  @IsString({ message: 'Danh mục chính phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value) return typeof value === 'string' ? value.trim() : value;
    if (obj.parent_category) {
      return typeof obj.parent_category === 'string'
        ? obj.parent_category.trim()
        : obj.parent_category;
    }
    if (typeof obj.category === 'string' && obj.category.includes('/')) {
      return obj.category.split('/')[0].trim();
    }
    return value;
  })
  parentCategory: string;

  @IsOptional()
  @IsString({ message: 'Danh mục phụ phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value) return typeof value === 'string' ? value.trim() : value;
    if (obj.sub_category) {
      return typeof obj.sub_category === 'string'
        ? obj.sub_category.trim()
        : obj.sub_category;
    }
    if (typeof obj.category === 'string' && obj.category.includes('/')) {
      return obj.category.split('/')[1].trim();
    }
    return value;
  })
  subCategory?: string;

  @IsOptional()
  @IsString({ message: 'Ngành hàng phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value) return typeof value === 'string' ? value.trim() : value;
    const parent = (obj.parentCategory || obj.parent_category) as
      | string
      | undefined;
    const sub = (obj.subCategory || obj.sub_category) as string | undefined;
    if (parent && sub) {
      return `${parent.trim()} / ${sub.trim()}`;
    }
    return value ?? parent;
  })
  category?: string;

  @IsNotEmpty({ message: 'Đơn vị cơ sở (baseUnit) không được để trống' })
  @IsString({ message: 'Đơn vị cơ sở phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    return value ?? obj.base_unit;
  })
  baseUnit: string;

  @IsOptional()
  @IsString({ message: 'Quy cách đóng gói (packagingSpec) phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    return value ?? obj.packaging_spec;
  })
  packagingSpec?: string;

  @IsNotEmpty({ message: 'Giá bán không được để trống' })
  @IsNumber({}, { message: 'Giá bán phải là số hợp lệ' })
  @Min(0.01, { message: 'Giá bán phải là số dương lớn hơn 0' })
  price: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giá vốn phải là số hợp lệ' })
  @Min(0, { message: 'Giá vốn không được âm' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    return value !== undefined ? value : obj.cost_price;
  })
  costPrice?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số lượng tồn đầu phải là số' })
  @Min(0, { message: 'Số lượng tồn không được âm' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    return value !== undefined ? value : obj.stock_quantity;
  })
  stockQuantity?: number = 0;

  @IsOptional()
  @IsEnum(ProductStatus, { message: 'Trạng thái phải là ACTIVE hoặc INACTIVE' })
  status?: ProductStatus = ProductStatus.ACTIVE;

  @IsOptional()
  @IsString({ message: 'Đường dẫn ảnh imageUrl phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    return value ?? obj.image_url;
  })
  imageUrl?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  description?: string;
}
