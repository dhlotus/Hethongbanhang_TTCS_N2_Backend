/**
 * Thực thể Báo cáo Công nợ và Phân tích Tuổi nợ theo Đại lý (SN-203)
 */
export class AgentDebtReportEntity {
  agencyId: string;
  agencyCode: string;
  agencyName: string;
  customerGroup: string;
  phone: string;
  region: string;
  salesRepName: string;
  totalReceivable: number;
  totalPaid: number;
  remainingDebt: number;
  age0To30: number;
  age31To60: number;
  age61To90: number;
  ageOver90: number;
  creditLimit: number;
  maxDebtDays: number;
  overdueAmount: number;
  isOverdue: boolean;
  oldestDebtDays: number;
  currentFilterStatus: string;

  constructor(partial: Partial<AgentDebtReportEntity>) {
    this.agencyId = partial.agencyId ?? '';
    this.agencyCode = partial.agencyCode ?? '';
    this.agencyName = partial.agencyName ?? '';
    this.customerGroup = partial.customerGroup ?? '';
    this.phone = partial.phone ?? '';
    this.region = partial.region ?? '';
    this.salesRepName = partial.salesRepName ?? '';
    this.totalReceivable = partial.totalReceivable ?? 0;
    this.totalPaid = partial.totalPaid ?? 0;
    this.remainingDebt = partial.remainingDebt ?? 0;
    this.age0To30 = partial.age0To30 ?? 0;
    this.age31To60 = partial.age31To60 ?? 0;
    this.age61To90 = partial.age61To90 ?? 0;
    this.ageOver90 = partial.ageOver90 ?? 0;
    this.creditLimit = partial.creditLimit ?? 0;
    this.maxDebtDays = partial.maxDebtDays ?? 30;
    this.overdueAmount = partial.overdueAmount ?? 0;
    this.isOverdue = partial.isOverdue ?? false;
    this.oldestDebtDays = partial.oldestDebtDays ?? 0;
    this.currentFilterStatus = partial.currentFilterStatus ?? 'Trong hạn';
  }
}
