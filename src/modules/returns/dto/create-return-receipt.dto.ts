import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum ReturnConditionType {
  GOOD = 'GOOD',
  DAMAGED = 'DAMAGED',
}

export class ReturnReceiptItemDto {
  @IsString()
  @IsNotEmpty({ message: 'product_id không được để trống' })
  product_id: string;

  @IsString()
  @IsOptional()
  product_sku?: string;

  @IsString()
  @IsOptional()
  product_name?: string;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  batch_number?: string;

  @IsNumber()
  @Min(0.01, { message: 'Số lượng trả phải lớn hơn 0' })
  @Type(() => Number)
  quantity: number;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  unit_price?: number;

  @IsEnum(ReturnConditionType, { message: 'condition_type phải là GOOD hoặc DAMAGED' })
  condition_type: ReturnConditionType;

  @IsString()
  @IsOptional()
  sub_reason?: string;
}

export class CreateReturnReceiptDto {
  @IsString()
  @IsNotEmpty({ message: 'original_invoice_id không được để trống' })
  original_invoice_id: string;

  @IsString()
  @IsNotEmpty({ message: 'agency_id không được để trống' })
  agency_id: string;

  @IsString()
  @IsOptional()
  warehouse_id?: string;

  @IsString()
  @IsNotEmpty({ message: 'Lý do trả hàng không được để trống' })
  reason: string;

  @IsArray({ message: 'Danh sách sản phẩm items phải là một mảng' })
  @ValidateNested({ each: true })
  @Type(() => ReturnReceiptItemDto)
  items: ReturnReceiptItemDto[];
}
