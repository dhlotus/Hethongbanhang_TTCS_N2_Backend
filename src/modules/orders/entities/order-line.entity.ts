/**
 * Thực thể Một dòng hàng trong đơn hàng (SN-38)
 */
export class OrderLineEntity {
  id: string;
  orderId?: string;
  productId: string;
  productSku: string;
  productName: string;
  unit: string; // Đơn vị gọi hàng (Thùng, Lốc, Lon...)
  baseUnit: string; // Đơn vị cơ sở
  conversionRate: number; // Hệ số quy đổi sang đơn vị cơ sở
  quantity: number; // Số lượng theo unit
  baseQuantity: number; // Số lượng quy về đơn vị cơ sở = quantity * conversionRate
  unitPrice: number; // Đơn giá theo unit (sau chiết khấu)
  listPrice: number; // Giá niêm yết gốc
  discountPercent: number; // % Chiết khấu
  lineTotal: number; // Thành tiền = quantity * unitPrice
  stockAvailable?: number; // Tồn khả dụng tham khảo
  minPrice?: number; // Giá sàn theo đơn vị đặt hàng
  requiresApproval: boolean;
  deliveredQuantity?: number;
  deliveredBaseQuantity?: number;
  shortDeliveryReason?: string;
  isShortDelivery?: boolean;

  constructor(partial: Partial<OrderLineEntity>) {
    Object.assign(this, partial);
    this.conversionRate = partial.conversionRate ?? 1;
    this.quantity = partial.quantity ?? 1;
    this.baseQuantity = partial.baseQuantity ?? Math.round(this.quantity * this.conversionRate);
    this.unitPrice = partial.unitPrice ?? 0;
    this.listPrice = partial.listPrice ?? this.unitPrice;
    this.discountPercent = partial.discountPercent ?? 0;
    this.lineTotal = partial.lineTotal ?? Math.round(this.quantity * this.unitPrice);
    this.requiresApproval = partial.requiresApproval ?? false;
    this.deliveredQuantity = partial.deliveredQuantity;
    this.deliveredBaseQuantity = partial.deliveredBaseQuantity;
    this.shortDeliveryReason = partial.shortDeliveryReason;
    this.isShortDelivery = partial.isShortDelivery;
  }
}
