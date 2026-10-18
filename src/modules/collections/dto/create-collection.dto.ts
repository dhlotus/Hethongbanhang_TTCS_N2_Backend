import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCollectionDto {
  @IsNotEmpty({ message: 'Vui lòng chọn đại lý cần thu tiền' })
  @IsString()
  agency_id: string;

  @IsOptional()
  @IsString()
  agency_name?: string;

  @IsNotEmpty({ message: 'Vui lòng nhập số tiền thu' })
  @Type(() => Number)
  @IsNumber({}, { message: 'Số tiền phải là số hợp lệ' })
  @Min(1000, { message: 'Số tiền thu tối thiểu là 1,000 đ' })
  amount: number;

  @IsOptional()
  @IsString()
  payment_method?: 'CASH' | 'BANK_TRANSFER';

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  collection_date?: string;

  @IsOptional()
  @IsString()
  receipt_image_url?: string;
}
