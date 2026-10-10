import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CompleteAuditDto {
  @IsNotEmpty({ message: 'Bắt buộc phải nhập lý do điều chỉnh khi chốt phiếu kiểm kê' })
  @IsString({ message: 'Lý do điều chỉnh phải là chuỗi ký tự' })
  reason: string;

  @IsOptional()
  @IsString()
  note?: string;
}
