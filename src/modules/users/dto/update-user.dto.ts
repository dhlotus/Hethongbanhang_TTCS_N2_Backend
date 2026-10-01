import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';

export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự' })
  fullName?: string;

  @IsOptional()
  @IsString({ message: 'Tên đăng nhập phải là chuỗi ký tự' })
  username?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email?: string;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  phone?: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'Vai trò không hợp lệ trong 7 vai trò hệ thống' })
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserRole, { each: true, message: 'Vai trò trong danh sách không hợp lệ trong 7 vai trò hệ thống' })
  roles?: UserRole[];

  @IsOptional()
  @IsString({ message: 'Kho phụ trách phải là chuỗi' })
  assignedWarehouse?: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải có ít nhất 6 ký tự' })
  password?: string;
}
