import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

/**
 * DTO dữ liệu đầu vào API Đổi mật khẩu (SN-9)
 */
export class ChangePasswordDto {
  @IsNotEmpty({ message: 'Mật khẩu hiện tại không được để trống' })
  @IsString({ message: 'Mật khẩu hiện tại phải là chuỗi ký tự' })
  currentPassword!: string;

  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @IsString({ message: 'Mật khẩu mới phải là chuỗi ký tự' })
  @MinLength(8, { message: 'Mật khẩu mới phải có tối thiểu 8 ký tự' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d)/, {
    message: 'Mật khẩu mới bắt buộc phải chứa cả chữ cái và chữ số',
  })
  newPassword!: string;
}
