import { OrderStatus, PaymentStatus } from './order-status.enum';
import { OrderLineEntity } from './order-line.entity';

/**
 * Thông tin điểm giao hàng gán vào đơn hàng
 */
export interface IOrderDeliveryPoint {
  id?: string;
  name: string;
  address: string;
  receiverName: string;
  phone: string;
  roadNote?: string;
}

/**
 * Thực thể Đơn đặt hàng B2B (SN-38 & SN-39)
 * Bảng orders
 */
export class OrderEntity {
  id: string;
  orderCode: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerGroup?: string;
  salesRepId?: string;
  salesRepName?: string;
  region?: string;
  deliveryPoint?: IOrderDeliveryPoint;
  deliveryDate?: string;
  lines: OrderLineEntity[];
  subtotal: number; // Tổng tiền hàng trước chiết khấu
  totalDiscount: number; // Tổng chiết khấu
  grandTotal: number; // Tổng phải thu = subtotal - totalDiscount
  note?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  priceListId?: string;
  isCustomerLocked?: boolean;
  warningMessage?: string;
  requiresApproval: boolean;
  approvalReasons: string[];
  isCreditLimitExceeded?: boolean;
  creditLimitExceededAmount?: number;
  approvedAt?: Date;
  approverId?: string;
  reservedUntil?: Date;
  cancelReason?: string;
  isShortDelivery?: boolean; // Cờ đánh dấu giao thiếu (SN-170)
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<OrderEntity>) {
    Object.assign(this, partial);
    this.lines = (partial.lines || []).map(
      (l) => (l instanceof OrderLineEntity ? l : new OrderLineEntity(l)),
    );
    this.subtotal = partial.subtotal ?? 0;
    this.totalDiscount = partial.totalDiscount ?? 0;
    this.grandTotal = partial.grandTotal ?? 0;
    this.requiresApproval = partial.requiresApproval ?? false;
    this.approvalReasons = partial.approvalReasons ?? [];
    this.status = partial.status ?? OrderStatus.DRAFT;
    this.paymentStatus = partial.paymentStatus ?? PaymentStatus.UNPAID;
    this.isCreditLimitExceeded = partial.isCreditLimitExceeded ?? false;
    this.creditLimitExceededAmount = partial.creditLimitExceededAmount ?? 0;
    this.isShortDelivery = partial.isShortDelivery;
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();
  }
}
