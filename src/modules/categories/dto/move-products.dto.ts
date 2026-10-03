import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO Di chuyển sản phẩm giữa các nhóm hàng (SN-150 / SN-22):
 * - sourceCategoryId: Nhóm hàng nguồn
 * - targetCategoryId: Nhóm hàng đích (bắt buộc khác nguồn)
 * - productIds: Danh sách ID sản phẩm cần chuyển (nếu không truyền -> chuyển toàn bộ)
 */
export class MoveProductsDto {
  @IsNotEmpty({ message: 'Mã nhóm hàng nguồn không được để trống' })
  @IsString({ message: 'Mã nhóm hàng nguồn phải là chuỗi ký tự' })
  sourceCategoryId: string;

  @IsNotEmpty({ message: 'Mã nhóm hàng đích không được để trống' })
  @IsString({ message: 'Mã nhóm hàng đích phải là chuỗi ký tự' })
  targetCategoryId: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách mã sản phẩm phải là mảng chuỗi' })
  @IsString({ each: true, message: 'Mỗi mã sản phẩm phải là chuỗi ký tự' })
  productIds?: string[];
}
