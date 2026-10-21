import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { SalesTargetType } from '../entities/sales-target.entity';

export class CreateSalesTargetDto {
  @IsNotEmpty({ message: 'Kỳ chỉ tiêu (tháng) không được để trống' })
  @IsString({ message: 'Kỳ chỉ tiêu phải là chuỗi định dạng YYYY-MM' })
  period: string; // YYYY-MM (vd: 2026-10)

  @IsNotEmpty({ message: 'Loại chỉ tiêu không được để trống' })
  @IsEnum(['EMPLOYEE', 'REGION'], { message: 'Loại chỉ tiêu phải là EMPLOYEE hoặc REGION' })
  targetType: SalesTargetType;

  @IsNotEmpty({ message: 'Đối tượng chỉ tiêu không được để trống' })
  @IsString()
  targetId: string;

  @IsNotEmpty({ message: 'Tên đối tượng không được để trống' })
  @IsString()
  targetName: string;

  @IsNotEmpty({ message: 'Mức chỉ tiêu không được để trống' })
  @IsNumber({}, { message: 'Mức chỉ tiêu phải là số' })
  @Min(0, { message: 'Mức chỉ tiêu không được âm' })
  targetAmount: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateSalesTargetDto {
  @IsNotEmpty({ message: 'Mức chỉ tiêu không được để trống' })
  @IsNumber({}, { message: 'Mức chỉ tiêu phải là số' })
  @Min(0, { message: 'Mức chỉ tiêu không được âm' })
  targetAmount: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  reason?: string; // Bắt buộc nếu kỳ đã bị khóa (period < current)
}

export class QuerySalesTargetDto {
  @IsOptional()
  @IsString()
  period?: string; // YYYY-MM

  @IsOptional()
  @IsEnum(['EMPLOYEE', 'REGION'])
  targetType?: SalesTargetType;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
