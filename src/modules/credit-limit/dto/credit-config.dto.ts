import { IsBoolean, IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Chế độ xử lý đơn hàng khi đại lý bị gắn cờ công nợ (SN-204)
 */
export enum CreditEnforcementMode {
  /** Chặn tuyệt đối không cho tạo đơn mới (Báo lỗi) */
  BLOCK_ORDER = 'BLOCK_ORDER',
  /** Cho phép tạo đơn nhưng bắt buộc chuyển trạng thái đơn sang Cần duyệt */
  REQUIRE_APPROVAL = 'REQUIRE_APPROVAL',
}

/**
 * Loại cờ cảnh báo công nợ đại lý (SN-204)
 */
export enum AgencyCreditFlag {
  /** Không bị gắn cờ / Công nợ trong ngưỡng an toàn */
  CLEAR = 'CLEAR',
  /** Vượt hạn mức tiền nợ cho phép */
  EXCEEDED_LIMIT = 'EXCEEDED_LIMIT',
  /** Có khoản nợ quá số ngày cho phép */
  OVERDUE = 'OVERDUE',
  /** Cả hai: Vừa vượt hạn mức tiền vừa có nợ quá hạn */
  EXCEEDED_AND_OVERDUE = 'EXCEEDED_AND_OVERDUE',
}

/**
 * DTO cập nhật cấu hình kiểm soát công nợ toàn hệ thống (SN-204)
 */
export class UpdateCreditConfigDto {
  @IsEnum(CreditEnforcementMode, {
    message: 'Chế độ xử lý phải là BLOCK_ORDER hoặc REQUIRE_APPROVAL',
  })
  enforcementMode: CreditEnforcementMode;

  @IsOptional()
  @IsBoolean()
  autoFlaggingEnabled?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'Tỷ lệ cảnh báo phải là số' })
  @Min(0, { message: 'Tỷ lệ cảnh báo tối thiểu 0%' })
  @Max(100, { message: 'Tỷ lệ cảnh báo tối đa 100%' })
  warningThresholdPercentage?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Số ngày gia hạn phải là số' })
  @Min(0, { message: 'Số ngày gia hạn không được âm' })
  gracePeriodDays?: number;
}

/**
 * DTO dữ liệu cấu hình hệ thống trả về
 */
export class CreditConfigDto {
  enforcementMode: CreditEnforcementMode;
  autoFlaggingEnabled: boolean;
  warningThresholdPercentage: number;
  gracePeriodDays: number;
  updatedAt: Date;
  updatedBy?: string;
}

/**
 * Kết quả đánh giá trạng thái công nợ của một đại lý
 */
export interface AgencyCreditEvaluationResult {
  agencyId: string;
  agencyCode: string;
  agencyName: string;
  isFlagged: boolean;
  flagType: AgencyCreditFlag;
  currentDebt: number;
  creditLimit: number;
  overLimitAmount: number;
  maxDebtDays: number;
  oldestDebtDays: number;
  overdueDays: number;
  overdueAmount: number;
  reasons: string[];
  enforcementMode: CreditEnforcementMode;
  canCreateOrder: boolean;
  requiresApproval: boolean;
  evaluatedAt: Date;
}
