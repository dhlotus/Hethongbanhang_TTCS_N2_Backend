import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { CustomerGroup } from '../../../common/enums/customer-group.enum';
import { PriceListStatus } from '../../../common/enums/price-list-status.enum';
import { PriceListItemDto } from './price-list-item.dto';

export class CreatePriceListDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsNotEmpty({ message: 'Tên bảng giá không được để trống' })
  @IsString()
  name: string;

  @IsNotEmpty({ message: 'Nhóm khách hàng áp dụng không được để trống' })
  @IsEnum(CustomerGroup, {
    message: 'Nhóm khách hàng phải là một trong: AGENT_LEVEL_1, AGENT_LEVEL_2, RETAIL',
  })
  customerGroup: CustomerGroup;

  @IsNotEmpty({ message: 'Ngày bắt đầu hiệu lực không được để trống' })
  @IsString()
  startDate: string;

  @IsNotEmpty({ message: 'Ngày kết thúc hiệu lực không được để trống' })
  @IsString()
  endDate: string;

  @IsOptional()
  @IsEnum(PriceListStatus, {
    message: 'Trạng thái bảng giá phải là DRAFT, ACTIVE, INACTIVE hoặc EXPIRED',
  })
  status?: PriceListStatus;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách sản phẩm items phải là một mảng' })
  @ValidateNested({ each: true })
  @Type(() => PriceListItemDto)
  items?: PriceListItemDto[];
}
