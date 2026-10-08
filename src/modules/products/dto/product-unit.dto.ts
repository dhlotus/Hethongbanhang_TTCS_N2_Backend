import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * DTO Khai báo Đơn vị tính quy đổi của Sản phẩm (SN-23).
 *
 * Fix #1 — Tương thích payload camelCase từ Frontend (product-form-modal.tsx):
 * FE gửi { conversionFactor: N } thay vì { conversionRate: N }.
 *
 * Kiến trúc giải pháp:
 * - Khai báo conversionFactor + conversion_factor là @IsOptional() properties thực
 *   để ValidationPipe(whitelist:true) giữ chúng lại thay vì strip.
 * - conversionRate cũng @IsOptional để không fail khi FE không gửi field này.
 * - @ValidateIf đảm bảo ít nhất 1 trong 3 alias phải hợp lệ (logic check trong service).
 * - Trong service, đọc theo priority: conversionRate > conversionFactor > conversion_factor.
 */
export class ProductUnitDto {
  @IsString({ message: 'Tên đơn vị phải là chuỗi ký tự' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  unitName: string;

  /**
   * Canonical field — dùng khi FE/API gửi đúng tên chuẩn.
   * @IsOptional vì FE có thể gửi alias conversionFactor thay thế.
   */
  @IsOptional()
  @IsNumber({}, { message: 'Hệ số quy đổi (conversionRate) phải là số hợp lệ' })
  @Min(0.0001, { message: 'Hệ số quy đổi phải lớn hơn 0' })
  @Transform(({ value }: { value: unknown }) =>
    value !== undefined && value !== null ? Number(value) : undefined,
  )
  conversionRate?: number;

  /**
   * Alias camelCase từ Frontend (product-form-modal.tsx dòng 441, 450).
   * Không validate Min ở đây — sẽ validate ở service sau khi merge.
   */
  @IsOptional()
  @IsNumber({}, { message: 'conversionFactor phải là số hợp lệ' })
  @Transform(({ value }: { value: unknown }) =>
    value !== undefined && value !== null ? Number(value) : undefined,
  )
  conversionFactor?: number;

  /**
   * Alias snake_case từ import Excel / API bên ngoài.
   */
  @IsOptional()
  @IsNumber({}, { message: 'conversion_factor phải là số hợp lệ' })
  @Transform(({ value }: { value: unknown }) =>
    value !== undefined && value !== null ? Number(value) : undefined,
  )
  // eslint-disable-next-line @typescript-eslint/naming-convention
  conversion_factor?: number;

  @IsOptional()
  @IsBoolean({ message: 'isBaseUnit phải là giá trị boolean' })
  @Transform(({ value, obj }: { value: unknown; obj: Record<string, unknown> }) => {
    if (value !== undefined) return Boolean(value);
    if (obj.is_base_unit !== undefined) return Boolean(obj.is_base_unit);
    return false;
  })
  isBaseUnit?: boolean;

  @IsOptional()
  @IsString({ message: 'Mã vạch đơn vị phải là chuỗi ký tự' })
  barcode?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Giá bán theo đơn vị phải là số' })
  @Min(0, { message: 'Giá bán không được âm' })
  price?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Giá vốn theo đơn vị phải là số' })
  @Min(0, { message: 'Giá vốn không được âm' })
  costPrice?: number;
}
