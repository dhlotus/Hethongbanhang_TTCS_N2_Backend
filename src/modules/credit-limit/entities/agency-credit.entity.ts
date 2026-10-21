import { AgencyCreditFlag, CreditEnforcementMode } from '../dto/credit-config.dto';
import { CreditStatus } from '../enums/credit-status.enum';

/**
 * Thực thể Quản lý Cảnh báo và Trạng thái Công nợ Đại lý (SN-204)
 * Bảng app_agency_credits
 */
export class AgencyCreditEntity {
  id: string;
  agencyId: string;
  agencyCode: string;
  agencyName: string;

  /** Hạn mức tiền nợ cho phép (VND) */
  creditLimit: number;

  /** Dư nợ hiện hành của đại lý (VND) */
  currentDebt: number;

  /** Số tiền vượt hạn mức (nếu có) */
  overLimitAmount: number;

  /** Số ngày nợ tối đa cho phép */
  maxDebtDays: number;

  /** Số ngày nợ lâu nhất trong các hóa đơn chưa trả */
  oldestDebtDays: number;

  /** Số ngày quá hạn lớn nhất */
  overdueDays: number;

  /** Tổng số tiền nợ đã quá hạn (VND) */
  overdueAmount: number;

  /** Đại lý có đang bị gắn cờ cảnh báo / vi phạm hay không */
  isFlagged: boolean;

  /** Phân loại cờ cảnh báo */
  flagType: AgencyCreditFlag;

  /** Danh sách lý do chi tiết gắn cờ */
  flagReasons: string[];

  /** Thời điểm bắt đầu bị gắn cờ */
  flaggedAt?: Date;

  /** Trạng thái hạn mức tín dụng chung */
  status: CreditStatus;

  /** Chế độ xử lý áp dụng tại thời điểm đánh giá */
  enforcementMode: CreditEnforcementMode;

  /** Thời điểm đánh giá lại gần nhất */
  lastEvaluatedAt: Date;

  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<AgencyCreditEntity>) {
    Object.assign(this, partial);
    this.creditLimit = partial.creditLimit ?? 0;
    this.currentDebt = partial.currentDebt ?? 0;
    this.overLimitAmount = partial.overLimitAmount ?? 0;
    this.maxDebtDays = partial.maxDebtDays ?? 30;
    this.oldestDebtDays = partial.oldestDebtDays ?? 0;
    this.overdueDays = partial.overdueDays ?? 0;
    this.overdueAmount = partial.overdueAmount ?? 0;
    this.isFlagged = partial.isFlagged ?? false;
    this.flagType = partial.flagType ?? AgencyCreditFlag.CLEAR;
    this.flagReasons = partial.flagReasons ?? [];
    this.status = partial.status ?? CreditStatus.NORMAL;
    this.enforcementMode =
      partial.enforcementMode ?? CreditEnforcementMode.BLOCK_ORDER;
    this.lastEvaluatedAt = partial.lastEvaluatedAt ?? new Date();
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();
  }
}
