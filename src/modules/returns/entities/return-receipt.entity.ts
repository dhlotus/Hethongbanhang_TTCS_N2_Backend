export type ReturnReceiptStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ReturnConditionType = 'GOOD' | 'DAMAGED';

export interface ReturnReceiptItemEntity {
  id: string;
  returnReceiptId: string;
  productId: string;
  productSku: string;
  productName: string;
  unit?: string;
  batchNumber?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  conditionType: ReturnConditionType;
  subReason?: string | null;
  createdAt: Date;
}

export interface ReturnReceiptEntity {
  id: string;
  code: string;
  originalInvoiceId: string;
  originalInvoiceCode?: string;
  agencyId: string;
  agencyCode?: string;
  agencyName?: string;
  warehouseId: string;
  warehouseCode?: string;
  warehouseName?: string;
  status: ReturnReceiptStatus;
  reason: string;
  totalRefundAmount: number;
  createdBy: string;
  createdByName?: string;
  warehouseManagerId?: string | null;
  warehouseManagerName?: string | null;
  approvedAt?: Date | null;
  approvalNote?: string | null;
  createdAt: Date;
  updatedAt: Date;
  items?: ReturnReceiptItemEntity[];
}

export interface DamagedStockBalanceEntity {
  id: string;
  warehouseId: string;
  productId: string;
  productSku: string;
  batchNumber?: string | null;
  quantity: number;
  updatedAt: Date;
}
