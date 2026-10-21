import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateDeliveryStopItemDto {
  @IsNotEmpty({ message: 'Mã đơn hàng không được để trống' })
  @IsString()
  orderId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateDeliveryTripDto {
  @IsOptional()
  @IsString()
  tripCode?: string;

  @IsNotEmpty({ message: 'Tên chuyến đi không được để trống' })
  @IsString()
  tripName: string;

  @IsNotEmpty({ message: 'Kho xuất phát không được để trống' })
  @IsString()
  warehouseId: string;

  @IsOptional()
  @IsString()
  warehouseName?: string;

  @IsNotEmpty({ message: 'Tên tài xế không được để trống' })
  @IsString()
  driverName: string;

  @IsNotEmpty({ message: 'Số điện thoại tài xế không được để trống' })
  @IsString()
  @Matches(/^0[0-9]{9}$/, {
    message: 'Số điện thoại tài xế phải gồm đúng 10 chữ số và bắt đầu bằng số 0',
  })
  driverPhone: string;

  @IsNotEmpty({ message: 'Biển số xe không được để trống' })
  @IsString()
  vehicleNumber: string;

  @IsOptional()
  @IsString()
  carrierName?: string;

  @IsNotEmpty({ message: 'Thời gian dự kiến hoàn thành không được để trống' })
  @IsDateString({}, { message: 'Thời gian dự kiến hoàn thành phải đúng định dạng ngày giờ ISO' })
  estimatedCompletionTime: string;

  @IsNotEmpty({ message: 'Danh sách đơn hàng cần giao không được để trống' })
  @IsArray({ message: 'Danh sách đơn hàng phải là một mảng' })
  orderIds: string[];

  @IsOptional()
  @IsBoolean()
  startImmediately?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}
