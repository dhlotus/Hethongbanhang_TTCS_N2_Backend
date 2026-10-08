/**
 * Điều khoản thanh toán công nợ tiêu chuẩn (SN-34)
 */
export enum PaymentTerm {
  /** Thanh toán ngay khi nhận hàng (Cash on delivery) */
  COD = 'COD',
  /** Thanh toán trong vòng 15 ngày kể từ ngày giao hàng */
  NET_15 = 'NET_15',
  /** Thanh toán trong vòng 30 ngày kể từ ngày giao hàng */
  NET_30 = 'NET_30',
  /** Thanh toán trong vòng 45 ngày kể từ ngày giao hàng */
  NET_45 = 'NET_45',
  /** Thanh toán trong vòng 60 ngày kể từ ngày giao hàng */
  NET_60 = 'NET_60',
  /** Thanh toán vào cuối tháng phát sinh hóa đơn + 30 ngày */
  EOM_30 = 'EOM_30',
}
