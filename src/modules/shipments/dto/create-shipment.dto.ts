import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min, ValidateNested } from 'class-validator';

export class CreateShipmentLineDto {
  @IsNotEmpty({ message: 'ID dòng hàng không được để trống' })
  @IsString()
  orderLineId: string;

  @IsNotEmpty({ message: 'Mã SKU không được để trống' })
  @IsString()
  productSku: string;

  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  @IsString()
  productName: string;

  @IsOptional()
  @IsString()
  unitName?: string;

  @IsOptional()
  @IsNumber()
  conversionRate?: number;

  @IsNotEmpty({ message: 'Số lượng đặt không được để trống' })
  @IsNumber()
  @Min(1, { message: 'Số lượng đặt phải lớn hơn 0' })
  orderedQuantity: number;
}

export class CreateShipmentDto {
  @IsNotEmpty({ message: 'ID đơn hàng không được để trống' })
  @IsString()
  orderId: string;

  @IsNotEmpty({ message: 'Mã đơn hàng không được để trống' })
  @IsString()
  orderCode: string;

  @IsNotEmpty({ message: 'ID khách hàng không được để trống' })
  @IsString()
  customerId: string;

  @IsNotEmpty({ message: 'Tên khách hàng / Đại lý không được để trống' })
  @IsString()
  customerName: string;

  @IsOptional()
  @IsString()
  salesRepId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  receiverName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^0[0-9]{9}$/, { message: 'Số điện thoại phải gồm đúng 10 chữ số và bắt đầu bằng số 0' })
  phone?: string;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateShipmentLineDto)
  lines?: CreateShipmentLineDto[];
}
