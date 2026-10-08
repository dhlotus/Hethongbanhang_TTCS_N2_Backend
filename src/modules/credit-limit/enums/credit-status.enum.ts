/**
 * Trạng thái hạn mức công nợ đại lý (SN-34)
 */
export enum CreditStatus {
  /** Hoạt động bình thường (Dưới 80% hạn mức) */
  NORMAL = 'NORMAL',
  /** Cảnh báo chạm ngưỡng (Từ 80% đến 100% hạn mức) */
  WARNING = 'WARNING',
  /** Vượt quá hạn mức công nợ cho phép (> 100%) */
  EXCEEDED = 'EXCEEDED',
  /** Bị khóa công nợ (Do quá hạn lâu ngày hoặc kế toán tạm khóa) */
  BLOCKED = 'BLOCKED',
}
