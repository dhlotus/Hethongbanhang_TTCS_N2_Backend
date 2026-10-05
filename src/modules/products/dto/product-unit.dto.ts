import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * DTO Khai báo Đơn vị tính quy đổi của Sản phẩm (SN-23):
 * - unitName: Tên đơn vị (lon, lốc, thùng, bao, kiện...)
 * - conversionRate: Hệ số quy đổi về đơn vị cơ sở (phải > 0)
 * - isBaseUnit: Có phải đơn vị cơ sở nhỏ nhất không
 */
export class ProductUnitDto {
  @IsNotEmpty({ message: 'Tên đơn vị quy đổi không được để trống' })
  @IsString({ message: 'Tên đơn vị phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  unitName: string;

  @IsNotEmpty({ message: 'Hệ số quy đổi không được để trống' })
  @IsNumber({}, { message: 'Hệ số quy đổi phải là số hợp lệ' })
  @Min(0.0001, { message: 'Hệ số quy đổi phải lớn hơn 0' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value !== undefined) return Number(value);
    if (obj.conversion_factor !== undefined) return Number(obj.conversion_factor);
    return value;
  })
  conversionRate: number;

  @IsOptional()
  @IsBoolean({ message: 'isBaseUnit phải là giá trị boolean' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value !== undefined) return Boolean(value);
    if (obj.is_base_unit !== undefined) return Boolean(obj.is_base_unit);
    return false;
  })
  isBaseUnit?: boolean;

  @IsOptional()
  @IsString({ message: 'Mã vạch đơn vị phải là chuỗi ký tự' })
  barcode?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Giá bán theo đơn vị phải là số' })
  @Min(0, { message: 'Giá bán không được âm' })
  price?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giá vốn theo đơn vị phải là số' })
  @Min(0, { message: 'Giá vốn không được âm' })
  costPrice?: number;
}
