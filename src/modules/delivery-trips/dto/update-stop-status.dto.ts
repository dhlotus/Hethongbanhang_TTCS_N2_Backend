import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { StopDeliveryStatus } from '../entities/stop-delivery-status.enum';

export class UpdateStopStatusDto {
  @IsNotEmpty({ message: 'Trạng thái điểm giao không được để trống' })
  @IsEnum(StopDeliveryStatus, { message: 'Trạng thái điểm giao không hợp lệ' })
  status: StopDeliveryStatus;

  @ValidateIf((o) => o.status === StopDeliveryStatus.FAILED)
  @IsNotEmpty({
    message: 'Bắt buộc nhập lý do khi điểm giao hàng không thành công (Hàng vẫn giữ trên xe)',
  })
  @IsString()
  failureReason?: string;

  @IsOptional()
  @IsString()
  proofPhotoUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
