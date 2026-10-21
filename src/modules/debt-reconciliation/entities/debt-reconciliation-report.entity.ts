export type ReconciliationStatus = 'PENDING' | 'CONFIRMED' | 'DISPUTED';

export class DebtReconciliationReportEntity {
  id: string;
  code: string;
  agencyId: string;
  agencyName: string;
  agencyCode?: string;
  period: string; // VD: '2026-10', '2026-09', 'Q3-2026'
  openingBalance: number;
  totalInvoiced: number;
  totalPaid: number;
  closingBalance: number;
  status: ReconciliationStatus;
  disputeNote?: string;
  note?: string;
  createdBy?: string;
  createdByName?: string;
  confirmedAt?: Date;
  confirmedBy?: string;
  createdAt: Date;
  updatedAt: Date;

  // Danh sách chứng từ chi tiết kèm theo
  invoices?: Array<{
    code: string;
    date: string | Date;
    amount: number;
    description: string;
  }>;
  payments?: Array<{
    code: string;
    date: string | Date;
    amount: number;
    method: string;
  }>;

  constructor(partial: Partial<DebtReconciliationReportEntity>) {
    Object.assign(this, partial);
  }
}
