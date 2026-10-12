import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { GoodsReceiptStatus, ReceiptType } from '../entities/goods-receipt.entity';

export class CreateGoodsReceiptItemDto {
  @IsUUID('all', { message: 'productId phải là định dạng UUID hợp lệ' })
  @IsNotEmpty({ message: 'productId không được để trống' })
  productId: string;

  @IsString()
  @IsOptional()
  unitId?: string;

  @IsNumber()
  @Min(0.01)
  packageQuantity: number;

  @IsNumber()
  @Min(0.01)
  conversionFactor: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;

  @IsString()
  @IsOptional()
  batchNumber?: string;

  @IsDateString()
  @IsOptional()
  mfgDate?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateGoodsReceiptDto {
  @IsString()
  @IsNotEmpty({ message: 'warehouseId không được để trống' })
  warehouseId: string;

  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  referenceDocument?: string;

  @IsDateString()
  @IsOptional()
  receiptDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiptItemDto)
  items: CreateGoodsReceiptItemDto[];
}

