import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { SupplierStatus } from '../../../common/enums/supplier-status.enum';

/**
 * DTO Tạo mới Nhà Cung Cấp (SN-25):
 * - Validate chặt chẽ dữ liệu đầu vào
 * - Chuẩn hóa mã NCC (uppercase, không chứa khoảng trắng)
 * - Tự động trích xuất các trường snake_case từ payload (tax_code, contact_name, payment_terms)
 */
export class CreateSupplierDto {
  @IsOptional()
  @IsString({ message: 'Mã nhà cung cấp phải là chuỗi ký tự' })
  @Matches(/^\S+$/, { message: 'Mã nhà cung cấp không được chứa khoảng trắng' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  code?: string;

  @IsNotEmpty({ message: 'Tên nhà cung cấp không được để trống' })
  @IsString({ message: 'Tên nhà cung cấp phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  @IsOptional()
  @IsString({ message: 'Mã số thuế phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value) return typeof value === 'string' ? value.trim() : value;
    if (obj.tax_code) {
      return typeof obj.tax_code === 'string' ? obj.tax_code.trim() : obj.tax_code;
    }
    return value;
  })
  taxCode?: string;

  @IsOptional()
  @IsString({ message: 'Người liên hệ phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value) return typeof value === 'string' ? value.trim() : value;
    if (obj.contact_name) {
      return typeof obj.contact_name === 'string'
        ? obj.contact_name.trim()
        : obj.contact_name;
    }
    return value;
  })
  contactName?: string;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Email không đúng định dạng hợp lệ' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @IsOptional()
  @IsString({ message: 'Địa chỉ phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  address?: string;

  @IsOptional()
  @IsString({ message: 'Điều khoản thanh toán phải là chuỗi ký tự' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value) return typeof value === 'string' ? value.trim() : value;
    if (obj.payment_terms) {
      return typeof obj.payment_terms === 'string'
        ? obj.payment_terms.trim()
        : obj.payment_terms;
    }
    return value;
  })
  paymentTerms?: string;

  @IsOptional()
  @IsEnum(SupplierStatus, {
    message: 'Trạng thái nhà cung cấp phải là ACTIVE hoặc INACTIVE',
  })
  status?: SupplierStatus;

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi ký tự' })
  notes?: string;
}
