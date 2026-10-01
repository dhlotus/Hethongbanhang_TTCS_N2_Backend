import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { UserStatus } from '../../../common/enums/user-status.enum';

export class UpdateUserStatusDto {
  @IsNotEmpty({ message: 'Trạng thái tài khoản không được để trống' })
  @IsEnum(UserStatus, { message: 'Trạng thái không hợp lệ (ACTIVE, LOCKED, INACTIVE)' })
  status: UserStatus;

  @IsNotEmpty({ message: 'Bắt buộc nhập lý do thay đổi trạng thái tài khoản' })
  @IsString({ message: 'Lý do phải là chuỗi ký tự' })
  reason: string;
}
