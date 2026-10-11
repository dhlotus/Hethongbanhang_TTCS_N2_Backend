import { IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

/**
 * DTO Thêm mới Đại lý (SN-35)
 */
export class CreateCustomerDto {
  @IsNotEmpty({ message: 'Mã đại lý không được để trống' })
  @IsString({ message: 'Mã đại lý phải là chuỗi' })
  code: string;

  @IsNotEmpty({ message: 'Tên đại lý không được để trống' })
  @IsString({ message: 'Tên đại lý phải là chuỗi' })
  name: string;

  @IsNotEmpty({ message: 'Khu vực không được để trống' })
  @IsString({ message: 'Khu vực phải là chuỗi' })
  region: string;

  @IsOptional()
  @IsString()
  customerGroup?: string;

  @IsNotEmpty({ message: 'Mã số thuế không được để trống' })
  @IsString({ message: 'Mã số thuế phải là chuỗi' })
  @Matches(/^[0-9]{10}(-[0-9]{3})?$|^[0-9]{13}$/, {
    message: 'Mã số thuế phải gồm 10 chữ số (hoặc 13 chữ số / 10 số kèm mã chi nhánh 3 số, ví dụ 0312345678-001)',
  })
  taxCode: string;

  @IsOptional()
  @IsString()
  salesRepId?: string;

  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @IsString({ message: 'Số điện thoại phải là chuỗi' })
  @Matches(/^0[0-9]{9}$/, {
    message: 'Số điện thoại phải bắt đầu bằng số 0 và bao gồm đúng 10 chữ số',
  })
  phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Hạn mức công nợ phải là số' })
  @Min(0, { message: 'Hạn mức công nợ không được âm' })
  creditLimit?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số ngày nợ tối đa phải là số' })
  @Min(0, { message: 'Số ngày nợ tối đa không được âm' })
  maxDebtDays?: number;

  @IsOptional()
  @IsString()
  salesRepName?: string;

  @IsOptional()
  @IsString()
  deliveryPointName?: string;

  @IsOptional()
  @IsString()
  receiverName?: string;
}

/**
 * DTO Cập nhật thông tin Đại lý (SN-35)
 */
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  customerGroup?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{10}(-[0-9]{3})?$|^[0-9]{13}$/, {
    message: 'Mã số thuế phải gồm 10 chữ số (hoặc 13 chữ số / 10 số kèm mã chi nhánh 3 số, ví dụ 0312345678-001)',
  })
  taxCode?: string;

  @IsOptional()
  @IsString()
  salesRepId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^0[0-9]{9,10}$/, {
    message: 'Số điện thoại phải bắt đầu bằng số 0 và gồm 10 đến 11 chữ số',
  })
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Hạn mức công nợ phải là số' })
  @Min(0, { message: 'Hạn mức công nợ không được âm' })
  creditLimit?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số ngày nợ tối đa phải là số' })
  @Min(0, { message: 'Số ngày nợ tối đa không được âm' })
  maxDebtDays?: number;
}
