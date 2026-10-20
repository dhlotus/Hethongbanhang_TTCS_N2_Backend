import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePickingSheetDto {
  @IsArray({ message: 'Danh sách đơn hàng phải là một mảng' })
  @ArrayNotEmpty({ message: 'Vui lòng chọn ít nhất 1 đơn hàng để tạo lượt soạn hàng' })
  @IsString({ each: true, message: 'ID đơn hàng phải là chuỗi ký tự' })
  selectedOrderIds: string[];

  @IsString({ message: 'Mã định danh kho hàng không được để trống' })
  @IsNotEmpty({ message: 'Vui lòng chọn kho hàng tác nghiệp' })
  warehouseId: string;

  @IsOptional()
  @IsString()
  warehouseCode?: string;

  @IsOptional()
  @IsString()
  warehouseName?: string;

  @IsOptional()
  @IsString()
  pickerName?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
