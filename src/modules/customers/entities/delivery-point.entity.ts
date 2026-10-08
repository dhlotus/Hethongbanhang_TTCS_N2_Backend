/**
 * Thực thể Điểm giao hàng của Đại lý (SN-31 & SN-32)
 * Bảng customer_shipping_addresses
 */
export class DeliveryPointEntity {
  id: string;
  customerId: string;
  name: string;
  address: string;
  ward?: string;
  district?: string;
  province?: string;
  receiverName: string;
  phone: string;
  roadNote?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<DeliveryPointEntity>) {
    Object.assign(this, partial);
    this.isDefault = partial.isDefault ?? false;
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();
  }
}
