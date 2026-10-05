import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ImportProductItemDto {
  @IsNumber()
  row: number;

  @IsString()
  @IsNotEmpty()
  sku: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  baseUnit: string;

  @IsNumber()
  price: number;

  @IsNumber()
  costPrice: number;

  @IsNumber()
  @IsOptional()
  stockQuantity?: number;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  status: 'NEW' | 'UPDATE';

  @IsArray()
  errors: string[];

  @IsBoolean()
  isValid: boolean;
}

export class ConfirmImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportProductItemDto)
  items: ImportProductItemDto[];
}

export interface PreviewImportResult {
  total: number;
  valid: number;
  invalid: number;
  data: ImportProductItemDto[];
}

export interface ConfirmImportResult {
  success: number;
  error: number;
  errorDetails: string[];
}

