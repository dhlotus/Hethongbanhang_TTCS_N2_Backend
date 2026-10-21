import { IsBooleanString, IsEnum, IsOptional, IsString } from 'class-validator';
import { DeliveryTripStatus } from '../entities/delivery-trip-status.enum';

export class QueryDeliveryTripsDto {
  @IsOptional()
  @IsEnum(DeliveryTripStatus, { message: 'Trạng thái chuyến đi không hợp lệ' })
  status?: DeliveryTripStatus;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsBooleanString({ message: 'isOverdue phải là boolean string (true/false)' })
  isOverdue?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;
}
