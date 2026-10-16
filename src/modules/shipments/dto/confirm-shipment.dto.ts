import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ConfirmShipmentLineDto {
  @IsNotEmpty({ message: 'ID dòng hàng không được để trống' })
  @IsString({ message: 'ID dòng hàng phải là chuỗi ký tự' })
  orderLineId: string;

  @IsNotEmpty({ message: 'Số lượng thực xuất không được để trống' })
  @IsNumber({}, { message: 'Số lượng thực xuất phải là số' })
  @Min(0, { message: 'Số lượng thực xuất không được âm' })
  shippedQuantity: number;

  @IsOptional()
  @IsString({ message: 'Lý do giao thiếu phải là chuỗi ký tự' })
  shortDeliveryReason?: string;
}

export class ConfirmShipmentDto {
  @IsOptional()
  @IsArray({ message: 'Danh sách dòng hàng thực xuất phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => ConfirmShipmentLineDto)
  lines?: ConfirmShipmentLineDto[];

  @IsOptional()
  @IsString({ message: 'Đơn vị vận chuyển phải là chuỗi ký tự' })
  carrierName?: string;

  @IsOptional()
  @IsString({ message: 'Mã vận đơn phải là chuỗi ký tự' })
  trackingNumber?: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú xác nhận xuất kho' })
  note?: string;
}
