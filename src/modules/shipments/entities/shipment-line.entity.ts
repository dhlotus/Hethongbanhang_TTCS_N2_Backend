/**
 * Thực thể chi tiết dòng hàng trong Phiếu xuất kho (Shipment Line) - SN-195
 */
export class ShipmentLineEntity {
  id: string;
  shipmentId: string;
  orderLineId: string;
  productId: string;
  productSku: string;
  productName: string;
  unitName: string;
  conversionRate: number;
  orderedQuantity: number;
  shippedQuantity: number;
  remainingQuantity: number;
  isShortDelivery: boolean;
  shortDeliveryReason?: string;

  constructor(partial?: Partial<ShipmentLineEntity>) {
    this.id = partial?.id || `shpl-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.shipmentId = partial?.shipmentId || '';
    this.orderLineId = partial?.orderLineId || '';
    this.productId = partial?.productId || '';
    this.productSku = partial?.productSku || '';
    this.productName = partial?.productName || '';
    this.unitName = partial?.unitName || 'Đơn vị';
    this.conversionRate = partial?.conversionRate !== undefined ? Number(partial.conversionRate) : 1;
    this.orderedQuantity = partial?.orderedQuantity !== undefined ? Number(partial.orderedQuantity) : 0;
    this.shippedQuantity = partial?.shippedQuantity !== undefined ? Number(partial.shippedQuantity) : this.orderedQuantity;
    this.remainingQuantity = partial?.remainingQuantity !== undefined
      ? Number(partial.remainingQuantity)
      : Math.max(0, this.orderedQuantity - this.shippedQuantity);
    this.isShortDelivery = partial?.isShortDelivery !== undefined
      ? Boolean(partial.isShortDelivery)
      : this.shippedQuantity < this.orderedQuantity;
    this.shortDeliveryReason = partial?.shortDeliveryReason;
  }
}
