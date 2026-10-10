import { IsEnum, IsOptional, IsString } from 'class-validator';
import { GoodsReceiptStatus } from '../entities/goods-receipt.entity';

export class QueryGoodsReceiptsDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  warehouseId?: string;

  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsEnum(GoodsReceiptStatus)
  @IsOptional()
  status?: GoodsReceiptStatus;

  @IsOptional()
  page?: string | number;

  @IsOptional()
  limit?: string | number;
}
