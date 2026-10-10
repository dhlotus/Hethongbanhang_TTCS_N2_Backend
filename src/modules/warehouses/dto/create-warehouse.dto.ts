import { IsOptional, IsString, IsNotEmpty, Matches } from 'class-validator';

export class CreateWarehouseDto {
  @IsString() @IsNotEmpty() code: string;
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() address: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @Matches(/^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/, { message: 'Người phụ trách không hợp lệ' }) managerId?: string;
}
