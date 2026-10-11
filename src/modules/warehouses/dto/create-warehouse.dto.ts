import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { WAREHOUSE_MANAGER_ID_PATTERN } from '../warehouse.constants';

export class CreateWarehouseDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @Matches(WAREHOUSE_MANAGER_ID_PATTERN, { message: 'Người phụ trách không hợp lệ' })
  managerId?: string;
}
