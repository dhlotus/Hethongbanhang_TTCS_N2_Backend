/**
 * Sổ tồn hiện tại theo SKU tại một kho (SN-183: cảnh báo tồn tối thiểu).
 */
export interface StockBalance {
  sku: string;
  name: string;
  /** Tồn khả dụng = tồn thực tế - đang giữ cho đơn */
  stockQuantity: number;
  physicalStockQuantity: number;
  reservedQuantity: number;
  baseUnit: string;
  units: Array<{ unitName: string; conversionRate: number; isBaseUnit: boolean }>;
  warehouse: string;
  warehouseId: string;
  /** Mức tồn tối thiểu (0 = không cảnh báo) */
  minStockLevel?: number;
  /** Cờ phái sinh: stockQuantity <= minStockLevel && minStockLevel > 0 */
  isBelowMinStock?: boolean;
}

export interface LowStockAlert extends StockBalance {
  minStockLevel: number;
  isBelowMinStock: true;
  /** Số lượng hụt so với mức tối thiểu */
  shortage: number;
}
