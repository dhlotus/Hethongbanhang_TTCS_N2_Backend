/**
 * Trạng thái Đơn hàng Bán buôn (SN-38 & SN-39)
 */
export enum OrderStatus {
  DRAFT = 'DRAFT', // Nháp (mở lại tiếp tục gõ)
  PENDING = 'PENDING', // Chờ duyệt
  PENDING_APPROVAL = 'PENDING_APPROVAL', // Cần phê duyệt (do vượt hạn mức công nợ - SN-41)
  PENDING_INVENTORY_APPROVAL = 'PENDING_INVENTORY_APPROVAL', // Chờ duyệt tồn kho
  APPROVED = 'APPROVED', // Đã duyệt
  PROCESSING = 'PROCESSING', // Đang soạn hàng
  SHIPPED = 'SHIPPED', // Đã xuất kho / giao vận
  DELIVERED = 'DELIVERED', // Giao thành công
  CLOSED = 'CLOSED', // Đã đóng
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
