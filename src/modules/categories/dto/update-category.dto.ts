import { PartialType } from '@nestjs/mapped-types';
import { CreateCategoryDto } from './create-category.dto';

/**
 * DTO Cập nhật thông tin Nhóm hàng (SN-150 / SN-22):
 * - Kế thừa từ PartialType(CreateCategoryDto)
 * - Nghiệp vụ kiểm tra chống vòng lặp vô tận (circular dependency) được thực thi trong Service
 */
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
