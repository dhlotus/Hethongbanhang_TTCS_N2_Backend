import { IsOptional, IsString } from 'class-validator';

/**
 * DTO Truy vấn danh sách thanh toán & đối trừ công nợ
 * Subtask: SN-202 (Sprint 7)
 */
export class QueryPaymentsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
