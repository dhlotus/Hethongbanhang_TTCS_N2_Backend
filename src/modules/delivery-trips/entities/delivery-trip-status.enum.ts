/**
 * Trạng thái Chuyến đi Giao hàng (SN-194 / SN-197)
 */
export enum DeliveryTripStatus {
  DRAFT = 'DRAFT', // Mới lập chuyến, chưa xuất phát
  IN_TRANSIT = 'IN_TRANSIT', // Đang chạy trên đường giao hàng
  COMPLETED = 'COMPLETED', // Đã kết thúc và đối soát nhập kho xong
  CANCELLED = 'CANCELLED', // Đã hủy
}
