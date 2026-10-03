import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import {
  PROFILE_FULL_NAME_MAX_LENGTH,
  PROFILE_PHONE_MESSAGE,
  VIETNAM_PHONE_PATTERN,
} from '../constants/profile.constant';

export class UpdateProfileDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Họ và tên phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  @MaxLength(PROFILE_FULL_NAME_MAX_LENGTH, {
    message: 'Họ và tên không được vượt quá 100 ký tự',
  })
  fullName?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @Matches(VIETNAM_PHONE_PATTERN, { message: PROFILE_PHONE_MESSAGE })
  phone?: string;
}
