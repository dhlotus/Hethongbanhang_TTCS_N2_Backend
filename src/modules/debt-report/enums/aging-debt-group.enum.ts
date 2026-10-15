/**
 * Enum định nghĩa các phân nhóm tuổi nợ (SN-203)
 */
export enum AgingDebtGroup {
  AGE_0_30 = 'AGE_0_30',
  AGE_31_60 = 'AGE_31_60',
  AGE_61_90 = 'AGE_61_90',
  AGE_OVER_90 = 'AGE_OVER_90',
}

/**
 * Nhãn hiển thị tiếng Việt tương ứng với từng nhóm tuổi nợ
 */
export const AGING_DEBT_GROUP_LABELS: Record<AgingDebtGroup, string> = {
  [AgingDebtGroup.AGE_0_30]: '0–30 ngày',
  [AgingDebtGroup.AGE_31_60]: '31–60 ngày',
  [AgingDebtGroup.AGE_61_90]: '61–90 ngày',
  [AgingDebtGroup.AGE_OVER_90]: 'Trên 90 ngày',
};
