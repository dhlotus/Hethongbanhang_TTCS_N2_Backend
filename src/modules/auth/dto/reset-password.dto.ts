import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsNotEmpty({ message: 'Mã xác thực token là bắt buộc' })
  @IsString({ message: 'Mã xác thực token phải là chuỗi ký tự' })
  token: string;

  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @IsString({ message: 'Mật khẩu mới phải là chuỗi ký tự' })
  @MinLength(8, { message: 'Mật khẩu phải có tối thiểu 8 ký tự' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'Mật khẩu phải chứa ít nhất một chữ cái và một chữ số',
  })
  newPassword: string;
}
