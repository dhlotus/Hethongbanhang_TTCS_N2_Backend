import { PaymentMethod } from '../../receipts/entities/receipt.entity';
import { PaymentAllocation } from './payment-allocation.entity';

/**
 * Entity Bút toán thanh toán & Đối trừ công nợ (Payment Entity)
 * Subtask: SN-202 (Parent Story: SN-201 / Sprint 7)
 */

export class Payment {
  id: string;
  code: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentDate: Date;
  collectorId: string;
  collectorName: string;
  collectorUsername?: string;
  note?: string;
  receiptId?: string;
  receiptCode?: string;
  allocations: PaymentAllocation[];
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<Payment>) {
    Object.assign(this, partial);
    if (!this.allocations) {
      this.allocations = [];
    }
  }
}
