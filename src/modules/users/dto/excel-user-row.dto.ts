import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';

/**
 * DTO đại diện cho một dòng dữ liệu trong file Excel (SN-147).
 * Dùng để validate từng dòng trước khi tạo tài khoản.
 */
export class ExcelUserRowDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự' })
  fullName: string;

  @IsNotEmpty({ message: 'Tên đăng nhập không được để trống' })
  @IsString({ message: 'Tên đăng nhập phải là chuỗi ký tự' })
  username: string;

  @IsNotEmpty({ message: 'Email không được để trống' })
  @IsString({ message: 'Email không đúng định dạng' })
  email: string;

  @IsNotEmpty({ message: 'Vai trò không được để trống' })
  @IsEnum(UserRole, { message: 'Vai trò không hợp lệ trong 7 vai trò hệ thống' })
  role: UserRole;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  phone?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString({ message: 'Kho phụ trách phải là chuỗi ký tự' })
  assignedWarehouse?: string;
}
