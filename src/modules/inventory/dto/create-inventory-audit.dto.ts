import { IsOptional, IsString } from 'class-validator';

export class CreateInventoryAuditDto {
  @IsOptional()
  @IsString()
  warehouseId?: string = 'WH01';

  @IsOptional()
  @IsString()
  warehouseName?: string = 'Kho Tổng Miền Nam - LOHA WH01';

  @IsOptional()
  @IsString()
  scope?: 'ALL' | 'CATEGORY' = 'ALL';

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  categoryName?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
