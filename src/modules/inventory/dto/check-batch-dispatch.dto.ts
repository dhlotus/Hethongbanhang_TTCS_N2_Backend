import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * DTO kiểm tra điều kiện xuất kho của lô hàng và ghi đè của Quản lý kho (SN-184 AC-4)
 * - Không cho xuất lô đã quá hạn, trừ khi Quản lý kho xác nhận ghi đè kèm lý do
 */
export class CheckBatchDispatchDto {
  @IsOptional()
  @IsString({ message: 'Mã định danh lô hàng (batchId) phải là chuỗi' })
  batchId?: string;

  @IsOptional()
  @IsString({ message: 'Số lô hàng (batchNumber) phải là chuỗi' })
  batchNumber?: string;

  @IsOptional()
  @IsString({ message: 'Mã kho (warehouseId) phải là chuỗi' })
  warehouseId?: string;

  @IsOptional()
  @IsString({ message: 'Mã sản phẩm (productId) phải là chuỗi' })
  productId?: string;

  @IsOptional()
  @IsString({ message: 'Mã SKU phải là chuỗi' })
  sku?: string;

  @IsNotEmpty({ message: 'Số lượng cần xuất không được để trống' })
  @IsNumber({}, { message: 'Số lượng cần xuất phải là số' })
  @Min(0.001, { message: 'Số lượng cần xuất phải lớn hơn 0' })
  quantity: number;

  @IsOptional()
  @IsString({ message: 'Lý do ghi đè của Quản lý kho phải là chuỗi' })
  managerOverrideReason?: string;
}
