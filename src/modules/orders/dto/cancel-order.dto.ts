import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelOrderDto {
  @IsString({ message: 'Lý do hủy đơn hàng phải là chuỗi văn bản' })
  @IsNotEmpty({ message: 'Bắt buộc phải nhập lý do hủy đơn hàng' })
  @MaxLength(1000, { message: 'Lý do hủy đơn hàng không được vượt quá 1000 ký tự' })
  reason: string;
}
