import { AgentDebtReportEntity } from '../entities/agent-debt-report.entity';

/**
 * Thống kê tổng hợp công nợ theo từng nhân viên kinh doanh phụ trách (SN-230)
 */
export interface SalesRepDebtSummaryDto {
  salesRepName: string;
  agencyCount: number;
  totalReceivable: number;
  totalPaid: number;
  remainingDebt: number;
  overdueAmount: number;
  criticalAgenciesCount: number;
}

/**
 * DTO chứa tổng cộng toàn bộ các chỉ số công nợ (chân bảng) và phân nhóm tuổi nợ (SN-230)
 */
export class DebtReportSummaryDto {
  asOfDate: string;
  totalAgencies: number;
  totalReceivable: number;
  totalPaid: number;
  remainingDebt: number;

  // 5 nhóm tuổi nợ không chồng lấn
  totalCurrentInTerm: number;
  totalAge1To30: number;
  totalAge31To60: number;
  totalAge61To90: number;
  totalAgeOver90: number;

  // Tương thích ngược với field totalAge0To30
  totalAge0To30: number;

  totalOverdueAmount: number;
  overdueAgenciesCount: number;
  inTermAgenciesCount: number;

  // Phân loại ưu tiên
  criticalAgenciesCount: number;
  highPriorityCount: number;
  mediumPriorityCount: number;
  normalPriorityCount: number;

  // Tổng hợp theo nhân viên phụ trách
  salesRepSummary?: SalesRepDebtSummaryDto[];
}

/**
 * DTO kết quả trả về của API Báo cáo Sổ công nợ và Tuổi nợ (SN-230)
 */
export class DebtReportResponseDto {
  data: AgentDebtReportEntity[];
  summary: DebtReportSummaryDto;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
