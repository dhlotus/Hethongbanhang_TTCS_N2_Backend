import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordWithCodeDto {
  @IsNotEmpty({ message: 'Tên đăng nhập hoặc Email là bắt buộc' })
  @IsString({ message: 'Tên đăng nhập hoặc Email phải là chuỗi ký tự' })
  identifier: string;

  @IsNotEmpty({ message: 'Mã cấp đổi mật khẩu là bắt buộc' })
  @IsString({ message: 'Mã cấp đổi mật khẩu phải là chuỗi ký tự' })
  resetCode: string;

  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @IsString({ message: 'Mật khẩu mới phải là chuỗi ký tự' })
  @MinLength(8, { message: 'Mật khẩu phải có tối thiểu 8 ký tự' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'Mật khẩu phải chứa ít nhất một chữ cái và một chữ số',
  })
  newPassword: string;
}
