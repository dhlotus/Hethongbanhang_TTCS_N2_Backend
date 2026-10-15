/**
 * Enum định nghĩa các phân nhóm tuổi nợ (SN-203)
 */
export enum AgingDebtGroupEnum {
  ALL = 'ALL',
  AGE_0_30 = 'AGE_0_30',
  AGE_31_60 = 'AGE_31_60',
  AGE_61_90 = 'AGE_61_90',
  AGE_OVER_90 = 'AGE_OVER_90',
}

/** Alias phục vụ tương thích ngược */
export const AgingDebtGroup = AgingDebtGroupEnum;
export type AgingDebtGroup = AgingDebtGroupEnum;

/**
 * Nhãn hiển thị tiếng Việt tương ứng với từng nhóm tuổi nợ
 */
export const AGING_DEBT_GROUP_LABELS: Record<AgingDebtGroupEnum, string> = {
  [AgingDebtGroupEnum.ALL]: 'Tất cả',
  [AgingDebtGroupEnum.AGE_0_30]: '0–30 ngày',
  [AgingDebtGroupEnum.AGE_31_60]: '31–60 ngày',
  [AgingDebtGroupEnum.AGE_61_90]: '61–90 ngày',
  [AgingDebtGroupEnum.AGE_OVER_90]: 'Trên 90 ngày',
};
