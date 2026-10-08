import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO Khai báo & Cập nhật Hạn mức Công nợ Đại lý (SN-34)
 * Validate hạn mức tiền, số ngày nợ và BẮT BUỘC có lý do thay đổi
 */
export class UpdateCreditLimitDto {
  /**
   * Hạn mức tiền tối đa (VND)
   */
  @IsNotEmpty({ message: 'Hạn mức tiền tối đa không được để trống' })
  @Type(() => Number)
  @IsNumber({}, { message: 'Hạn mức tiền tối đa phải là số' })
  @Min(0, { message: 'Hạn mức tiền tối đa không được nhỏ hơn 0' })
  creditLimit: number;

  /**
   * Số ngày nợ tối đa
   */
  @IsNotEmpty({ message: 'Số ngày nợ tối đa không được để trống' })
  @Type(() => Number)
  @IsNumber({}, { message: 'Số ngày nợ tối đa phải là số' })
  @Min(0, { message: 'Số ngày nợ tối đa không được nhỏ hơn 0' })
  maxDebtDays: number;

  /**
   * Lý do thay đổi hạn mức công nợ (BẮT BUỘC cho kiểm toán)
   */
  @IsNotEmpty({ message: 'Lý do thay đổi hạn mức là bắt buộc' })
  @IsString({ message: 'Lý do thay đổi phải là chuỗi ký tự' })
  @MinLength(5, { message: 'Lý do thay đổi phải có ít nhất 5 ký tự' })
  reason: string;

  /**
   * Điều khoản thanh toán (NET_30, NET_45, COD...)
   */
  @IsOptional()
  @IsString({ message: 'Điều khoản thanh toán phải là chuỗi ký tự' })
  paymentTerms?: string;

  /**
   * Hạn mức cấp thêm tạm thời (Mùa vụ)
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Hạn mức tạm thời phải là số' })
  @Min(0, { message: 'Hạn mức tạm thời không được nhỏ hơn 0' })
  temporaryCreditLimit?: number;

  /**
   * Ngày hết hạn hạn mức tạm thời
   */
  @IsOptional()
  @IsDateString({}, { message: 'Ngày hết hạn hạn mức tạm thời không đúng định dạng' })
  temporaryLimitExpiry?: string;

  /**
   * Cho phép đặt đơn hàng vượt hạn mức khi có xét duyệt
   */
  @IsOptional()
  @IsBoolean({ message: 'Cho phép vượt hạn mức phải là boolean' })
  allowOverLimitOrder?: boolean;
}
