import { IsOptional, IsString } from 'class-validator';

export class ClonePriceListDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
