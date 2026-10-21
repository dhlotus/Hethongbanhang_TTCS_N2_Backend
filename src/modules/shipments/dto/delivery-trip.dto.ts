import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { DeliveryTripStatus } from '../entities/delivery-trip.entity';

/**
 * SN-196: DTO tạo chuyến giao hàng mới gom nhiều phiếu xuất
 */
export class CreateDeliveryTripDto {
  @IsOptional()
  @IsString()
  tripCode?: string;

  @IsNotEmpty({ message: 'Tên chuyến giao không được để trống' })
  @IsString({ message: 'Tên chuyến giao phải là chuỗi ký tự' })
  name: string;

  @IsNotEmpty({ message: 'Khu vực / Tuyến giao không được để trống' })
  @IsString({ message: 'Khu vực / Tuyến giao phải là chuỗi ký tự' })
  routeArea: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  warehouseName?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  departureDate?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsArray({ message: 'Danh sách phiếu xuất gom vào chuyến phải là mảng chuỗi ID' })
  @IsNotEmpty({ message: 'Chuyến giao phải có ít nhất 1 phiếu xuất kho' })
  shipmentIds: string[];
}

/**
 * SN-196: DTO cập nhật chuyến giao hàng
 */
export class UpdateDeliveryTripDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  routeArea?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverPhone?: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  departureDate?: string;

  @IsOptional()
  @IsEnum(DeliveryTripStatus)
  status?: DeliveryTripStatus;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsArray()
  shipmentIds?: string[];
}

/**
 * SN-196: DTO gán tài xế và phương tiện cho chuyến
 */
export class AssignDriverDto {
  @IsNotEmpty({ message: 'Tên tài xế không được để trống' })
  @IsString()
  driverName: string;

  @IsNotEmpty({ message: 'Số điện thoại tài xế không được để trống' })
  @IsString()
  driverPhone: string;

  @IsNotEmpty({ message: 'Biển số xe không được để trống' })
  @IsString()
  vehicleNumber: string;

  @IsOptional()
  @IsString()
  vehicleType?: string;
}
