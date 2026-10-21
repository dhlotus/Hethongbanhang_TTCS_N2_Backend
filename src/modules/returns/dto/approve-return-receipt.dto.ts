import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum ReturnApprovalAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ApproveReturnReceiptDto {
  @IsEnum(ReturnApprovalAction, { message: 'action phải là APPROVE hoặc REJECT' })
  @IsNotEmpty({ message: 'action không được để trống' })
  action: ReturnApprovalAction;

  @IsString()
  @IsOptional()
  note?: string;
}
