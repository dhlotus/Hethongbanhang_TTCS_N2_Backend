import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrderStatus } from '../entities/order-status.enum';

/**
 * DTO Thông tin điểm giao hàng trong đơn
 */
export class DeliveryPointInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsNotEmpty({ message: 'Địa chỉ giao hàng không được để trống' })
  @IsString()
  address: string;

  @IsOptional()
  @IsString()
  receiverName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  roadNote?: string;
}

/**
 * DTO cho một dòng hàng trong đơn (SN-38)
 */
export class CreateOrderLineDto {
  @IsNotEmpty({ message: 'ID sản phẩm không được để trống' })
  @IsString()
  productId: string;

  @IsNotEmpty({ message: 'Mã SKU không được để trống' })
  @IsString()
  productSku: string;

  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  @IsString()
  productName: string;

  @IsNotEmpty({ message: 'Đơn vị gọi hàng không được để trống' })
  @IsString()
  unit: string;

  @IsNotEmpty({ message: 'Đơn vị cơ sở không được để trống' })
  @IsString()
  baseUnit: string;

  @IsNumber({}, { message: 'Hệ số quy đổi phải là số' })
  @Min(1, { message: 'Hệ số quy đổi phải ≥ 1' })
  conversionRate: number;

  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1, { message: 'Số lượng phải ≥ 1' })
  quantity: number;

  @IsOptional()
  @IsNumber({}, { message: 'Đơn giá phải là số' })
  @Min(0, { message: 'Đơn giá không được âm' })
  unitPrice?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giá niêm yết phải là số' })
  @Min(0, { message: 'Giá niêm yết không được âm' })
  listPrice?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Chiết khấu phải là số' })
  @Min(0)
  discountPercent?: number;

  @IsOptional()
  @IsBoolean()
  isPriceManuallyEdited?: boolean;

  @IsOptional()
  @IsNumber()
  stockAvailable?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số lượng thực giao phải là số' })
  @Min(0, { message: 'Số lượng thực giao không được âm' })
  deliveredQuantity?: number;

  @IsOptional()
  @IsString()
  shortDeliveryReason?: string;
}

/**
 * DTO cho sản phẩm đặt hàng từ Agency Portal
 */
export class CreateOrderItemDto {
  @IsNotEmpty({ message: 'ID sản phẩm không được để trống' })
  @IsString()
  productId: string;

  @IsNumber({}, { message: 'Số lượng phải là số' })
  @Min(1, { message: 'Số lượng phải ≥ 1' })
  quantity: number;

  @IsOptional()
  @IsNumber({}, { message: 'Đơn giá phải là số' })
  @Min(0, { message: 'Đơn giá không được âm' })
  price?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Chiết khấu phải là số' })
  @Min(0)
  discountPercent?: number;

  @IsOptional()
  @IsString()
  unit?: string;
}

/**
 * DTO tạo đơn hàng mới (SN-38 & SN-39)
 */
export class CreateOrderDto {
  @IsNotEmpty({ message: 'ID đại lý không được để trống' })
  @IsString()
  customerId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryPointInputDto)
  deliveryPoint?: DeliveryPointInputDto;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @IsArray({ message: 'Danh sách dòng hàng phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines?: CreateOrderLineDto[];

  @IsOptional()
  @IsArray({ message: 'Danh sách sản phẩm phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items?: CreateOrderItemDto[];

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  priceListId?: string;

  @IsOptional()
  @IsEnum(OrderStatus, { message: 'Trạng thái đơn hàng không hợp lệ' })
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  salesRepId?: string;

  @IsOptional()
  @IsString()
  salesRepName?: string;

  @IsOptional()
  @IsString()
  createdSource?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  warehouseName?: string;
}

/**
 * DTO chi tiết dòng hàng khi cập nhật giao nhận
 */
export class UpdateOrderLineDeliveryDto {
  @IsOptional()
  @IsString()
  lineId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  dispatchedQuantity?: number;

  @IsOptional()
  deliveredQuantity?: number;

  @IsOptional()
  isShortDelivery?: boolean;

  @IsOptional()
  @IsString()
  shortDeliveryReason?: string;
}

/**
 * DTO cập nhật trạng thái đơn hàng
 */
export class UpdateOrderStatusDto {
  @IsNotEmpty({ message: 'Trạng thái không được để trống' })
  @IsEnum(OrderStatus, { message: 'Trạng thái đơn hàng không hợp lệ' })
  status: OrderStatus;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  lines?: UpdateOrderLineDeliveryDto[];

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  licensePlate?: string;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsOptional()
  @IsString()
  estimatedDeliveryWindow?: string;
}

/**
 * DTO đặt lại dòng hàng (Re-order item - SN-174)
 */
export class ReorderLineItemDto {
  @IsNotEmpty({ message: 'Mã SKU không được để trống' })
  @IsString()
  productSku: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsInt({ message: 'Số lượng đặt lại phải là số nguyên' })
  @Min(1, { message: 'Số lượng đặt lại phải ≥ 1' })
  quantity: number;

  @IsOptional()
  @IsString()
  unit?: string;
}

/**
 * DTO đặt lại đơn hàng cũ (Re-order - SN-174)
 */
export class ReorderDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderLineItemDto)
  items?: ReorderLineItemDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedLineIds?: string[];

  @IsOptional()
  @IsString()
  deliveryDate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryPointInputDto)
  deliveryPoint?: DeliveryPointInputDto;

  @IsOptional()
  @IsString()
  note?: string;
}

