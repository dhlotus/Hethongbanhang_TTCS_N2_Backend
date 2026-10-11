import { InventoryAuditStatus } from './inventory-audit-status.enum';

export interface InventoryAuditItemEntity {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  categoryName?: string;
  unit: string;
  bookQuantity: number; // Tồn sổ sách chốt tại thời điểm tạo phiếu
  actualQuantity: number | null; // Số đếm thực tế
  difference: number; // Chênh lệch = actualQuantity - bookQuantity
  differenceAmount?: number; // Giá trị chênh lệch = difference * unitPrice
  unitPrice?: number;
  note?: string; // Ghi chú lý do lệch theo từng dòng
}

export class InventoryAuditEntity {
  id: string;
  auditCode: string;
  warehouseId: string;
  warehouseName: string;
  scope: 'ALL' | 'CATEGORY';
  categoryId?: string;
  categoryName?: string;
  status: InventoryAuditStatus;
  note?: string;
  items: InventoryAuditItemEntity[];
  totalBookQuantity: number;
  totalActualQuantity: number;
  totalDifferenceQuantity: number;
  creatorId: string;
  creatorName: string;
  completedById?: string;
  completedByName?: string;
  completedAt?: Date;
  reason?: string; // Lý do điều chỉnh khi chốt phiếu (bắt buộc khi chốt)
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<InventoryAuditEntity>) {
    Object.assign(this, partial);
    this.items = partial.items || [];
    this.totalBookQuantity = partial.totalBookQuantity ?? this.calculateTotalBook();
    this.totalActualQuantity = partial.totalActualQuantity ?? this.calculateTotalActual();
    this.totalDifferenceQuantity = partial.totalDifferenceQuantity ?? this.calculateTotalDiff();
  }

  private calculateTotalBook(): number {
    return this.items.reduce((sum, item) => sum + (item.bookQuantity || 0), 0);
  }

  private calculateTotalActual(): number {
    return this.items.reduce(
      (sum, item) =>
        sum +
        (item.actualQuantity !== null && item.actualQuantity !== undefined
          ? item.actualQuantity
          : item.bookQuantity),
      0,
    );
  }

  private calculateTotalDiff(): number {
    return this.items.reduce((sum, item) => sum + (item.difference || 0), 0);
  }
}
