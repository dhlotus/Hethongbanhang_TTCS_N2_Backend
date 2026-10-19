import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';

export class CreateDebtReconciliationDto {
  @IsNotEmpty({ message: 'Vui lòng chọn đại lý' })
  @IsString()
  agency_id: string;

  @IsNotEmpty({ message: 'Vui lòng chọn kỳ đối chiếu' })
  @IsString()
  period: string; // VD: '2026-10', 'Q3-2026'

  @IsOptional()
  @IsString()
  note?: string;
}

export class QueryDebtReconciliationDto {
  @IsOptional()
  @IsString()
  agency_id?: string;

  @IsOptional()
  @IsString()
  period?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class RespondDebtReconciliationDto {
  @IsNotEmpty({ message: 'Vui lòng chọn phản hồi' })
  @IsIn(['CONFIRMED', 'DISPUTED'], {
    message: 'Trạng thái phản hồi phải là CONFIRMED hoặc DISPUTED',
  })
  status: 'CONFIRMED' | 'DISPUTED';

  @IsOptional()
  @IsString()
  dispute_note?: string;
}
