import { StopDeliveryStatus } from './stop-delivery-status.enum';

export interface IDeliveryStopItem {
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

/**
 * Entity Điểm dừng Giao hàng trong Chuyến đi (SN-194 / SN-197)
 */
export class DeliveryStopEntity {
  id: string;
  tripId: string;
  stopOrder: number;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  deliveryAddress: string;
  contactPerson: string;
  contactPhone: string;
  orderAmount: number;
  status: StopDeliveryStatus;
  failureReason?: string;
  deliveredAt?: Date;
  failedAt?: Date;
  proofPhotoUrl?: string;
  notes?: string;
  items?: IDeliveryStopItem[];
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<DeliveryStopEntity>) {
    this.id = partial.id || `stop-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.tripId = partial.tripId || '';
    this.stopOrder = partial.stopOrder || 1;
    this.orderId = partial.orderId || '';
    this.orderCode = partial.orderCode || '';
    this.customerId = partial.customerId || '';
    this.customerName = partial.customerName || '';
    this.deliveryAddress = partial.deliveryAddress || '';
    this.contactPerson = partial.contactPerson || '';
    this.contactPhone = partial.contactPhone || '';
    this.orderAmount = Number(partial.orderAmount) || 0;
    this.status = partial.status || StopDeliveryStatus.PENDING;
    this.failureReason = partial.failureReason;
    this.deliveredAt = partial.deliveredAt ? new Date(partial.deliveredAt) : undefined;
    this.failedAt = partial.failedAt ? new Date(partial.failedAt) : undefined;
    this.proofPhotoUrl = partial.proofPhotoUrl;
    this.notes = partial.notes;
    this.items = partial.items || [];
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
    this.updatedAt = partial.updatedAt ? new Date(partial.updatedAt) : new Date();
  }
}
