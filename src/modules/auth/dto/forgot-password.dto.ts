import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPasswordDto {
  @IsNotEmpty({ message: 'Vui lòng cung cấp địa chỉ email' })
  @IsEmail({}, { message: 'Định dạng email không hợp lệ' })
  email: string;
}
