import { IsEnum, IsNotEmpty } from 'class-validator';
import { SupplierStatus } from '../../../common/enums/supplier-status.enum';

/**
 * DTO Chuyển đổi trạng thái Nhà Cung Cấp (SN-25)
 */
export class UpdateSupplierStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  @IsEnum(SupplierStatus, {
    message: 'Trạng thái nhà cung cấp phải là ACTIVE hoặc INACTIVE',
  })
  status: SupplierStatus;
}
