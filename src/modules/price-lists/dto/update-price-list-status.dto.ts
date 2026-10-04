import { IsEnum, IsNotEmpty } from 'class-validator';
import { PriceListStatus } from '../../../common/enums/price-list-status.enum';

export class UpdatePriceListStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  @IsEnum(PriceListStatus, {
    message: 'Trạng thái phải là một trong: DRAFT, ACTIVE, INACTIVE, EXPIRED',
  })
  status: PriceListStatus;
}
