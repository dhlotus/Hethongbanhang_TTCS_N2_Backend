/**
 * SN-196: Entity Chuyến giao hàng và Điểm dừng giao hàng
 * Quản lý kho phân tuyến và gán tài xế, gom nhiều phiếu xuất vào một chuyến
 */

export enum DeliveryTripStatus {
  DRAFT = 'DRAFT',           // Mới lập kế hoạch
  ASSIGNED = 'ASSIGNED',     // Đã gán tài xế & phương tiện
  IN_TRANSIT = 'IN_TRANSIT', // Đang chạy giao hàng trên đường
  COMPLETED = 'COMPLETED',   // Đã hoàn tất tất cả điểm giao
  CANCELLED = 'CANCELLED',   // Hủy chuyến
}

export interface DeliveryTripStopEntity {
  id: string;
  tripId: string;
  shipmentId: string;
  orderCode: string;
  stopOrder: number;            // Thứ tự giao (1, 2, 3...)
  customerName: string;
  receiverName: string;
  receiverPhone: string;
  deliveryAddress: string;
  packageCount?: number;
  codAmount?: number;           // Tiền thu hộ / công nợ nếu có
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  deliveredAt?: Date;
  note?: string;
}

export interface DeliveryTripEntity {
  id: string;
  tripCode: string;              // Mã chuyến: TRIP-YYMM-XXXX
  name: string;                  // Tên chuyến (VD: Chuyến giao Miền Đông - Sáng 17/10)
  routeArea: string;             // Khu vực / Tuyến đường (VD: Hà Nội - Nội thành)
  warehouseId?: string;          // Kho xuất phát
  warehouseName?: string;
  driverName?: string;           // Tên tài xế
  driverPhone?: string;          // SĐT tài xế
  vehicleNumber?: string;        // Biển số xe (VD: 29C-889.92)
  vehicleType?: string;          // Loại phương tiện (Xe tải 2.5T, Xe van 1.25T...)
  departureDate: Date;           // Thời điểm xuất phát dự kiến
  completedAt?: Date;            // Thời điểm hoàn tất
  status: DeliveryTripStatus;    // Trạng thái chuyến
  stops: DeliveryTripStopEntity[];
  totalStops: number;
  deliveredStops: number;
  totalCodAmount: number;
  note?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}
