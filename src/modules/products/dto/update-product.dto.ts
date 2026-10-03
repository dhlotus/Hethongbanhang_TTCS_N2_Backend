import { PartialType } from '@nestjs/mapped-types';
import { CreateProductDto } from './create-product.dto';

/**
 * DTO Cập nhật Sản phẩm / SKU (SN-138):
 * - Kế thừa PartialType(CreateProductDto)
 * - Cho phép cập nhật từng phần thông tin SKU, giá, trạng thái, danh mục
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {}
