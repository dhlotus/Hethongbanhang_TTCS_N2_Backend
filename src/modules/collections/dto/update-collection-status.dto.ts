import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateCollectionStatusDto {
  @IsNotEmpty({ message: 'Trạng thái xét duyệt không được để trống' })
  @IsIn(['APPROVED', 'REJECTED'], { message: 'Trạng thái chỉ có thể là APPROVED hoặc REJECTED' })
  status: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  rejection_reason?: string;
}
