import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO Chuyển giao địa bàn hàng loạt khi nhân viên nghỉ việc (SN-35)
 */
export class BulkTransferTerritoryDto {
  @IsNotEmpty({ message: 'Vui lòng chọn nhân sự kinh doanh chuyển giao' })
  @IsString({ message: 'ID nhân viên chuyển giao phải là chuỗi' })
  fromSalesRepId: string;

  @IsNotEmpty({ message: 'Vui lòng chọn nhân sự kinh doanh tiếp nhận' })
  @IsString({ message: 'ID nhân viên tiếp nhận phải là chuỗi' })
  toSalesRepId: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách đại lý phải là một mảng' })
  @IsString({ each: true, message: 'ID mỗi đại lý phải là chuỗi' })
  customerIds?: string[];

  @IsNotEmpty({ message: 'Bắt buộc phải nhập lý do chuyển giao địa bàn' })
  @IsString({ message: 'Lý do chuyển giao phải là chuỗi' })
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
