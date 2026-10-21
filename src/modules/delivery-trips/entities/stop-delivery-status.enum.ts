/**
 * Trạng thái Điểm dừng Giao hàng trên Chuyến đi (SN-194 / SN-197)
 */
export enum StopDeliveryStatus {
  PENDING = 'PENDING', // Đang chờ giao (xe đang di chuyển tới)
  DELIVERED = 'DELIVERED', // Đã giao hàng thành công
  FAILED = 'FAILED', // Giao không thành công (hàng vẫn giữ trên xe, chưa về kho)
}
