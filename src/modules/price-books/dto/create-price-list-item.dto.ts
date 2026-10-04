import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePriceListItemDto {
  @IsNotEmpty({ message: 'Mã định danh sản phẩm (productId) không được để trống' })
  @IsString()
  productId: string;

  @IsNotEmpty({ message: 'Mã SKU sản phẩm không được để trống' })
  @IsString()
  productCode: string;

  @IsNotEmpty({ message: 'Tên sản phẩm không được để trống' })
  @IsString()
  productName: string;

  @IsNumber({}, { message: 'Giá bán phải là định dạng số' })
  @Min(0, { message: 'Giá bán không được âm' })
  price: number;

  @IsNumber({}, { message: 'Giá sàn (minPrice) phải là định dạng số' })
  @Min(0, { message: 'Giá sàn không được âm' })
  minPrice: number;

  @IsOptional()
  @IsString()
  baseUnit?: string;
}
