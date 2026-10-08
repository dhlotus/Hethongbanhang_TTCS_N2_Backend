/**
 * Trạng thái Đơn hàng Bán buôn (SN-38 & SN-39)
 */
export enum OrderStatus {
  DRAFT = 'DRAFT', // Nháp (mở lại tiếp tục gõ)
  PENDING = 'PENDING', // Chờ duyệt
  APPROVED = 'APPROVED', // Đã duyệt
  PROCESSING = 'PROCESSING', // Đang soạn hàng
  SHIPPED = 'SHIPPED', // Đã xuất kho / giao vận
  DELIVERED = 'DELIVERED', // Giao thành công
  CANCELLED = 'CANCELLED', // Đã hủy
  RETURNED = 'RETURNED', // Hoàn hàng
}

/**
 * Trạng thái Thanh toán
 */
export enum PaymentStatus {
  UNPAID = 'UNPAID', // Chưa thanh toán
  PARTIAL = 'PARTIAL', // Thanh toán một phần
  PAID = 'PAID', // Đã thanh toán
}
