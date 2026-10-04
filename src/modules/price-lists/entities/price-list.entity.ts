import { CustomerGroup } from '../../../common/enums/customer-group.enum';
import { PriceListStatus } from '../../../common/enums/price-list-status.enum';
import { PriceListItemEntity } from './price-list-item.entity';

/**
 * Entity Bảng giá B2B (PriceListEntity):
 * Quản lý chính sách giá cho các nhóm khách hàng (Đại lý cấp 1, Đại lý cấp 2, Bán lẻ),
 * hỗ trợ quản lý phiên bản (versioning) và bảo vệ dữ liệu khi đã phát sinh đơn hàng.
 */
export class PriceListEntity {
  id: string;
  code: string;
  name: string;
  customerGroup: CustomerGroup;
  startDate: string;
  endDate: string;
  status: PriceListStatus;
  version: number;
  parentVersionId: string | null;
  hasOrders: boolean;
  items: PriceListItemEntity[];
  description?: string;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<PriceListEntity>) {
    Object.assign(this, partial);
    this.version = this.version || 1;
    this.parentVersionId = this.parentVersionId ?? null;
    this.hasOrders = Boolean(this.hasOrders);
    this.items = (this.items || []).map((item) => new PriceListItemEntity(item));
    this.createdAt = this.createdAt ? new Date(this.createdAt) : new Date();
    this.updatedAt = this.updatedAt ? new Date(this.updatedAt) : new Date();
  }
}
