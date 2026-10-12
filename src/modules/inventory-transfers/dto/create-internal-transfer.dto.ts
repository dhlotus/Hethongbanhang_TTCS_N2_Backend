import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CreateTransferItemDto {
  @IsNotEmpty({ message: 'Mã hoặc ID sản phẩm không được để trống' })
  @IsString()
  productId: string;

  @IsNotEmpty({ message: 'Đơn vị tính không được để trống' })
  @IsString()
  unit: string;

  @IsNotEmpty({ message: 'Số lượng chuyển không được để trống' })
  @IsNumber({}, { message: 'Số lượng chuyển phải là số' })
  @IsPositive({ message: 'Số lượng chuyển phải lớn hơn 0' })
  transferQuantity: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInternalTransferDto {
  @IsNotEmpty({ message: 'Kho đi không được để trống' })
  @IsString()
  fromWarehouseId: string;

  @IsNotEmpty({ message: 'Kho đến không được để trống' })
  @IsString()
  toWarehouseId: string;

  @IsArray({ message: 'Danh sách mặt hàng phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => CreateTransferItemDto)
  items: CreateTransferItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  /**
   * Lưu dưới dạng bản nháp (DRAFT) hay xuất kho ngay (IN_TRANSIT)
   * Mặc định: false (xuất ngay sang IN_TRANSIT)
   */
  @IsOptional()
  @IsBoolean()
  isDraft?: boolean;
}
