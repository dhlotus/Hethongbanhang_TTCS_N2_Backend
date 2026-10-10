export enum StockReservationStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  FULFILLED = 'FULFILLED',
}

export class StockReservationEntity {
  id: string;
  orderId: string;
  orderCode?: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: StockReservationStatus;
  expiredAt: Date;
  createdAt: Date;
  releasedAt?: Date;

  constructor(partial?: Partial<StockReservationEntity>) {
    this.id = partial?.id || '';
    this.orderId = partial?.orderId || '';
    this.orderCode = partial?.orderCode;
    this.productId = partial?.productId || '';
    this.warehouseId = partial?.warehouseId || 'wh-main';
    this.quantity = partial?.quantity || 0;
    this.status = partial?.status || StockReservationStatus.ACTIVE;
    this.expiredAt = partial?.expiredAt || new Date(Date.now() + 24 * 60 * 60 * 1000);
    this.createdAt = partial?.createdAt || new Date();
    this.releasedAt = partial?.releasedAt;
  }
}
