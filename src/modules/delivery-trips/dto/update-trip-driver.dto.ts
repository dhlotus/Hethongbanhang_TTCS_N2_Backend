import { IsOptional, IsString } from 'class-validator';

export class UpdateTripDriverDto {
  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;
}
