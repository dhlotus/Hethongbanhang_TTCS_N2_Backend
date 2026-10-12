import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TransferStatus } from '../entities/transfer-status.enum';

export class QueryTransfersDto {
  @IsOptional()
  @IsEnum(TransferStatus, { message: 'Trạng thái chuyển kho không hợp lệ' })
  status?: TransferStatus;

  @IsOptional()
  @IsString()
  fromWarehouseId?: string;

  @IsOptional()
  @IsString()
  toWarehouseId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
