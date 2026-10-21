import { DeliveryTripStatus } from './delivery-trip-status.enum';
import { DeliveryStopEntity } from './delivery-stop.entity';
import { StopDeliveryStatus } from './stop-delivery-status.enum';

/**
 * Entity Chuyến đi Giao hàng (SN-194 / SN-197)
 */
export class DeliveryTripEntity {
  id: string;
  tripCode: string;
  tripName: string;
  warehouseId: string;
  warehouseName: string;
  driverName: string;
  driverPhone: string;
  vehicleNumber: string;
  carrierName?: string;
  status: DeliveryTripStatus;
  departedAt?: Date;
  estimatedCompletionTime: Date;
  actualCompletionTime?: Date;
  returnedToWarehouse: boolean;
  returnedAt?: Date;
  returnedNotes?: string;
  notes?: string;
  stops: DeliveryStopEntity[];
  createdAt: Date;
  updatedAt: Date;

  // Thuộc tính tính toán (Calculated metrics)
  isOverdue: boolean;
  overdueMinutes: number;
  totalStops: number;
  deliveredStops: number;
  remainingStops: number;
  failedStops: number;
  totalGoodsValue: number;
  deliveredGoodsValue: number;
  inTransitGoodsValue: number;
  retainedGoodsValue: number;

  constructor(partial: Partial<DeliveryTripEntity>) {
    this.id = partial.id || `trip-${Date.now()}`;
    this.tripCode = partial.tripCode || `CD-${Date.now().toString().slice(-6)}`;
    this.tripName = partial.tripName || 'Chuyến xe giao hàng';
    this.warehouseId = partial.warehouseId || '';
    this.warehouseName = partial.warehouseName || '';
    this.driverName = partial.driverName || '';
    this.driverPhone = partial.driverPhone || '';
    this.vehicleNumber = partial.vehicleNumber || '';
    this.carrierName = partial.carrierName || 'Đội xe nội bộ';
    this.status = partial.status || DeliveryTripStatus.DRAFT;
    this.departedAt = partial.departedAt ? new Date(partial.departedAt) : undefined;
    this.estimatedCompletionTime = partial.estimatedCompletionTime
      ? new Date(partial.estimatedCompletionTime)
      : new Date(Date.now() + 4 * 3600 * 1000);
    this.actualCompletionTime = partial.actualCompletionTime
      ? new Date(partial.actualCompletionTime)
      : undefined;
    this.returnedToWarehouse = Boolean(partial.returnedToWarehouse);
    this.returnedAt = partial.returnedAt ? new Date(partial.returnedAt) : undefined;
    this.returnedNotes = partial.returnedNotes;
    this.notes = partial.notes;
    this.stops = (partial.stops || []).map((s) => (s instanceof DeliveryStopEntity ? s : new DeliveryStopEntity(s)));
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
    this.updatedAt = partial.updatedAt ? new Date(partial.updatedAt) : new Date();

    this.recalculateMetrics();
  }

  /**
   * Tính toán lại các chỉ số tiền hàng và cảnh báo trễ hạn
   */
  public recalculateMetrics(): void {
    const now = new Date();
    const estTime = new Date(this.estimatedCompletionTime);

    // Cảnh báo quá hạn: Nếu xe đang chạy mà thời gian hiện tại đã vượt quá thời gian dự kiến
    if (this.status === DeliveryTripStatus.IN_TRANSIT && now.getTime() > estTime.getTime()) {
      this.isOverdue = true;
      this.overdueMinutes = Math.floor((now.getTime() - estTime.getTime()) / (1000 * 60));
    } else {
      this.isOverdue = false;
      this.overdueMinutes = 0;
    }

    this.totalStops = this.stops.length;
    this.deliveredStops = this.stops.filter((s) => s.status === StopDeliveryStatus.DELIVERED).length;
    this.failedStops = this.stops.filter((s) => s.status === StopDeliveryStatus.FAILED).length;
    // Điểm còn lại: bao gồm PENDING và FAILED (chưa giao được vẫn thuộc trách nhiệm chuyến đi)
    this.remainingStops = this.totalStops - this.deliveredStops;

    this.totalGoodsValue = this.stops.reduce((sum, s) => sum + (Number(s.orderAmount) || 0), 0);
    this.deliveredGoodsValue = this.stops
      .filter((s) => s.status === StopDeliveryStatus.DELIVERED)
      .reduce((sum, s) => sum + (Number(s.orderAmount) || 0), 0);

    if (this.returnedToWarehouse || this.status === DeliveryTripStatus.COMPLETED) {
      this.retainedGoodsValue = 0;
      this.inTransitGoodsValue = 0;
      this.remainingStops = 0;
      this.isOverdue = false;
      this.overdueMinutes = 0;
    } else {
      // Hàng chưa giao được vẫn giữ trên xe
      this.retainedGoodsValue = this.stops
        .filter((s) => s.status === StopDeliveryStatus.FAILED)
        .reduce((sum, s) => sum + (Number(s.orderAmount) || 0), 0);

      // Tiền hàng đang nằm trên đường = Tổng hàng xuất - Hàng đã giao xong
      // (Bao gồm cả hàng PENDING và hàng FAILED đang giữ trên xe)
      this.inTransitGoodsValue = Math.max(0, this.totalGoodsValue - this.deliveredGoodsValue);
    }
  }
}
