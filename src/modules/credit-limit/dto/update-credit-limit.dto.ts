import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentTerm } from '../enums/payment-term.enum';

/**
 * DTO Khai báo / Cập nhật Hạn mức Công nợ Đại lý (SN-34)
 */
export class UpdateCreditLimitDto {
  /**
   * Hạn mức công nợ tối đa (VND)
   */
  @IsNotEmpty({ message: 'Hạn mức công nợ không được để trống' })
  @Type(() => Number)
  @IsNumber({}, { message: 'Hạn mức công nợ phải là chữ số' })
  @Min(0, { message: 'Hạn mức công nợ không được âm' })
  creditLimit: number;

  /**
   * Thời hạn nợ tối đa (Số ngày)
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Thời hạn nợ phải là chữ số' })
  @Min(0, { message: 'Thời hạn nợ không được âm' })
  maxDebtDays?: number;

  /**
   * Điều khoản thanh toán
   */
  @IsOptional()
  @IsString({ message: 'Điều khoản thanh toán phải là chuỗi ký tự' })
  paymentTerms?: string;

  /**
   * Hạn mức tín dụng tạm thời (Mùa vụ / Đợt khuyến mãi)
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Hạn mức tạm thời phải là chữ số' })
  @Min(0, { message: 'Hạn mức tạm thời không được âm' })
  temporaryCreditLimit?: number;

  /**
   * Ngày hết hạn của hạn mức tạm thời
   */
  @IsOptional()
  @IsDateString({}, { message: 'Ngày hết hạn hạn mức tạm thời không hợp lệ' })
  temporaryLimitExpiry?: string;

  /**
   * Cho phép tạo đơn hàng vượt hạn mức (Cần duyệt đơn)
   */
  @IsOptional()
  @IsBoolean({ message: 'Cho phép vượt hạn mức phải là boolean' })
  allowOverLimitOrder?: boolean;

  /**
   * Lý do điều chỉnh hạn mức (Bắt buộc phục vụ Audit Log)
   */
  @IsNotEmpty({ message: 'Lý do điều chỉnh hạn mức là bắt buộc' })
  @IsString({ message: 'Lý do điều chỉnh phải là chuỗi ký tự' })
  @MinLength(5, { message: 'Lý do điều chỉnh phải có ít nhất 5 ký tự' })
  reason: string;
}
