import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { WAREHOUSE_MANAGER_ID_PATTERN } from '../warehouse.constants';

export class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @Matches(WAREHOUSE_MANAGER_ID_PATTERN, { message: 'Người phụ trách không hợp lệ' })
  managerId?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
