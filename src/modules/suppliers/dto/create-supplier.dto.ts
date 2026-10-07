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
  @Matches(/^[0-9]{12}$/, { message: 'Mã số thuế phải bao gồm đúng 12 chữ số' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    const raw = value ?? obj.tax_code;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return raw;
  })
  taxCode?: string;

  @IsOptional()
  @IsString({ message: 'Người liên hệ phải là chuỗi ký tự' })
  @Matches(/^[a-zA-ZÀ-ỹ\s]+$/u, {
    message: 'Tên người liên hệ không được chứa chữ số',
  })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    const raw = value ?? obj.contact_name;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return raw;
  })
  contactName?: string;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @Matches(/^0/, { message: 'Số điện thoại phải bắt đầu bằng số 0' })
  @Matches(/^0[0-9]{9,11}$/, {
    message: 'Số điện thoại phải từ 10 đến 12 chữ số',
  })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    const raw = value ?? obj.contactPhone ?? obj.contact_phone;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return raw;
  })
  phone?: string;

  @IsOptional()
  @IsString({ message: 'Số điện thoại phải là chuỗi ký tự' })
  @Matches(/^0/, { message: 'Số điện thoại phải bắt đầu bằng số 0' })
  @Matches(/^0[0-9]{9,11}$/, {
    message: 'Số điện thoại phải từ 10 đến 12 chữ số',
  })
  contactPhone?: string;

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
