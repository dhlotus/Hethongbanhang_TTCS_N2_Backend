import { CustomerGroup } from '../enums/customer-group.enum';
import { PriceListStatus } from '../enums/price-list-status.enum';
import { PriceListItemEntity } from './price-list-item.entity';

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
  createdAt: Date | string;
  updatedAt: Date | string;

  constructor(partial: Partial<PriceListEntity>) {
    Object.assign(this, partial);
    this.version = this.version ?? 1;
    this.parentVersionId = this.parentVersionId ?? null;
    this.hasOrders = this.hasOrders ?? false;
    this.items = (this.items || []).map((it) =>
      it instanceof PriceListItemEntity ? it : new PriceListItemEntity(it),
    );
  }
}
