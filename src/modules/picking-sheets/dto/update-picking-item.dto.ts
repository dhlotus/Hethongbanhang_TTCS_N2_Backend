import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ShortPickReasonCode } from '../entities/picking-sheet.entity';

export class UpdatePickingItemDto {
  @IsNumber({}, { message: 'Số lượng thực soạn phải là số hợp lệ' })
  @Min(0, { message: 'Số lượng thực soạn không được âm' })
  pickedQuantity: number;

  @IsOptional()
  @IsString()
  shortPickReason?: string;

  @IsOptional()
  @IsString()
  shortPickReasonCode?: ShortPickReasonCode;

  @IsOptional()
  @IsString()
  notes?: string;
}
