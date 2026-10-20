/**
 * Thực thể Báo cáo Công nợ và Phân tích Tuổi nợ theo Đại lý (SN-230)
 */
export class AgentDebtReportEntity {
  agencyId: string;
  agencyCode: string;
  agencyName: string;
  customerGroup: string;
  phone: string;
  region: string;
  salesRepId: string;
  salesRepName: string;
  creditLimit: number;
  maxDebtDays: number;
  asOfDate: string;

  // Số liệu tổng hợp
  totalReceivable: number;
  totalPaid: number;
  remainingDebt: number;

  // 5 nhóm tuổi nợ không chồng lấn theo đúng yêu cầu SN-230 & CSDL
  currentInTerm: number; // Chưa quá hạn (trong hạn)
  age1To30: number;      // Quá hạn 1–30 ngày
  age31To60: number;     // Quá hạn 31–60 ngày
  age61To90: number;     // Quá hạn 61–90 ngày
  ageOver90: number;     // Quá hạn trên 90 ngày

  // Tương thích ngược với field age0To30
  age0To30: number;

  // Quá hạn & Ưu tiên xử lý
  overdueAmount: number;
  isOverdue: boolean;
  oldestDebtDays: number;     // Số ngày từ ngày phát sinh cũ nhất
  oldestOverdueDays: number;  // Số ngày quá hạn lớn nhất
  currentFilterStatus: string;

  // Đánh giá mức độ ưu tiên xử lý (Hiển thị rõ căn cứ cụ thể, không tự đặt điểm rủi ro thiếu cơ sở)
  priorityLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'SETTLED';
  priorityLabel: string;
  priorityReason: string;

  constructor(partial: Partial<AgentDebtReportEntity>) {
    this.agencyId = partial.agencyId ?? '';
    this.agencyCode = partial.agencyCode ?? '';
    this.agencyName = partial.agencyName ?? '';
    this.customerGroup = partial.customerGroup ?? '';
    this.phone = partial.phone ?? '';
    this.region = partial.region ?? '';
    this.salesRepId = partial.salesRepId ?? '';
    this.salesRepName = partial.salesRepName ?? '';
    this.creditLimit = partial.creditLimit ?? 0;
    this.maxDebtDays = partial.maxDebtDays ?? 30;
    this.asOfDate = partial.asOfDate ?? new Date().toISOString().slice(0, 10);

    this.totalReceivable = partial.totalReceivable ?? 0;
    this.totalPaid = partial.totalPaid ?? 0;
    this.remainingDebt = partial.remainingDebt ?? 0;

    this.currentInTerm = partial.currentInTerm ?? partial.age0To30 ?? 0;
    this.age1To30 = partial.age1To30 ?? 0;
    this.age31To60 = partial.age31To60 ?? 0;
    this.age61To90 = partial.age61To90 ?? 0;
    this.ageOver90 = partial.ageOver90 ?? 0;
    this.age0To30 = this.currentInTerm;

    this.overdueAmount = partial.overdueAmount ?? 0;
    this.isOverdue = partial.isOverdue ?? false;
    this.oldestDebtDays = partial.oldestDebtDays ?? 0;
    this.oldestOverdueDays = partial.oldestOverdueDays ?? 0;
    this.currentFilterStatus = partial.currentFilterStatus ?? 'Trong hạn';

    this.priorityLevel = partial.priorityLevel ?? 'LOW';
    this.priorityLabel = partial.priorityLabel ?? 'Bình thường';
    this.priorityReason = partial.priorityReason ?? 'Trong hạn thanh toán';
  }
}
