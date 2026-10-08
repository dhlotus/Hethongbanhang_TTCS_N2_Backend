import { DeliveryPointEntity } from './delivery-point.entity';

/**
 * Trạng thái Đại lý
 */
export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED',
  INACTIVE = 'INACTIVE',
}

/**
 * Thực thể Đại lý / Khách hàng B2B (SN-31 & SN-38)
 * Bảng customers
 */
export class CustomerEntity {
  id: string;
  code: string;
  name: string;
  taxCode?: string;
  customerGroup: string;
  region?: string;
  salesRepId?: string;
  salesRepName?: string;
  creditLimit: number;
  currentDebt: number;
  maxDebtDays: number;
  phone: string;
  email?: string;
  address?: string;
  status: CustomerStatus;
  lockReason?: string;
  lockedAt?: Date;
  lockedBy?: string;
  deliveryPoints: DeliveryPointEntity[];
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<CustomerEntity>) {
    Object.assign(this, partial);
    this.creditLimit = partial.creditLimit ?? 0;
    this.currentDebt = partial.currentDebt ?? 0;
    this.maxDebtDays = partial.maxDebtDays ?? 30;
    this.status = partial.status ?? CustomerStatus.ACTIVE;
    this.lockReason = partial.lockReason;
    this.lockedAt = partial.lockedAt ? new Date(partial.lockedAt) : undefined;
    this.lockedBy = partial.lockedBy;
    this.deliveryPoints = (partial.deliveryPoints || []).map(
      (dp) => (dp instanceof DeliveryPointEntity ? dp : new DeliveryPointEntity(dp)),
    );
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();
  }
}
