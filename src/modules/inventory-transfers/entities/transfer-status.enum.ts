/**
 * Trạng thái của Phiếu Chuyển kho Nội bộ (SN-181)
 */
export enum TransferStatus {
  /** Bản nháp, chưa trừ kho đi */
  DRAFT = 'DRAFT',
  /** Đang chuyển trên đường: kho đi đã trừ tồn, kho đến CHƯA cộng tồn */
  IN_TRANSIT = 'IN_TRANSIT',
  /** Đã hoàn thành: kho đến xác nhận nhận đủ 100%, tồn kho đến đã cộng */
  COMPLETED = 'COMPLETED',
  /** Nhận có chênh lệch: kho đến nhận thiếu/thừa và có lý do chênh lệch */
  PARTIALLY_RECEIVED = 'PARTIALLY_RECEIVED',
  /** Đã hủy phiếu */
  CANCELLED = 'CANCELLED',
}
