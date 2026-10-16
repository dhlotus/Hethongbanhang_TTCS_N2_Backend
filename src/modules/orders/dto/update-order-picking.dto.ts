import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrderStatus } from '../entities/order-status.enum';

/**
 * DTO cập nhật trạng thái đơn hàng trong quy trình soạn hàng kho (SN-186)
 */
export class UpdateOrderPickingDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  pickingSheetCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
