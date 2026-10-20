/**
 * Thực thể chi tiết từng dòng chứng từ trong Sổ Chi Tiết Công Nợ Đại Lý (SN-231)
 */
export interface DebtLedgerTransaction {
  id: string;
  date: string; // ISO string / YYYY-MM-DD
  documentCode: string; // Mã chứng từ (HD..., PT..., TH..., DC...)
  documentType: 'INVOICE' | 'PAYMENT' | 'RETURN' | 'ADJUSTMENT';
  documentTypeLabel: string; // Tên hiển thị tiếng Việt
  description: string; // Diễn giải nghiệp vụ chi tiết
  debit: number; // Phát sinh tăng (Nợ)
  credit: number; // Phát sinh giảm (Có)
  runningBalance: number; // Số dư lũy kế sau giao dịch
  status: 'CONFIRMED' | 'PAID' | 'PARTIAL' | 'CANCELLED';
  dueDate?: string;
  referenceCode?: string;
  createdAt?: string;
}

/**
 * Thông tin đại lý phục vụ in ấn / hiển thị đối chiếu sổ công nợ
 */
export interface DebtLedgerAgencyMeta {
  id: string;
  code: string;
  name: string;
  taxCode?: string;
  phone?: string;
  email?: string;
  address?: string;
  creditLimit: number;
  maxDebtDays: number;
  salesRepName: string;
  region?: string;
}

/**
 * Báo cáo Sổ Chi Tiết Công Nợ Đại Lý hoàn chỉnh theo kỳ đối chiếu (SN-231)
 * Bảo đảm: closingBalance = openingBalance + totalDebit - totalCredit
 */
export interface DebtLedgerStatement {
  agency: DebtLedgerAgencyMeta;
  period: {
    fromDate: string;
    toDate: string;
  };
  openingBalance: number; // Số dư đầu kỳ tính từ phát sinh hợp lệ trước fromDate
  totalDebit: number; // Tổng phát sinh tăng trong kỳ
  totalCredit: number; // Tổng phát sinh giảm trong kỳ
  closingBalance: number; // Số dư cuối kỳ
  isBalanced: boolean; // Khẳng định cân đối kế toán tuyệt đối
  transactions: DebtLedgerTransaction[];
  generatedAt: string;
}
