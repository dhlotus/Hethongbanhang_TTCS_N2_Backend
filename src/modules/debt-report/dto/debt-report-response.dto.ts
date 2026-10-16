import { AgentDebtReportEntity } from '../entities/agent-debt-report.entity';

/**
 * DTO chứa tổng cộng toàn bộ các chỉ số công nợ (chân bảng)
 */
export class DebtReportSummaryDto {
  totalAgencies: number;
  totalReceivable: number;
  totalPaid: number;
  remainingDebt: number;
  totalAge0To30: number;
  totalAge31To60: number;
  totalAge61To90: number;
  totalAgeOver90: number;
  totalOverdueAmount: number;
  overdueAgenciesCount: number;
  inTermAgenciesCount: number;
}

/**
 * DTO kết quả trả về của API Báo cáo Sổ công nợ và Tuổi nợ
 */
export class DebtReportResponseDto {
  data: AgentDebtReportEntity[];
  summary: DebtReportSummaryDto;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
