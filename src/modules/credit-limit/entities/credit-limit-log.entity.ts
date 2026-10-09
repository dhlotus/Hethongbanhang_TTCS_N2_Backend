/**
 * Entity CreditLimitLog (SN-34)
 * Ghi nhận lịch sử thay đổi: id đại lý, hạn mức cũ/mới, số ngày nợ cũ/mới, lý do thay đổi, người thực hiện, thời gian
 */
export class CreditLimitLog {
  id: string;

  /** ID đại lý */
  agencyId: string;

  /** Mã đại lý */
  agencyCode: string;

  /** Tên đại lý */
  agencyName: string;

  /** Hạn mức tiền tối đa cũ (VND) */
  oldCreditLimit: number;

  /** Hạn mức tiền tối đa mới (VND) */
  newCreditLimit: number;

  /** Số ngày nợ tối đa cũ */
  oldMaxDebtDays: number;

  /** Số ngày nợ tối đa mới */
  newMaxDebtDays: number;

  /** Điều khoản thanh toán cũ */
  oldPaymentTerms?: string;

  /** Điều khoản thanh toán mới */
  newPaymentTerms?: string;

  /** Hạn mức tạm thời cũ */
  oldTemporaryLimit?: number;

  /** Hạn mức tạm thời mới */
  newTemporaryLimit?: number;

  /** Lý do thay đổi hạn mức (BẮT BUỘC) */
  reason: string;

  /** Người thực hiện điều chỉnh */
  performedBy: string;

  /** Vai trò người thực hiện (Kế toán công nợ / Quản lý kinh doanh) */
  performedByRole: string;

  /** Thời gian thực hiện */
  performedAt: Date;

  constructor(partial: Partial<CreditLimitLog>) {
    Object.assign(this, partial);
    this.oldCreditLimit = partial.oldCreditLimit ?? 0;
    this.newCreditLimit = partial.newCreditLimit ?? 0;
    this.oldMaxDebtDays = partial.oldMaxDebtDays ?? 30;
    this.newMaxDebtDays = partial.newMaxDebtDays ?? 30;
    this.performedAt = partial.performedAt ?? new Date();
  }
}

/** Alias phục vụ tương thích ngược */
export { CreditLimitLog as CreditLimitHistoryEntity };
