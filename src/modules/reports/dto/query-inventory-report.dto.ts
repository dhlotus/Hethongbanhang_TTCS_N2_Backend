import { IsOptional, IsString, IsIn } from 'class-validator';

export class QueryInventoryReportDto {
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'SLOW_MOVING', 'NORMAL', 'FAST_MOVING', 'DEAD_STOCK'])
  turnoverStatus?: 'ALL' | 'SLOW_MOVING' | 'NORMAL' | 'FAST_MOVING' | 'DEAD_STOCK';

  @IsOptional()
  @IsString()
  days?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(['inventoryValue', 'daysOfInventory', 'physicalQuantity', 'turnoverRate'])
  sortBy?: 'inventoryValue' | 'daysOfInventory' | 'physicalQuantity' | 'turnoverRate';

  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';
}
