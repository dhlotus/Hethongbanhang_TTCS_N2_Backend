/**
 * Entity Phiếu thu tiền (Receipt / Payment Voucher)
 * Subtask: SN-209 (Parent Story: SN-201 / Sprint 7)
 */

export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  CREDIT_CARD = 'CREDIT_CARD',
  CHECK = 'CHECK',
}

export enum ReceiptStatus {
  CONFIRMED = 'CONFIRMED',
  PENDING = 'PENDING',
  CANCELLED = 'CANCELLED',
}

export interface CustomerInfo {
  id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
}

export interface CollectorInfo {
  id: string;
  username: string;
  fullName: string;
  role?: string;
}

export class Receipt {
  id: string;
  code: string; // Mã phiếu thu duy nhất (Unique)
  customerId: string;
  customerCode: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  amount: number;
  amountInWords: string;
  paymentMethod: PaymentMethod;
  paymentDate: Date;
  referenceCode?: string; // Hóa đơn hoặc hợp đồng liên kết
  notes?: string;
  status: ReceiptStatus;
  collectorId: string;
  collectorName: string;
  collectorUsername?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<Receipt>) {
    Object.assign(this, partial);
  }
}
