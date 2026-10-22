/**
 * Entity & Interfaces cho Module Phiếu Soạn Hàng Kho (SN-194 / SN-186)
 * Quản lý Wave Picking, gom đơn và sắp xếp đường đi S-Shape trong kho
 */

export type PickingItemStatus = 'PENDING' | 'PICKED' | 'SHORT_PICKED';

export type PickingSheetStatus = 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'CANCELLED';

export type ShortPickReasonCode =
  | 'DAMAGED_GOODS'
  | 'INSUFFICIENT_STOCK'
  | 'EXPIRED_OR_NEAR_EXPIRY'
  | 'LOCATION_MISMATCH'
  | 'OTHER';

export interface ShortPickReasonOption {
  code: ShortPickReasonCode;
  label: string;
  description: string;
}

export const SHORT_PICK_REASONS: ShortPickReasonOption[] = [
  {
    code: 'DAMAGED_GOODS',
    label: 'Hàng hư hỏng / Bể vỡ / Móp méo',
    description: 'Sản phẩm tại vị trí kệ bị rách bao bì, móp méo hoặc chảy nước không đủ tiêu chuẩn xuất',
  },
  {
    code: 'INSUFFICIENT_STOCK',
    label: 'Tồn kho thực tế không đủ',
    description: 'Số lượng thực tế tại ô kệ ít hơn số lượng ghi nhận trên hệ thống',
  },
  {
    code: 'EXPIRED_OR_NEAR_EXPIRY',
    label: 'Hàng cận hạn sử dụng (Cận Date)',
    description: 'Lô hàng không thỏa mãn điều kiện hạn sử dụng cam kết với khách hàng',
  },
  {
    code: 'LOCATION_MISMATCH',
    label: 'Vị trí sai / Không tìm thấy hàng',
    description: 'Không tìm thấy sản phẩm tại vị trí chỉ định trên đường đi soạn hàng',
  },
  {
    code: 'OTHER',
    label: 'Lý do khác (Nhập chi tiết)',
    description: 'Trường hợp đặc biệt khác cần ghi chú cụ thể',
  },
];

export interface WarehouseLocationDetail {
  zone: string;
  aisle: string;
  rack: string;
  shelf: string;
  bin: string;
  formattedCode: string;
  sortIndex: number;
  isConfigured?: boolean;
  hasMultipleLocations?: boolean;
  multipleLocations?: Array<{
    code: string;
    zone: string;
    aisle: string;
    rack: string;
    shelf: string;
    bin: string;
    batchNumber?: string;
    quantity?: number;
  }>;
}

export interface OrderAllocationItem {
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  requiredQuantity: number;
  pickedQuantity: number;
  unit: string;
}

export interface PickingLineItem {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  category?: string;
  unit: string;
  baseUnit: string;
  conversionRate: number;
  location: WarehouseLocationDetail;
  stepNumber: number;
  totalRequiredQuantity: number;
  totalPickedQuantity: number;
  status: PickingItemStatus;
  shortPickReason?: string;
  shortPickReasonCode?: ShortPickReasonCode;
  notes?: string;
  orders: OrderAllocationItem[];
  completedAt?: string;
  selectedBatches?: Array<{
    batchId: string;
    batchCode: string;
    expiryDate: string;
    quantity: number;
  }>;
  isOverrideBatch?: boolean;
  batchOverrideReason?: string;
  batchOverrideReasonCode?: string;
}

export class PickingSheetEntity {
  id: string;
  sheetCode: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  sourceOrderIds: string[];
  sourceOrderCodes: string[];
  orderCount: number;
  status: PickingSheetStatus;
  pickerId?: string;
  pickerName: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  items: PickingLineItem[];
  totalLines: number;
  pickedLines: number;
  totalRequiredQuantity: number;
  totalPickedQuantity: number;
  note?: string;
}
