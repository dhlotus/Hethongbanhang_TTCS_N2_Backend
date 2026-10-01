import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'Email hoặc tên đăng nhập không được để trống' })
  @IsString({ message: 'Email hoặc tên đăng nhập phải là chuỗi ký tự' })
  email!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @IsString({ message: 'Mật khẩu phải là chuỗi ký tự' })
  @MinLength(6, { message: 'Mật khẩu phải có tối thiểu 6 ký tự' })
  password!: string;
}
