import { IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
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
  @ValidateIf((o) => Boolean(o.phone))
  @Matches(/^(0[235789])[0-9]{8}$/, {
    message: 'Số điện thoại phải là số điện thoại Việt Nam gồm 10 chữ số (bắt đầu bằng 02, 03, 05, 07, 08, 09)',
  })
  phone?: string;

  @IsOptional()
  @ValidateIf((o) => Boolean(o.managerId))
  @Matches(WAREHOUSE_MANAGER_ID_PATTERN, { message: 'Người phụ trách không hợp lệ' })
  managerId?: string;
}
