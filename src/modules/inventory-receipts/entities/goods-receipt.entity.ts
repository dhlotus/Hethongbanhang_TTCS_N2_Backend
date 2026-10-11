export enum GoodsReceiptStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

export enum ReceiptType {
  PURCHASE_RECEIPT = 'PURCHASE_RECEIPT',
  TRANSFER_RECEIPT = 'TRANSFER_RECEIPT',
  RETURN_RECEIPT = 'RETURN_RECEIPT',
  ADJUSTMENT_RECEIPT = 'ADJUSTMENT_RECEIPT',
}

export class GoodsReceiptItemEntity {
  id: string;
  receiptId: string;
  productId: string;
  unitId: string;
  packageQuantity: number;
  conversionFactor: number;
  baseQuantity: number;
  unitCost: number;
  totalCost: number;
  batchNumber: string;
  mfgDate?: Date;
  expiryDate: Date;
  locationId?: string;
  notes?: string;
  createdAt: Date;
  
  // Relations
  productName?: string;
  productCode?: string;
  unitName?: string;
}

export class GoodsReceiptEntity {
  id: string;
  code: string;
  warehouseId: string;
  supplierId?: string;
  receiptType: ReceiptType;
  referenceDocument?: string;
  documentUrl?: string;
  status: GoodsReceiptStatus;
  totalCost: number;
  receivedBy?: string;
  receivedAt?: Date;
  notes?: string;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
  
  // Relations
  items?: GoodsReceiptItemEntity[];
  warehouseName?: string;
  supplierName?: string;
  createdByName?: string;
}
