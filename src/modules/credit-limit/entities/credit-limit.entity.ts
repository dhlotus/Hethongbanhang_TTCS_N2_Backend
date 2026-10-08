import { CreditStatus } from '../enums/credit-status.enum';

/**
 * Thực thể Hạn mức Công nợ Đại lý (SN-34)
 */
export class CreditLimitEntity {
  id: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerGroup: string;
  phone: string;
  email?: string;
  region?: string;
  salesRepId?: string;
  salesRepName?: string;
  creditLimit: number;
  currentDebt: number;
  availableCredit: number;
  debtUsagePercentage: number;
  maxDebtDays: number;
  paymentTerms: string;
  temporaryCreditLimit: number;
  temporaryLimitExpiry?: Date;
  allowOverLimitOrder: boolean;
  status: CreditStatus;
  lockReason?: string;
  lastAdjustedAt?: Date;
  lastAdjustedBy?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<CreditLimitEntity>) {
    Object.assign(this, partial);
    this.creditLimit = partial.creditLimit ?? 0;
    this.currentDebt = partial.currentDebt ?? 0;
    this.maxDebtDays = partial.maxDebtDays ?? 30;
    this.paymentTerms = partial.paymentTerms ?? 'NET_30';
    this.temporaryCreditLimit = partial.temporaryCreditLimit ?? 0;
    this.allowOverLimitOrder = partial.allowOverLimitOrder ?? false;
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();

    // Tính toán hạn mức khả dụng = max(0, creditLimit + temporaryCreditLimit - currentDebt)
    const effectiveLimit = this.creditLimit + this.temporaryCreditLimit;
    this.availableCredit = Math.max(0, effectiveLimit - this.currentDebt);

    // Tính phần trăm sử dụng hạn mức
    this.debtUsagePercentage =
      effectiveLimit > 0
        ? Math.round((this.currentDebt / effectiveLimit) * 10000) / 100
        : this.currentDebt > 0
          ? 100
          : 0;

    // Tự động xác định trạng thái nếu chưa có hoặc nếu không bị khóa thủ công
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
