/**
 * Thực thể Lịch sử Điều chỉnh Hạn mức Công nợ (SN-34)
 */
export class CreditLimitHistoryEntity {
  id: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  oldCreditLimit: number;
  newCreditLimit: number;
  oldMaxDebtDays: number;
  newMaxDebtDays: number;
  oldPaymentTerms: string;
  newPaymentTerms: string;
  oldTemporaryLimit: number;
  newTemporaryLimit: number;
  reason: string;
  adjustedBy: string;
  adjustedRole: string;
  createdAt: Date;

  constructor(partial: Partial<CreditLimitHistoryEntity>) {
    Object.assign(this, partial);
    this.oldCreditLimit = partial.oldCreditLimit ?? 0;
    this.newCreditLimit = partial.newCreditLimit ?? 0;
    this.oldMaxDebtDays = partial.oldMaxDebtDays ?? 30;
    this.newMaxDebtDays = partial.newMaxDebtDays ?? 30;
    this.oldPaymentTerms = partial.oldPaymentTerms ?? 'NET_30';
    this.newPaymentTerms = partial.newPaymentTerms ?? 'NET_30';
    this.oldTemporaryLimit = partial.oldTemporaryLimit ?? 0;
    this.newTemporaryLimit = partial.newTemporaryLimit ?? 0;
    this.createdAt = partial.createdAt ?? new Date();
  }
}
