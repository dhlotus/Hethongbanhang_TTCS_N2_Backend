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
  cancelReason?: string;
  isCreditLimitExceeded?: boolean;
  creditLimitExceededAmount?: number;
  approvedAt?: Date;
  approverId?: string;
  processingAt?: Date; // Thời gian bắt đầu soạn hàng (SN-199)
  dispatchedAt?: Date; // Thời gian xuất kho bàn giao vận chuyển (SN-199)
  shippedAt?: Date; // Thời gian xe lăn bánh bắt đầu giao (SN-199)
  deliveredAt?: Date; // Thời gian xe tới giao hàng thành công (SN-199)
  estimatedDeliveryWindow?: string; // Khung giờ dự kiến xe tới (SN-199)
  carrierName?: string; // Đơn vị vận chuyển (SN-199)
  driverName?: string; // Tên tài xế (SN-199)
  driverPhone?: string; // SĐT tài xế (SN-199)
  licensePlate?: string; // Biển số xe tải (SN-199)
  reservedUntil?: Date;
  isShortDelivery?: boolean; // Cờ đánh dấu giao thiếu (SN-170)
  createdSource?: string; // Nguồn tạo đơn (SN-49)
  warehouseId?: string;
  warehouseName?: string;
  warehouseCode?: string;
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
    this.cancelReason = partial.cancelReason;
    this.status = partial.status ?? OrderStatus.DRAFT;
    this.paymentStatus = partial.paymentStatus ?? PaymentStatus.UNPAID;
    this.isCreditLimitExceeded = partial.isCreditLimitExceeded ?? false;
    this.creditLimitExceededAmount = partial.creditLimitExceededAmount ?? 0;
    this.isShortDelivery = partial.isShortDelivery ?? false;
    this.approvedAt = partial.approvedAt ? new Date(partial.approvedAt) : undefined;
    this.processingAt = partial.processingAt ? new Date(partial.processingAt) : undefined;
    this.dispatchedAt = partial.dispatchedAt ? new Date(partial.dispatchedAt) : undefined;
    this.shippedAt = partial.shippedAt ? new Date(partial.shippedAt) : undefined;
    this.deliveredAt = partial.deliveredAt ? new Date(partial.deliveredAt) : undefined;
    this.createdSource = partial.createdSource ?? 'AGENCY_PORTAL';
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
    this.updatedAt = partial.updatedAt ? new Date(partial.updatedAt) : new Date();
  }
}
