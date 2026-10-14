import { OrderStatus } from '../entities/order-status.enum';

/** Hằng số phạm vi thời gian lịch sử mua hàng (AC1) */
export const LOOKBACK_MONTHS = 3;

/**
 * Mặt hàng gợi ý theo lịch sử mua hàng 3 tháng gần nhất (SN-43 AC1)
 */
export interface SuggestedProductItem {
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  baseUnit: string;
  conversionRate: number;
  price: number;
  totalQuantity: number;
  orderCount: number;
  averageQuantity: number;
  lastPurchasedAt: string;
  lastPurchasedQuantity: number;
}

/**
 * Một dòng hàng trong đơn hàng gần nhất (SN-43 AC2)
 */
export interface LatestOrderItem {
  productId: string;
  sku: string;
  productName: string;
  unit: string;
  baseUnit: string;
  conversionRate: number;
  quantity: number;
  unitPrice: number;
  listPrice: number;
  discountPercent: number;
  lineTotal: number;
}

/**
 * Tóm tắt đơn hàng thành công gần nhất của đại lý (SN-43 AC2)
 */
export interface LatestOrderSummary {
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  deliveryDate?: string;
  status: OrderStatus;
  subtotal: number;
  totalDiscount: number;
  grandTotal: number;
  createdAt: string;
  note?: string;
  items: LatestOrderItem[];
}

/**
 * Phản hồi chi tiết lịch sử mua hàng và gợi ý đơn hàng (SN-43)
 */
export interface CustomerPurchaseHistoryResponse {
  customerId: string;
  customerCode: string;
  customerName: string;
  lookbackMonths: number;
  totalOrdersInPeriod: number;
  suggestions: SuggestedProductItem[];
  latestOrder: LatestOrderSummary | null;
}
