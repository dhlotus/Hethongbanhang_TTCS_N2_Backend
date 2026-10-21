import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { StockAdjustmentReason } from '../entities/stock-adjustment.entity';

export class CreateStockAdjustmentItemDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsNotEmpty()
  productSku: string;

  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsNumber()
  @Min(0)
  currentStock: number;

  @IsNumber()
  @Min(1)
  adjustedQuantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsNumber()
  @Min(0)
  lossValue: number;

  @IsIn(['DAMAGED', 'LOST', 'EXPIRED', 'OTHER'])
  reason: StockAdjustmentReason;

  @IsString()
  @IsOptional()
  note?: string;
}

export class CreateStockAdjustmentDto {
  @IsString()
  @IsOptional()
  warehouseId?: string;

  @IsString()
  @IsOptional()
  warehouseName?: string;

  @IsIn(['DAMAGED', 'LOST', 'EXPIRED', 'OTHER'])
  @IsNotEmpty()
  reason: StockAdjustmentReason;

  @IsString()
  @IsOptional()
  reasonDetail?: string;

  @IsNumber()
  @Min(0)
  totalLossValue: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockAdjustmentItemDto)
  items: CreateStockAdjustmentItemDto[];

  @IsString()
  @IsOptional()
  note?: string;
}

export class RejectStockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  rejectReason: string;
}

export class QueryStockAdjustmentsDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  warehouseId?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  fromDate?: string;

  @IsString()
  @IsOptional()
  toDate?: string;
}
