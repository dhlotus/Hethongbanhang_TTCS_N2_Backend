export enum InvoiceStatus {
  UNPAID = 'UNPAID',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
  DRAFT = 'DRAFT',
  ISSUED = 'ISSUED',
}

export interface InvoiceLineItem {
  productId: string;
  productSku: string;
  productName: string;
  unit: string;
  quantity: number; // Số lượng thực giao làm căn cứ tính tiền hoá đơn
  orderedQuantity?: number; // Số lượng đặt ban đầu (đối chiếu)
  unitPrice: number;
  discountPercent?: number;
  lineTotal: number;
  deliverySlipId?: string;
  deliverySlipCode?: string;
}

export interface InvoicePaymentRecord {
  id: string;
  paymentCode: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: string;
  note?: string;
  recordedBy?: string;
}

export class InvoiceEntity {
  id: string;
  invoiceCode: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  customerEmail?: string;
  salesRepId?: string;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InvoiceStatus;
  issueDate: Date;
  dueDate: Date;
  note?: string;
  deliverySlipIds?: string[];
  deliverySlipCodes?: string[];
  items?: InvoiceLineItem[];
  paymentHistory?: InvoicePaymentRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UnbilledDeliverySlipItem {
  productSku: string;
  productName: string;
  unit: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  unitPrice: number;
  discountPercent: number;
  lineTotal: number;
}

export interface UnbilledDeliverySlip {
  id: string;
  deliveryCode: string;
  trackingNumber?: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  customerCode?: string;
  deliveredAt: Date;
  deliveryAddress?: string;
  receiverName?: string;
  items: UnbilledDeliverySlipItem[];
  totalDeliveredAmount: number;
  totalAmount?: number;
}
