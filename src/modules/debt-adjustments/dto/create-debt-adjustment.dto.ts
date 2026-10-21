import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDebtAdjustmentDto {
  @IsNotEmpty({ message: 'Vui lòng chọn phiếu trả hàng (return_receipt_id)' })
  @IsString()
  return_receipt_id: string;

  @IsOptional()
  @IsString()
  agency_id?: string;

  @IsOptional()
  @IsString()
  original_invoice_id?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
