/**
 * Enum định nghĩa các phân nhóm tuổi nợ (SN-230 & chuẩn CSDL)
 * Các nhóm KHÔNG CHỒNG LẤN:
 * - CURRENT: Chưa quá hạn (trong hạn thanh toán)
 * - AGE_1_30: Quá hạn 1–30 ngày
 * - AGE_31_60: Quá hạn 31–60 ngày
 * - AGE_61_90: Quá hạn 61–90 ngày
 * - AGE_OVER_90: Quá hạn trên 90 ngày
 */
export enum AgingDebtGroupEnum {
  ALL = 'ALL',
  CURRENT = 'CURRENT',
  AGE_1_30 = 'AGE_1_30',
  AGE_31_60 = 'AGE_31_60',
  AGE_61_90 = 'AGE_61_90',
  AGE_OVER_90 = 'AGE_OVER_90',
  // Tương thích ngược với SN-203 cũ
  AGE_0_30 = 'AGE_0_30',
}

/** Alias phục vụ tương thích ngược */
export const AgingDebtGroup = AgingDebtGroupEnum;
export type AgingDebtGroup = AgingDebtGroupEnum;

/**
 * Nhãn hiển thị tiếng Việt tương ứng với từng nhóm tuổi nợ
 */
export const AGING_DEBT_GROUP_LABELS: Record<AgingDebtGroupEnum, string> = {
  [AgingDebtGroupEnum.ALL]: 'Tất cả nhóm tuổi nợ',
  [AgingDebtGroupEnum.CURRENT]: 'Chưa quá hạn (Trong hạn)',
  [AgingDebtGroupEnum.AGE_1_30]: 'Quá hạn 1–30 ngày',
  [AgingDebtGroupEnum.AGE_31_60]: 'Quá hạn 31–60 ngày',
  [AgingDebtGroupEnum.AGE_61_90]: 'Quá hạn 61–90 ngày',
  [AgingDebtGroupEnum.AGE_OVER_90]: 'Quá hạn trên 90 ngày',
  [AgingDebtGroupEnum.AGE_0_30]: '0–30 ngày (Trong hạn)',
};

/**
 * Mức độ ưu tiên xử lý thu hồi công nợ theo căn cứ thực tế (SN-230)
 */
export enum DebtPriorityLevelEnum {
  ALL = 'ALL',
  CRITICAL = 'CRITICAL', // Khẩn cấp (Nợ >90 ngày hoặc nợ lớn quá hạn dài)
  HIGH = 'HIGH',         // Cao (Nợ 61-90 ngày hoặc nợ lớn 31-60 ngày)
  MEDIUM = 'MEDIUM',     // Trung bình (Nợ 1-30 ngày hoặc 31-60 ngày vừa)
  LOW = 'LOW',           // Bình thường (Trong hạn)
  SETTLED = 'SETTLED',   // Đã tất toán (Dư nợ = 0)
}

export const DEBT_PRIORITY_LABELS: Record<DebtPriorityLevelEnum, string> = {
  [DebtPriorityLevelEnum.ALL]: 'Tất cả mức ưu tiên',
  [DebtPriorityLevelEnum.CRITICAL]: 'Khẩn cấp',
  [DebtPriorityLevelEnum.HIGH]: 'Cao',
  [DebtPriorityLevelEnum.MEDIUM]: 'Trung bình',
  [DebtPriorityLevelEnum.LOW]: 'Bình thường',
  [DebtPriorityLevelEnum.SETTLED]: 'Đã tất toán',
};
