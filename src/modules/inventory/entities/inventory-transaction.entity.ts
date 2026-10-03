/**
 * Entity Bản ghi Giao dịch Sổ kho (SN-148 / EP-04 / Historical Ledger)
 * Lưu trữ snapshot đóng băng của hệ số quy đổi và số lượng cơ sở tại thời điểm phát sinh.
 * Đảm bảo nguyên tắc: Đổi hệ số quy đổi trong tương lai hoàn toàn KHÔNG làm sai lệch giao dịch đã ghi.
 */
export class InventoryTransactionEntity {
  /** Mã định danh giao dịch sổ kho */
  id: string;

  /** Mã SKU sản phẩm */
  sku: string;

  /** Tên sản phẩm */
  productName: string;

  /** Mã đơn vị tính thao tác */
  unitId?: string;

  /** Tên đơn vị tính tại thời điểm giao dịch (VD: Thùng, Lốc, Lon) */
  unitName: string;

  /** Số lượng theo quy cách đóng gói (VD: 5 Thùng) */
  packageQuantity: number;

  /**
   * Hệ số quy đổi đóng băng tại thời điểm giao dịch (VD: 24).
   * Không bao giờ bị cập nhật lại khi bảng product_units thay đổi sau này.
   */
  conversionFactor: number;

  /**
   * Số lượng quy về đơn vị cơ sở để ghi sổ tồn kho (VD: 5 * 24 = 120 Lon).
   */
  baseQuantityChange: number;

  /** Đơn vị tính cơ sở nhỏ nhất (VD: Lon) */
  baseUnit: string;

  /** Số lượng tồn trước khi điều chỉnh (theo đơn vị cơ sở) */
  previousQuantity: number;

  /** Số lượng tồn sau khi điều chỉnh (theo đơn vị cơ sở) */
  newQuantity: number;

  /** Lý do điều chỉnh / ghi sổ kho */
  reason: string;

  /** Người thực hiện (userId) */
  adjustedBy: string;

  /** Thời điểm ghi sổ (ISO Timestamp) */
  timestamp: string;

  constructor(partial: Partial<InventoryTransactionEntity>) {
    Object.assign(this, partial);
    if (!this.id) {
      this.id = `txn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    }
    if (!this.timestamp) {
      this.timestamp = new Date().toISOString();
    }
  }
}
