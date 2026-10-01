import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @IsOptional()
  @IsString({ message: 'Refresh token phải là chuỗi ký tự nếu được cung cấp' })
  refreshToken?: string;
}
