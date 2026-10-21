import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TripCheckinReturnDto {
  @IsNotEmpty({
    message: 'Bắt buộc xác nhận kiểm đếm đối soát hàng chưa giao để nhập lại kho',
  })
  @IsBoolean()
  confirmReturnAllFailedGoods: boolean;

  @IsOptional()
  @IsString()
  returnedNotes?: string;
}
