import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class AuditItemInputDto {
  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsNumber()
  @Min(0)
  actualQuantity: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateAuditItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuditItemInputDto)
  items: AuditItemInputDto[];
}
