/**
 * Thực thể Bản ghi Sổ kho / Giao dịch kho (Inventory Transaction Ledger) - SN-23
 * Đáp ứng yêu cầu:
 * 1. Nhập xuất theo đơn vị nào (thùng, lốc, lon) cũng quy về đơn vị cơ sở khi ghi sổ.
 * 2. Lưu trữ SNAPSHOT BẤT BIẾN của hệ số quy đổi và số lượng cơ sở tại thời điểm phát sinh.
 * 3. Đổi hệ số quy đổi trong danh mục sau này KHÔNG làm sai lệch các giao dịch đã ghi trước đó.
 */
export class InventoryTransactionEntity {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  transactionType: 'IMPORT' | 'EXPORT' | 'ADJUSTMENT' | 'TRANSFER' | 'ORDER';

  // 1. Dữ liệu nhập/xuất theo đơn vị gọi hàng thực tế tại kho
  inputQuantity: number;      // Số lượng theo đơn vị gọi hàng (Ví dụ: +5 thùng hoặc -2 thùng)
  inputUnit: string;          // Tên đơn vị gọi hàng (Ví dụ: "Thùng", "Lốc", "Lon")

  // 2. SNAPSHOT BẤT BIẾN HỆ SỐ QUY ĐỔI TẠI THỜI ĐIỂM GHI SỔ
  // Lưu cứng để dù sau này SKU đổi từ 24 lon/thùng thành 30 lon/thùng thì giao dịch này vẫn giữ 24
  conversionRate: number;     // Ví dụ: 24 (1 Thùng = 24 Lon)

  // 3. SỐ LIỆU ĐÃ QUY ĐỔI VỀ ĐƠN VỊ CƠ SỞ (BASE UNIT) ĐỂ GHI SỔ TỒN KHO CHÍNH XÁC
  baseQuantityChange: number; // inputQuantity * conversionRate (Ví dụ: 5 * 24 = 120 Lon)
  baseUnit: string;           // Tên đơn vị cơ sở nhỏ nhất (Ví dụ: "Lon")

  // 4. Số liệu tồn kho cơ sở trước và sau biến động
  previousStock: number;      // Số tồn cơ sở trước giao dịch (Ví dụ: 340 Lon)
  newStock: number;           // Số tồn cơ sở sau giao dịch (Ví dụ: 460 Lon)

  reason: string;             // Lý do giao dịch (kiểm kê, nhập hàng NCC, xuất bán...)
  referenceCode: string;      // Mã chứng từ / phiếu kho (Ví dụ: "PNK-2026-001")
  warehouse: string;          // Kho thực hiện
  performedBy: string;        // ID hoặc tên người thực hiện giao dịch
  createdAt: Date;            // Thời điểm ghi sổ

  // Các trường alias tương thích với UI Frontend (SN-21 / SN-23)
  type?: 'IMPORT' | 'EXPORT' | 'ADJUSTMENT' | 'TRANSFER' | 'ORDER';
  unitName?: string;
  conversionFactor?: number;
  adjustedBy?: string;

  constructor(partial: Partial<InventoryTransactionEntity> & Record<string, unknown>) {
    this.id = (partial.id as string) || `tx-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.productId = (partial.productId || partial.product_id) as string;
    this.sku = (partial.sku as string) || '';
    this.productName = (partial.productName || partial.product_name) as string || '';
    this.transactionType = (partial.transactionType || partial.transaction_type || partial.type) as 'IMPORT' | 'EXPORT' | 'ADJUSTMENT' | 'TRANSFER' | 'ORDER' || 'ADJUSTMENT';

    this.inputQuantity = Number(partial.inputQuantity !== undefined ? partial.inputQuantity : partial.input_quantity);
    this.inputUnit = (partial.inputUnit || partial.input_unit || partial.unitName) as string || '';

    const rate = Number(partial.conversionRate !== undefined ? partial.conversionRate : (partial.conversion_rate !== undefined ? partial.conversion_rate : partial.conversionFactor));
    this.conversionRate = Number.isFinite(rate) && rate > 0 ? rate : 1;

    const baseChange = partial.baseQuantityChange !== undefined 
      ? Number(partial.baseQuantityChange) 
      : (partial.base_quantity_change !== undefined ? Number(partial.base_quantity_change) : this.inputQuantity * this.conversionRate);
    this.baseQuantityChange = Math.round(baseChange);
    this.baseUnit = (partial.baseUnit || partial.base_unit) as string || '';

    this.previousStock = Number(partial.previousStock !== undefined ? partial.previousStock : partial.previous_stock);
    this.newStock = Number(partial.newStock !== undefined ? partial.newStock : partial.new_stock);

    this.reason = (partial.reason as string) || '';
    this.referenceCode = (partial.referenceCode || partial.reference_code) as string || `PK-${Date.now().toString().slice(-6)}`;
    this.warehouse = (partial.warehouse as string) || 'Kho Tổng Miền Nam - LOHA WH01';
    this.performedBy = (partial.performedBy || partial.performed_by || partial.adjustedBy) as string || 'system';
    this.createdAt = partial.createdAt ? new Date(partial.createdAt) : new Date();

    // Đồng bộ các trường alias
    this.type = this.transactionType;
    this.unitName = this.inputUnit;
    this.conversionFactor = this.conversionRate;
    this.adjustedBy = this.performedBy;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      productId: this.productId,
      sku: this.sku,
      productName: this.productName,
      transactionType: this.transactionType,
      type: this.transactionType,
      inputQuantity: this.inputQuantity,
      inputUnit: this.inputUnit,
      unitName: this.inputUnit,
      conversionRate: this.conversionRate,
      conversionFactor: this.conversionRate,
      baseQuantityChange: this.baseQuantityChange,
      baseUnit: this.baseUnit,
      previousStock: this.previousStock,
      newStock: this.newStock,
      reason: this.reason,
      referenceCode: this.referenceCode,
      warehouse: this.warehouse,
      performedBy: this.performedBy,
      adjustedBy: this.performedBy,
      createdAt: this.createdAt.toISOString(),
    };
  }
}
