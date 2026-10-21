import { ShipmentLineEntity } from './shipment-line.entity';

export type ShipmentStatus = 'PENDING' | 'PICKING' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

/**
 * Thực thể Phiếu xuất kho & Giao hàng (Shipment Entity) - SN-195
 */
export class ShipmentEntity {
  id: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  salesRepId?: string;
  warehouseId?: string;
  warehouseName?: string;
  status: ShipmentStatus;
  isConfirmed?: boolean;
  confirmedAt?: Date;
  confirmedBy?: string;
  deliveryAddress?: string;
  receiverName?: string;
  phone?: string;
  trackingNumber?: string;
  carrierName?: string;
  shippingCarrier?: string;
  proofOfDeliveryUrl?: string;
  deliveryNote?: string;
  failureReason?: string;
  tripId?: string;
  tripCode?: string;
  items?: any[];
  invoiceId?: string;
  invoiceCode?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  lines: ShipmentLineEntity[];
  hasShortDelivery: boolean;
  note?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial?: Partial<ShipmentEntity>) {
    this.id = partial?.id || `shp-${Date.now()}`;
    this.orderId = partial?.orderId || '';
    this.orderCode = partial?.orderCode || '';
    this.customerId = partial?.customerId || '';
    this.customerName = partial?.customerName || '';
    this.salesRepId = partial?.salesRepId;
    this.warehouseId = partial?.warehouseId || 'wh-001';
    this.warehouseName = partial?.warehouseName;
    this.status = partial?.status || 'PICKING';
    this.isConfirmed = partial?.isConfirmed !== undefined ? Boolean(partial.isConfirmed) : false;
    this.confirmedAt = partial?.confirmedAt ? new Date(partial.confirmedAt) : undefined;
    this.confirmedBy = partial?.confirmedBy;
    this.deliveryAddress = partial?.deliveryAddress;
    this.receiverName = partial?.receiverName;
    this.phone = partial?.phone;
    this.trackingNumber = partial?.trackingNumber;
    this.carrierName = partial?.carrierName;
    this.shippingCarrier = partial?.shippingCarrier || partial?.carrierName;
    this.proofOfDeliveryUrl = partial?.proofOfDeliveryUrl;
    this.deliveryNote = partial?.deliveryNote;
    this.failureReason = partial?.failureReason;
    this.tripId = partial?.tripId;
    this.tripCode = partial?.tripCode;
    this.items = partial?.items;
    this.invoiceId = partial?.invoiceId;
    this.invoiceCode = partial?.invoiceCode;
    this.shippedAt = partial?.shippedAt ? new Date(partial.shippedAt) : undefined;
    this.deliveredAt = partial?.deliveredAt ? new Date(partial.deliveredAt) : undefined;
    this.lines = (partial?.lines || []).map((l) => (l instanceof ShipmentLineEntity ? l : new ShipmentLineEntity(l)));
    this.hasShortDelivery = partial?.hasShortDelivery !== undefined
      ? Boolean(partial.hasShortDelivery)
      : this.lines.some((l) => l.isShortDelivery);
    this.note = partial?.note;
    this.createdAt = partial?.createdAt ? new Date(partial.createdAt) : new Date();
    this.updatedAt = partial?.updatedAt ? new Date(partial.updatedAt) : new Date();
  }
}
