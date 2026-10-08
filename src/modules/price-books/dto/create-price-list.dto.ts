import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerGroup } from '../enums/customer-group.enum';
import { PriceListStatus } from '../enums/price-list-status.enum';
import { CreatePriceListItemDto } from './create-price-list-item.dto';

export class CreatePriceListDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsNotEmpty({ message: 'Tên bảng giá không được để trống' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Nhóm khách hàng áp dụng không được để trống' })
  @IsEnum(CustomerGroup, {
    message: 'Nhóm khách hàng không hợp lệ (AGENT_LEVEL_1, AGENT_LEVEL_2, RETAIL)',
  })
  customerGroup: CustomerGroup;

  @IsNotEmpty({ message: 'Ngày bắt đầu áp dụng không được để trống' })
  @IsString()
  startDate: string;

  @IsNotEmpty({ message: 'Ngày kết thúc áp dụng không được để trống' })
  @IsString()
  endDate: string;

  @IsOptional()
  @IsEnum(PriceListStatus, {
    message: 'Trạng thái bảng giá không hợp lệ (DRAFT, ACTIVE, INACTIVE, EXPIRED)',
  })
  status?: PriceListStatus;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceListItemDto)
  items?: CreatePriceListItemDto[];
}
