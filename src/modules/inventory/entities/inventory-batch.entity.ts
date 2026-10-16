/**
 * Thực thể Lô hàng tồn kho và Hạn sử dụng (Bảng inventory_batches - SN-184)
 * Quản lý theo dõi hạn sử dụng, tính toán số ngày còn lại và cảnh báo cận hạn theo chuẩn FEFO.
 */
export class InventoryBatchEntity {
  id: string;
  batchNumber: string;
  productId: string;
  productSku: string;
  productName: string;
  categoryName?: string;
  warehouseId: string;
  warehouseName: string;
  locationId?: string;
  locationCode?: string;
  baseUnit: string;
  mfgDate?: string;
  expiryDate: string;
  quantity: number;
  allocatedQuantity: number;
  availableQuantity: number;
  costPrice: number;
  daysRemaining: number;
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
  createdAt: Date;
  updatedAt: Date;

  constructor(
    partial: Partial<InventoryBatchEntity> | Record<string, unknown>,
    thresholdDays = 30,
  ) {
    const raw = partial as Partial<InventoryBatchEntity> & Record<string, unknown>;
    this.id = String(raw.id || '');
    this.batchNumber = String(raw.batchNumber || raw.batch_number || '');
    this.productId = String(raw.productId || raw.product_id || '');
    this.productSku = String(raw.productSku || raw.product_sku || raw.sku || '');
    this.productName = String(raw.productName || raw.product_name || raw.name || '');
    this.categoryName = (raw.categoryName || raw.category_name) as string | undefined;
    this.warehouseId = String(raw.warehouseId || raw.warehouse_id || '');
    this.warehouseName = String(raw.warehouseName || raw.warehouse_name || '');
    this.locationId = (raw.locationId || raw.location_id) as string | undefined;
    this.locationCode = (raw.locationCode || raw.location_code) as string | undefined;
    this.baseUnit = String(raw.baseUnit || raw.base_unit || 'Đơn vị');
    
    // Ngày sản xuất & Hạn sử dụng
    this.mfgDate = raw.mfgDate ? String(raw.mfgDate).split('T')[0] : (raw.mfg_date ? String(raw.mfg_date).split('T')[0] : undefined);
    this.expiryDate = raw.expiryDate ? String(raw.expiryDate).split('T')[0] : (raw.expiry_date ? String(raw.expiry_date).split('T')[0] : '');

    // Tồn kho
    this.quantity = Number(raw.quantity ?? 0);
    this.allocatedQuantity = Number(raw.allocatedQuantity ?? raw.allocated_quantity ?? 0);
    this.availableQuantity = Math.max(0, this.quantity - this.allocatedQuantity);
    this.costPrice = Number(raw.costPrice ?? raw.cost_price ?? 0);

    // Tính toán số ngày còn lại (Days Remaining)
    if (this.expiryDate) {
      const expTime = new Date(`${this.expiryDate}T23:59:59Z`).getTime();
      const nowTime = Date.now();
      const diffMs = expTime - nowTime;
      this.daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    } else {
      this.daysRemaining = 999;
    }

    // Xác định trạng thái nghiệp vụ
    if (this.daysRemaining < 0) {
      this.status = 'EXPIRED';
    } else if (this.daysRemaining <= thresholdDays) {
      this.status = 'EXPIRING_SOON';
    } else {
      this.status = 'VALID';
    }

    const rawCreatedAt = raw.createdAt || raw.created_at;
    this.createdAt = rawCreatedAt ? new Date(String(rawCreatedAt)) : new Date();

    const rawUpdatedAt = raw.updatedAt || raw.updated_at;
    this.updatedAt = rawUpdatedAt ? new Date(String(rawUpdatedAt)) : new Date();
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      batchNumber: this.batchNumber,
      batch_number: this.batchNumber,
      productId: this.productId,
      product_id: this.productId,
      productSku: this.productSku,
      product_sku: this.productSku,
      sku: this.productSku,
      productName: this.productName,
      product_name: this.productName,
      name: this.productName,
      categoryName: this.categoryName,
      category_name: this.categoryName,
      warehouseId: this.warehouseId,
      warehouse_id: this.warehouseId,
      warehouseName: this.warehouseName,
      warehouse_name: this.warehouseName,
      locationId: this.locationId,
      location_id: this.locationId,
      locationCode: this.locationCode,
      location_code: this.locationCode,
      baseUnit: this.baseUnit,
      base_unit: this.baseUnit,
      mfgDate: this.mfgDate,
      mfg_date: this.mfgDate,
      expiryDate: this.expiryDate,
      expiry_date: this.expiryDate,
      quantity: this.quantity,
      allocatedQuantity: this.allocatedQuantity,
      allocated_quantity: this.allocatedQuantity,
      availableQuantity: this.availableQuantity,
      available_quantity: this.availableQuantity,
      costPrice: this.costPrice,
      cost_price: this.costPrice,
      daysRemaining: this.daysRemaining,
      days_remaining: this.daysRemaining,
      status: this.status,
      createdAt: this.createdAt,
      created_at: this.createdAt,
      updatedAt: this.updatedAt,
      updated_at: this.updatedAt,
    };
  }
}
