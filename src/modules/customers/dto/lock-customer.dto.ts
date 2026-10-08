import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * DTO yêu cầu khóa giao dịch với đại lý (SN-36)
 */
export class LockCustomerDto {
  /**
   * Lý do khóa đại lý (Bắt buộc)
   */
  @IsNotEmpty({ message: 'Lý do khóa đại lý không được để trống' })
  @IsString({ message: 'Lý do khóa đại lý phải là chuỗi ký tự' })
  @MaxLength(500, { message: 'Lý do khóa tối đa 500 ký tự' })
  reason: string;
}
