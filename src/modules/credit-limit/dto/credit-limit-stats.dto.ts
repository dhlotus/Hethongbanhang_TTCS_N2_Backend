/**
 * DTO Thống kê Hạn mức Công nợ toàn hệ thống (SN-34)
 */
export class CreditLimitStatsDto {
  totalCreditLimit: number;
  totalCurrentDebt: number;
  totalAvailableCredit: number;
  totalCustomers: number;
  normalCount: number;
  warningCount: number;
  exceededCount: number;
  blockedCount: number;
  averageUsageRate: number;
}
