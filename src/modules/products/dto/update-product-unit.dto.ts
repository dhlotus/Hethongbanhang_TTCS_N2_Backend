import { IsOptional, IsPositive, IsString } from 'class-validator';

/**
 * DTO Cập nhật đơn vị tính hoặc hệ số quy đổi (PUT /api/products/:id/units/:unitId)
 */
export class UpdateProductUnitDto {
  @IsOptional()
  @IsString({ message: 'Tên đơn vị tính phải là chuỗi ký tự' })
  unitName?: string;

  @IsOptional()
  @IsPositive({ message: 'Hệ số quy đổi phải là số dương lớn hơn 0' })
  conversionFactor?: number;

  @IsOptional()
  @IsString({ message: 'Mã vạch barcode phải là chuỗi ký tự' })
  barcode?: string;
}
