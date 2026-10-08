import { IsOptional, IsString } from 'class-validator';

export class ClonePriceListDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;
}
