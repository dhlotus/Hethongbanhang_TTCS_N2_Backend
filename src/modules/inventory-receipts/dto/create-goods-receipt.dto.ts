import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { GoodsReceiptStatus, ReceiptType } from '../entities/goods-receipt.entity';

/**
 * Decorator kiểm tra định dạng UUID hợp lệ (hỗ trợ cả chuẩn RFC v1-v5 và UUID 128-bit hex của PostgreSQL)
 */
export function IsValidUuid(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isUuid',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
        },
      },
    });
  };
}

export class CreateGoodsReceiptItemDto {
  @IsValidUuid({ message: 'productId phải là định dạng UUID hợp lệ' })
  @IsNotEmpty({ message: 'productId không được để trống' })
  productId: string;

  @IsString()
  @IsNotEmpty({ message: 'unitId không được để trống' })
  unitId: string;

  @IsString()
  @IsOptional()
  unitName?: string;

  @IsNumber()
  @Min(0.01)
  packageQuantity: number;

  @IsNumber()
  @Min(0.01)
  conversionFactor: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitCost?: number;

  @IsString()
  @IsOptional()
  batchNumber?: string;

  @IsDateString()
  @IsOptional()
  mfgDate?: string;

  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateGoodsReceiptDto {
  @IsValidUuid({ message: 'warehouseId phải là định dạng UUID hợp lệ' })
  @IsNotEmpty({ message: 'warehouseId không được để trống' })
  warehouseId: string;

  @IsValidUuid({ message: 'supplierId phải là định dạng UUID hợp lệ' })
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  referenceDocument?: string;

  @IsDateString()
  @IsOptional()
  receiptDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiptItemDto)
  items: CreateGoodsReceiptItemDto[];
}
