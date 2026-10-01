import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsNotEmpty({ message: 'Mã SKU không được để trống' })
  @IsString({ message: 'Mã SKU phải là chuỗi ký tự' })
  sku: string;

  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  @IsString({ message: 'Tên sản phẩm phải là chuỗi ký tự' })
  name: string;

  @IsNotEmpty({ message: 'Ngành hàng không được để trống' })
  @IsString({ message: 'Ngành hàng phải là chuỗi ký tự' })
  category: string;

  @IsNotEmpty({ message: 'Đơn vị cơ sở không được để trống' })
  @IsString({ message: 'Đơn vị cơ sở phải là chuỗi ký tự' })
  baseUnit: string;

  @IsNotEmpty({ message: 'Giá bán không được để trống' })
  @IsNumber({}, { message: 'Giá bán phải là số hợp lệ' })
  @Min(0, { message: 'Giá bán không được âm' })
  price: number;

  @IsNotEmpty({ message: 'Giá vốn không được để trống' })
  @IsNumber({}, { message: 'Giá vốn phải là số hợp lệ' })
  @Min(0, { message: 'Giá vốn không được âm' })
  costPrice: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số lượng tồn đầu phải là số' })
  @Min(0, { message: 'Số lượng tồn không được âm' })
  stockQuantity?: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
