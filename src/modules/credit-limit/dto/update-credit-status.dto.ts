import { IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { CreditStatus } from '../enums/credit-status.enum';

/**
 * DTO Khóa hoặc Mở khóa Hạn mức Công nợ (SN-34)
 */
export class UpdateCreditStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  @IsEnum(CreditStatus, { message: 'Trạng thái không hợp lệ' })
  status: CreditStatus;

  @IsNotEmpty({ message: 'Lý do thay đổi trạng thái là bắt buộc' })
  @IsString({ message: 'Lý do phải là chuỗi ký tự' })
  @MinLength(5, { message: 'Lý do phải có ít nhất 5 ký tự' })
  reason: string;
}
