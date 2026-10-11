import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ConfirmTransferItemDto {
  @IsNotEmpty({ message: 'ID dòng mặt hàng không được để trống' })
  @IsString()
  itemId: string;

  @IsNotEmpty({ message: 'Số lượng thực nhận không được để trống' })
  @IsNumber({}, { message: 'Số lượng thực nhận phải là số' })
  @Min(0, { message: 'Số lượng thực nhận không được âm' })
  receivedQuantity: number;

  /**
   * Bắt buộc nếu có chênh lệch giữa số lượng chuyển và số lượng thực nhận
   */
  @IsOptional()
  @IsString()
  discrepancyReason?: string;
}

export class ConfirmTransferReceiptDto {
  @IsArray({ message: 'Danh sách kiểm đếm nhận hàng phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => ConfirmTransferItemDto)
  items: ConfirmTransferItemDto[];

  /**
   * Lý do chênh lệch chung của toàn bộ phiếu nếu có sai lệch
   */
  @IsOptional()
  @IsString()
  generalDiscrepancyReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
