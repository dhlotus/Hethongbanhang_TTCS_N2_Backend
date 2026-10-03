import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdjustStockDto {
  @IsNotEmpty({ message: 'Mã SKU hoặc ID sản phẩm không được để trống' })
  @IsString({ message: 'Mã SKU hoặc ID sản phẩm phải là chuỗi' })
  productSku: string;

  @IsNotEmpty({ message: 'Số lượng điều chỉnh không được để trống' })
  @IsInt({ message: 'Số lượng điều chỉnh phải là số nguyên' })
  quantityChange: number;

  @IsNotEmpty({ message: 'Lý do điều chỉnh không được để trống' })
  @IsString({ message: 'Lý do điều chỉnh phải là chuỗi ký tự' })
  reason: string;

  @IsOptional()
  @IsString()
  warehouseLocation?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsString()
  unitName?: string;
}
