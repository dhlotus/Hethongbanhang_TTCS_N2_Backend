import { IsEnum, IsNotEmpty, IsString, ValidateIf } from 'class-validator';
import { OrderApprovalAction } from '../entities/order-approval-action.enum';

export class DecideOrderDto {
  @IsEnum(OrderApprovalAction)
  action: OrderApprovalAction;

  @ValidateIf((dto: DecideOrderDto) => dto.action !== OrderApprovalAction.APPROVE)
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập ý kiến khi từ chối hoặc trả lại đơn.' })
  comment?: string;
}
