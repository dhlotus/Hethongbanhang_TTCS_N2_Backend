import { PartialType } from '@nestjs/mapped-types';
import { CreateDeliveryPointDto } from './create-delivery-point.dto';

/**
 * DTO Cập nhật Điểm giao hàng của Đại lý (SN-31 & SN-32)
 */
export class UpdateDeliveryPointDto extends PartialType(CreateDeliveryPointDto) {}
