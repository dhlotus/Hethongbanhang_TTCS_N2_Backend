import { CreditStatus } from '../enums/credit-status.enum';

/**
 * Entity Hạn mức Công nợ Đại lý (SN-34)
 * Quản lý thông tin đại lý, hạn mức tiền tối đa và số ngày nợ tối đa
 */
export class AgencyCreditLimit {
  id: string;
  agencyId: string;
  agencyCode: string;
  agencyName: string;
  customerGroup: string;
  phone: string;
  email?: string;
  region?: string;
  salesRepId?: string;
  salesRepName?: string;

  /** Hạn mức tiền nợ tối đa (VND) */
  creditLimit: number;

  /** Số ngày nợ tối đa cho phép */
  maxDebtDays: number;

  /** Dư nợ hiện hành của đại lý (VND) */
  currentDebt: number;

  /** Hạn mức tín dụng khả dụng còn lại (VND) */
  availableCredit: number;

  /** Tỷ lệ sử dụng hạn mức công nợ (%) */
  debtUsagePercentage: number;

  /** Điều khoản thanh toán (NET_30, NET_45, COD...) */
  paymentTerms: string;

  /** Hạn mức cấp thêm tạm thời (Mùa vụ) */
  temporaryCreditLimit: number;

  /** Ngày hết hạn của hạn mức tạm thời */
  temporaryLimitExpiry?: Date;

  /** Cho phép đặt đơn hàng vượt hạn mức khi có duyệt đơn */
  allowOverLimitOrder: boolean;

  /** Trạng thái hạn mức tín dụng */
  status: CreditStatus;

  /** Lý do khóa hạn mức (nếu bị khóa) */
  lockReason?: string;

  /** Thời điểm điều chỉnh gần nhất */
  lastAdjustedAt?: Date;

  /** Người thực hiện điều chỉnh gần nhất */
  lastAdjustedBy?: string;

  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<AgencyCreditLimit>) {
    Object.assign(this, partial);
    this.creditLimit = partial.creditLimit ?? 0;
    this.maxDebtDays = partial.maxDebtDays ?? 30;
    this.currentDebt = partial.currentDebt ?? 0;
    this.paymentTerms = partial.paymentTerms ?? 'NET_30';
    this.temporaryCreditLimit = partial.temporaryCreditLimit ?? 0;
    this.allowOverLimitOrder = partial.allowOverLimitOrder ?? false;
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();

    const effectiveLimit = this.creditLimit + this.temporaryCreditLimit;
    this.availableCredit = Math.max(0, effectiveLimit - this.currentDebt);

    this.debtUsagePercentage =
      effectiveLimit > 0
        ? Math.round((this.currentDebt / effectiveLimit) * 10000) / 100
        : this.currentDebt > 0
          ? 100
          : 0;

    if (partial.status === CreditStatus.BLOCKED) {
      this.status = CreditStatus.BLOCKED;
    } else if (this.currentDebt > effectiveLimit && effectiveLimit > 0) {
      this.status = CreditStatus.EXCEEDED;
    } else if (this.debtUsagePercentage >= 80) {
      this.status = CreditStatus.WARNING;
    } else {
      this.status = CreditStatus.NORMAL;
    }
  }
}

/** Alias phục vụ tương thích ngược */
export { AgencyCreditLimit as CreditLimitEntity };
