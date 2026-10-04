import { PartialType } from '@nestjs/mapped-types';
import { CreateSupplierDto } from './create-supplier.dto';

/**
 * DTO Cập nhật Nhà Cung Cấp (SN-25):
 * - Kế thừa PartialType(CreateSupplierDto)
 * - Cho phép cập nhật từng phần thông tin nhà cung cấp
 */
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}
