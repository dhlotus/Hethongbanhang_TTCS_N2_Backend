import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConfirmDeliveryDto {
  @IsNotEmpty({ message: 'Tên người nhận hàng không được để trống' })
  @IsString({ message: 'Tên người nhận phải là chuỗi ký tự' })
  receiverName: string;

  @IsNotEmpty({ message: 'Thời điểm giao hàng không được để trống' })
  @IsString({ message: 'Thời điểm giao hàng phải là định dạng thời gian' })
  deliveredAt: string;

  @IsOptional()
  @IsString({ message: 'Ảnh chứng từ phải là đường dẫn hoặc chuỗi base64' })
  proofOfDeliveryUrl?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ReportFailedDeliveryDto {
  @IsNotEmpty({ message: 'Lý do giao không thành công không được để trống' })
  @IsString({ message: 'Lý do phải là chuỗi ký tự' })
  failureReason: string;

  @IsOptional()
  @IsString()
  note?: string;
}
