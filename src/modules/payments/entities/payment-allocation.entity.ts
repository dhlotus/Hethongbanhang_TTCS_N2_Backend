/**
 * Entity Phân bổ đối trừ thanh toán hóa đơn (Payment Allocation)
 * Subtask: SN-202 (Parent Story: SN-201 / Sprint 7)
 */

export class PaymentAllocation {
  id: string;
  paymentId: string;
  invoiceId: string;
  invoiceCode: string;
  amount: number;
  previousRemaining: number;
  newRemaining: number;
  allocatedAt: Date;

  constructor(partial: Partial<PaymentAllocation>) {
    Object.assign(this, partial);
  }
}
