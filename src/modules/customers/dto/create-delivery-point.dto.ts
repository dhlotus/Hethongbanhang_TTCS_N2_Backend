import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO Thêm mới Điểm giao hàng cho Đại lý (SN-31)
 */
export class CreateDeliveryPointDto {
  @IsNotEmpty({ message: 'Tên gợi nhớ điểm giao không được để trống' })
  @IsString({ message: 'Tên gợi nhớ điểm giao phải là chuỗi ký tự' })
  name: string;

  @IsNotEmpty({ message: 'Địa chỉ giao hàng không được để trống' })
  @IsString({ message: 'Địa chỉ giao hàng phải là chuỗi ký tự' })
  address: string;

  @IsNotEmpty({ message: 'Tên người nhận hàng không được để trống' })
  @IsString({ message: 'Tên người nhận phải là chuỗi ký tự' })
  receiverName: string;

  @IsNotEmpty({ message: 'Số điện thoại người nhận không được để trống' })
  @IsString({ message: 'Số điện thoại người nhận phải là chuỗi ký tự' })
  phone: string;

  @IsOptional()
  @IsString({ message: 'Ghi chú đường đi phải là chuỗi ký tự' })
  roadNote?: string;

  @IsOptional()
  @IsString({ message: 'Phường/Xã phải là chuỗi ký tự' })
  ward?: string;

  @IsOptional()
  @IsString({ message: 'Quận/Huyện phải là chuỗi ký tự' })
  district?: string;

  @IsOptional()
  @IsString({ message: 'Tỉnh/Thành phố phải là chuỗi ký tự' })
  province?: string;

  @IsOptional()
  @IsBoolean({ message: 'Cờ mặc định phải là giá trị boolean' })
  isDefault?: boolean;
}
