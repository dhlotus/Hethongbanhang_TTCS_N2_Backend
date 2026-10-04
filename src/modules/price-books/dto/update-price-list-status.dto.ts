import { IsEnum, IsNotEmpty } from 'class-validator';
import { PriceListStatus } from '../enums/price-list-status.enum';

export class UpdatePriceListStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  @IsEnum(PriceListStatus, {
    message: 'Trạng thái bảng giá không hợp lệ (DRAFT, ACTIVE, INACTIVE, EXPIRED)',
  })
  status: PriceListStatus;
}
