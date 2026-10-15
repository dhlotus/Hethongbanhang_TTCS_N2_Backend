import { TransferStatus } from './transfer-status.enum';

/**
 * Chi tiết mặt hàng trong Phiếu Chuyển kho Nội bộ
 */
export class InternalTransferItemEntity {
  id: string;
  transferId: string;
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  conversionRate: number;
  baseUnit: string;
  /** Số lượng gửi theo đơn vị đóng gói (VD: 5 Thùng) */
  transferQuantity: number;
  /** Số lượng gửi quy về đơn vị cơ sở (VD: 120 Lon) */
  baseTransferQuantity: number;
  /** Số lượng thực nhận theo đơn vị đóng gói (kho đến xác nhận) */
  receivedQuantity?: number;
  /** Số lượng thực nhận quy về đơn vị cơ sở */
  baseReceivedQuantity?: number;
  /** Chênh lệch = transferQuantity - receivedQuantity */
  discrepancyQuantity?: number;
  /** Bắt buộc nhập khi có chênh lệch */
  discrepancyReason?: string;
  notes?: string;
  createdAt: Date;

  constructor(partial: Partial<InternalTransferItemEntity>) {
    this.id = partial.id || `iti-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.transferId = partial.transferId || '';
    this.productId = partial.productId || '';
    this.sku = partial.sku || '';
    this.productName = partial.productName || '';
    this.unit = partial.unit || '';
    this.conversionRate = Number(partial.conversionRate) > 0 ? Number(partial.conversionRate) : 1;
    this.baseUnit = partial.baseUnit || '';
    this.transferQuantity = Number(partial.transferQuantity) || 0;
    this.baseTransferQuantity = Number(partial.baseTransferQuantity) || Math.round(this.transferQuantity * this.conversionRate);
    this.receivedQuantity = partial.receivedQuantity !== undefined ? Number(partial.receivedQuantity) : undefined;
    this.baseReceivedQuantity = partial.baseReceivedQuantity !== undefined 
      ? Number(partial.baseReceivedQuantity) 
      : (this.receivedQuantity !== undefined ? Math.round(this.receivedQuantity * this.conversionRate) : undefined);
    this.discrepancyQuantity = partial.discrepancyQuantity !== undefined 
      ? Number(partial.discrepancyQuantity) 
      : (this.receivedQuantity !== undefined ? this.transferQuantity - this.receivedQuantity : 0);
    this.discrepancyReason = partial.discrepancyReason || '';
    this.notes = partial.notes || '';
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
  }
}

/**
 * Thực thể Phiếu Chuyển kho Nội bộ (SN-181)
 */
export class InternalTransferEntity {
  id: string;
  code: string;
  fromWarehouseId: string;
  fromWarehouseName: string;
  toWarehouseId: string;
  toWarehouseName: string;
  status: TransferStatus;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  /** Thời điểm xuất chuyển kho (bắt đầu trên đường) */
  transferredAt?: Date;
  /** Người xác nhận nhận hàng tại kho đến */
  receivedBy?: string;
  receivedByName?: string;
  /** Thời điểm xác nhận nhận hàng */
  receivedAt?: Date;
  /** Lý do chênh lệch chung của cả phiếu (nếu có) */
  discrepancyReason?: string;
  /** Danh sách mặt hàng */
  items: InternalTransferItemEntity[];

  constructor(partial: Partial<InternalTransferEntity>) {
    this.id = partial.id || `itf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.code = partial.code || '';
    this.fromWarehouseId = partial.fromWarehouseId || '';
    this.fromWarehouseName = partial.fromWarehouseName || '';
    this.toWarehouseId = partial.toWarehouseId || '';
    this.toWarehouseName = partial.toWarehouseName || '';
    this.status = partial.status || TransferStatus.IN_TRANSIT;
    this.notes = partial.notes || '';
    this.createdBy = partial.createdBy || '';
    this.createdByName = partial.createdByName || '';
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();
    this.updatedAt = partial.updatedAt ? new Date(partial.updatedAt) : new Date();
    this.transferredAt = partial.transferredAt ? new Date(partial.transferredAt) : undefined;
    this.receivedBy = partial.receivedBy;
    this.receivedByName = partial.receivedByName;
    this.receivedAt = partial.receivedAt ? new Date(partial.receivedAt) : undefined;
    this.discrepancyReason = partial.discrepancyReason;
    this.items = (partial.items || []).map((item) => new InternalTransferItemEntity(item));
  }
}
