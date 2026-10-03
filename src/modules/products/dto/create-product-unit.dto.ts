import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

/**
 * DTO Khai báo thêm đơn vị tính mới cho SKU (POST /api/products/:id/units)
 * Ví dụ: Khai báo thêm đơn vị "Lốc" (hệ số 6), "Thùng" (hệ số 24).
 */
export class CreateProductUnitDto {
  @IsNotEmpty({ message: 'Tên đơn vị tính không được để trống' })
  @IsString({ message: 'Tên đơn vị tính phải là chuỗi ký tự' })
  unitName: string;

  @IsNotEmpty({ message: 'Hệ số quy đổi không được để trống' })
  @IsPositive({ message: 'Hệ số quy đổi phải là số dương lớn hơn 0' })
  conversionFactor: number;

  @IsOptional()
  @IsBoolean({ message: 'isBaseUnit phải là giá trị boolean' })
  isBaseUnit?: boolean;

  @IsOptional()
  @IsString({ message: 'Mã vạch barcode phải là chuỗi ký tự' })
  barcode?: string;
}
