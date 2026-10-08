import { PartialType } from '@nestjs/mapped-types';
import { CreateOrderDto } from './create-order.dto';

/**
 * DTO Cập nhật Đơn hàng (dùng để sửa đổi tiếp tục gõ đơn nháp SN-39)
 */
export class UpdateOrderDto extends PartialType(CreateOrderDto) {}
