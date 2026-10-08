import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { CategoryStatus } from '../../../common/enums/category-status.enum';

/**
 * DTO Thêm mới Nhóm hàng (SN-150 / SN-22):
 * - Hỗ trợ tạo nhóm gốc (level = 1, parentId = null/undefined)
 * - Hoặc tạo nhóm con đệ quy (level = parent.level + 1)
 */
export class CreateCategoryDto {
  @IsNotEmpty({ message: 'Tên nhóm hàng không được để trống' })
  @IsString({ message: 'Tên nhóm hàng phải là chuỗi ký tự' })
  name: string;

  @IsNotEmpty({ message: 'Mã nhóm hàng không được để trống' })
  @IsString({ message: 'Mã nhóm hàng phải là chuỗi ký tự' })
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'Mã nhóm hàng không được chứa khoảng trắng hoặc ký tự đặc biệt',
  })
  code: string;

  @IsOptional()
  @IsString({ message: 'Mã nhóm cha phải là chuỗi ký tự' })
  parentId?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  description?: string;

  @IsOptional()
  @IsEnum(CategoryStatus, {
    message: 'Trạng thái nhóm hàng không hợp lệ (ACTIVE hoặc INACTIVE)',
  })
  status?: CategoryStatus;
}
