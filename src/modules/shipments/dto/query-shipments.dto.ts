import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class QueryShipmentsDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsBooleanString()
  hasShortDelivery?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
