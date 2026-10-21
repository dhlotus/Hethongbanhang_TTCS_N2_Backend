import { AgingDebtGroupEnum } from '../enums/aging-debt-group.enum';

/**
 * DTO dữ liệu chi tiết hóa đơn thực tế phát sinh của Đại lý phục vụ phân tích tuổi nợ (SN-203)
 */
export class AgencyInvoiceDto {
  id: string;
  invoiceCode: string;
  orderCode: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  daysOld: number;
  overdueDays: number;
  isOverdue: boolean;
  agingGroup: AgingDebtGroupEnum;
  agingLabel: string;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
}
