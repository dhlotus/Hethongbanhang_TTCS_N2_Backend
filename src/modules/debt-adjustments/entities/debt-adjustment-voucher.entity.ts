export type DebtAdjustmentStatus = 'POSTED' | 'DRAFT' | 'CANCELLED';

export interface DebtAdjustmentItem {
  productId: string;
  productSku: string;
  productName: string;
  unit?: string;
  quantity: number;
  originalUnitPrice: number;
  lineTotal: number;
  conditionType?: 'GOOD' | 'DAMAGED';
  batchNumber?: string | null;
}

export interface DebtAdjustmentVoucherEntity {
  id: string; // UUID
  code: string; // DC-CN-YYMM-XXX
  returnReceiptId: string;
  returnReceiptCode?: string;
  agencyId: string;
  agencyCode?: string;
  agencyName?: string;
  originalInvoiceId: string;
  originalInvoiceCode?: string;
  adjustmentAmount: number; // Tổng số tiền giảm trừ theo đơn giá bán gốc
  reason: string;
  status: DebtAdjustmentStatus; // 'POSTED'
  createdBy: string;
  creatorName?: string;
  slipCreatedBy?: string;
  slipCreatorName?: string;
  slipCreatorUsername?: string;
  slipCreatorDisplayName?: string;
  accountantName?: string;
  accountantUsername?: string;
  accountantDisplayName?: string;
  items?: DebtAdjustmentItem[];
  createdAt: Date;
  updatedAt: Date;
}
