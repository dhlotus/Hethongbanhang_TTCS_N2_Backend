import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class PriceListItemDto {
  @IsNotEmpty({ message: 'Mã định danh sản phẩm (productId) không được để trống' })
  @IsString()
  productId: string;

  @IsNotEmpty({ message: 'Mã SKU sản phẩm (productCode) không được để trống' })
  @IsString()
  productCode: string;

  @IsNotEmpty({ message: 'Tên sản phẩm (productName) không được để trống' })
  @IsString()
  productName: string;

  @IsNotEmpty({ message: 'Giá bán không được để trống' })
  @IsNumber({}, { message: 'Giá bán phải là định dạng số' })
  @Min(0, { message: 'Giá bán phải lớn hơn hoặc bằng 0' })
  price: number;

  @IsNotEmpty({ message: 'Giá sàn không được để trống' })
  @IsNumber({}, { message: 'Giá sàn phải là định dạng số' })
  @Min(0, { message: 'Giá sàn phải lớn hơn hoặc bằng 0' })
  minPrice: number;

  @IsOptional()
  @IsString()
  baseUnit?: string;
}
