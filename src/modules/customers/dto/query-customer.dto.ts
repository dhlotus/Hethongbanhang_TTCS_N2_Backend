import { IsOptional, IsString } from 'class-validator';

/**
 * DTO Tìm kiếm và lọc danh sách Đại lý
 */
export class QueryCustomerDto {
  @IsOptional()
  @IsString({ message: 'Từ khóa tìm kiếm phải là chuỗi' })
  search?: string;

  @IsOptional()
  @IsString({ message: 'Nhóm đại lý phải là chuỗi' })
  group?: string;

  @IsOptional()
  @IsString({ message: 'Trạng thái phải là chuỗi' })
  status?: string;
}
