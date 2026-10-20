export type StockAdjustmentReason = 'DAMAGED' | 'LOST' | 'EXPIRED' | 'OTHER';
export type StockAdjustmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface StockAdjustmentItemEntity {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  unit: string;
  currentStock: number; // Tồn kho trước khi điều chỉnh
  adjustedQuantity: number; // Số lượng hao hụt / giảm (luôn > 0)
  unitPrice: number; // Giá trị vốn ước tính
  lossValue: number; // Giá trị tổn thất = adjustedQuantity * unitPrice
  reason: StockAdjustmentReason;
  note?: string;
}

export class StockAdjustmentEntity {
  id: string;
  adjustmentCode: string; // PDC-YYYYMMDD-XXXX
  warehouseId: string;
  warehouseName: string;
  reason: StockAdjustmentReason; // Lý do chính (DAMAGED, LOST, EXPIRED)
  reasonDetail?: string; // Diễn giải chi tiết lý do
  totalLossValue: number; // Bắt buộc ghi rõ tổng giá trị tổn thất (VNĐ)
  status: StockAdjustmentStatus; // PENDING | APPROVED | REJECTED
  items: StockAdjustmentItemEntity[];
  creatorId: string;
  creatorName: string;
  creatorRole?: string;
  approverId?: string;
  approverName?: string;
  approvedAt?: Date;
  rejectReason?: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<StockAdjustmentEntity>) {
    Object.assign(this, partial);
    this.items = partial.items || [];
    this.totalLossValue =
      partial.totalLossValue ??
      this.items.reduce((sum, item) => sum + (Number(item.lossValue) || 0), 0);
  }
}
