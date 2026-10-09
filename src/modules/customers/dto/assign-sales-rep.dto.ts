import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO Gán nhân viên phụ trách chính cho Đại lý (SN-35)
 */
export class AssignSalesRepDto {
  @IsNotEmpty({ message: 'Vui lòng chọn nhân viên kinh doanh phụ trách' })
  @IsString({ message: 'ID nhân viên kinh doanh phải là chuỗi' })
  salesRepId: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
