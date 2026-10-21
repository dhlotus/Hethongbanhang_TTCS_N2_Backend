/**
 * Trạng thái Đơn hàng Bán buôn (SN-38 & SN-39)
 */
export enum OrderStatus {
  DRAFT = 'DRAFT', // Nháp (mở lại tiếp tục gõ)
  PENDING = 'PENDING', // Chờ duyệt
  PENDING_APPROVAL = 'PENDING_APPROVAL', // Cần phê duyệt (do vượt hạn mức công nợ - SN-41)
  PENDING_INVENTORY_APPROVAL = 'PENDING_INVENTORY_APPROVAL', // Chờ duyệt tồn kho
  APPROVED = 'APPROVED', // Đã duyệt
  REJECTED = 'REJECTED', // Bị từ chối sau khi quản lý xét duyệt
  RETURNED_FOR_UPDATE = 'RETURNED_FOR_UPDATE', // Trả lại nhân viên kinh doanh để chỉnh sửa
  PROCESSING = 'PROCESSING', // Đang soạn hàng
  PACKED = 'PACKED', // Đã đóng gói
  DISPATCHED = 'DISPATCHED', // Đã xuất kho (SN-199)
  SHIPPED = 'SHIPPED', // Đang giao hàng / vận chuyển
  DELIVERED = 'DELIVERED', // Đã giao / Giao thành công
  CLOSED = 'CLOSED', // Đã đóng
  CANCELLED = 'CANCELLED', // Đã hủy
  RETURNED = 'RETURNED', // Hoàn hàng
  COMPLETED = 'COMPLETED', // Hoàn tất đơn hàng
}

/**
 * Trạng thái Thanh toán
 */
export enum PaymentStatus {
  UNPAID = 'UNPAID', // Chưa thanh toán
  PARTIAL = 'PARTIAL', // Thanh toán một phần
  PAID = 'PAID', // Đã thanh toán
}

/**
 * Danh sách trạng thái được chính thức ghi nhận doanh số bán hàng (SN-215, SN-217, SN-218)
 * Chỉ ghi nhận các đơn hàng ĐÃ ĐƯỢC PHÊ DUYỆT hoặc đang thực hiện giao/nhận hàng thành công.
 * Loại bỏ tuyệt đối: DRAFT (nháp), PENDING / PENDING_APPROVAL (đang chờ duyệt),
 * REJECTED (từ chối), RETURNED_FOR_UPDATE (trả lại sửa), CANCELLED (đã hủy), RETURNED (hoàn hàng).
 */
export const RECOGNIZED_SALES_STATUSES: readonly OrderStatus[] = [
  OrderStatus.APPROVED,
  OrderStatus.PROCESSING,
  OrderStatus.PACKED,
  OrderStatus.DISPATCHED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
  OrderStatus.CLOSED,
] as const;

export const isRecognizedSalesStatus = (status: OrderStatus): boolean =>
  RECOGNIZED_SALES_STATUSES.includes(status);
