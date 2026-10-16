import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * DTO Điều chỉnh tồn kho hàng hóa kèm đơn vị tính quy đổi (SN-23 & EP-04):
 * - productSku: SKU hoặc ID sản phẩm
 * - quantityChange: Số lượng nhập (+) hoặc xuất (-) theo đơn vị gọi hàng (unit)
 * - unit: Đơn vị gọi hàng (lon, lốc, thùng...). Nếu không truyền, mặc định là đơn vị cơ sở
 * - reason: Lý do biến động kho
 * - referenceCode: Mã phiếu kho / chứng từ liên quan
 */
export class AdjustStockDto {
  @IsNotEmpty({ message: 'Mã SKU hoặc ID sản phẩm không được để trống' })
  @IsString({ message: 'Mã SKU hoặc ID sản phẩm phải là chuỗi' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  productSku: string;

  @IsNotEmpty({ message: 'Số lượng điều chỉnh không được để trống' })
  @IsNumber({}, { message: 'Số lượng điều chỉnh phải là số hợp lệ' })
  @Transform(({ value }: { value: unknown }) => Number(value))
  quantityChange: number;

  @IsOptional()
  @IsString({ message: 'Đơn vị tính phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  unit?: string;

  @IsOptional()
  @IsString({ message: 'Đơn vị tính phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  unitName?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsNumber()
  conversionFactor?: number;

  @IsOptional()
  @IsNumber()
  baseQuantityChange?: number;

  @IsNotEmpty({ message: 'Lý do điều chỉnh không được để trống' })
  @IsString({ message: 'Lý do điều chỉnh phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  reason: string;

  @IsOptional()
  @IsString({ message: 'Mã chứng từ / phiếu kho phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  referenceCode?: string;

  @IsOptional()
  @IsString()
  warehouseLocation?: string;

  @IsNotEmpty({ message: 'Kho điều chỉnh (warehouseId) không được để trống' })
  @IsString({ message: 'Mã kho (warehouseId) phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  warehouseId: string;

  @IsOptional()
  @IsString({ message: 'Mã kho (warehouse_id) phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  warehouse_id?: string;
}
