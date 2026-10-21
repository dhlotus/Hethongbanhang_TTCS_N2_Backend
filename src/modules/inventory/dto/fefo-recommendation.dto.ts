import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query lấy danh sách gợi ý lô theo nguyên tắc FEFO (First Expired, First Out)
 */
export class QueryFefoRecommendationDto {
  @IsNotEmpty({ message: 'warehouseId không được để trống' })
  @IsString()
  warehouseId: string;

  @IsNotEmpty({ message: 'productId không được để trống' })
  @IsString()
  productId: string;

  @IsNotEmpty({ message: 'requiredQuantity không được để trống' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'Số lượng yêu cầu phải lớn hơn 0' })
  requiredQuantity: number;
}

/**
 * Đơn vị phân bổ lô trong đơn xuất kho
 */
export class BatchDispatchItemDto {
  @IsNotEmpty({ message: 'batchId không được để trống' })
  @IsString()
  batchId: string;

  @IsNotEmpty({ message: 'batchNumber không được để trống' })
  @IsString()
  batchNumber: string;

  @IsNotEmpty({ message: 'quantity không được để trống' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01, { message: 'Số lượng phải lớn hơn 0' })
  quantity: number;
}

/**
 * Payload xác nhận xuất kho theo Lô đã chọn (SN-187)
 */
export class ConfirmFefoDispatchDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsNotEmpty({ message: 'warehouseId không được để trống' })
  @IsString()
  warehouseId: string;

  @IsNotEmpty({ message: 'productId không được để trống' })
  @IsString()
  productId: string;

  @IsArray({ message: 'selectedBatches phải là mảng các lô được chọn' })
  @ValidateNested({ each: true })
  @Type(() => BatchDispatchItemDto)
  selectedBatches: BatchDispatchItemDto[];

  @IsBoolean()
  isOverride: boolean;

  @IsOptional()
  @IsString()
  overrideReason?: string;

  @IsOptional()
  @IsString()
  overrideReasonCode?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Thông tin chi tiết một Lô hàng phục vụ FEFO
 */
export interface FefoBatchDetail {
  id: string;
  batchNumber: string;
  productId: string;
  productName?: string;
  warehouseId: string;
  locationId?: string;
  locationCode?: string;
  mfgDate: string;
  expiryDate: string;
  daysUntilExpiry: number;
  expiryStatus: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'GOOD';
  availableQuantity: number;
  allocatedQuantity: number;
  costPrice: number;
  suggestedQuantity: number;
  isFefoRecommended: boolean;
}

/**
 * Kết quả gợi ý xuất lô FEFO
 */
export interface FefoRecommendationResult {
  productId: string;
  warehouseId: string;
  requiredQuantity: number;
  totalSuggestedQuantity: number;
  isFullySatisfied: boolean;
  batches: FefoBatchDetail[];
}
