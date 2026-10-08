import { DiscountPolicyStatus, DiscountTargetType, DiscountType } from '../enums/discount.enum';
import { DiscountTier } from './discount-tier.entity';

export class DiscountPolicyEntity {
  id: string;
  code: string;
  name: string;
  targetType: DiscountTargetType;
  targetId: string; // productId or categoryId fallback
  targetIds: string[]; // multi-select product or category IDs/codes
  appliedCategoryIds?: string[];
  appliedProductSkus?: string[];
  discountType: DiscountType;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  status: DiscountPolicyStatus;
  tiers: DiscountTier[];
  createdAt: Date;
  updatedAt: Date;

  constructor(partial: Partial<DiscountPolicyEntity>) {
    Object.assign(this, partial);
    if (!this.id) {
      this.id = `dp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    }
    this.appliedCategoryIds = partial.appliedCategoryIds || [];
    this.appliedProductSkus = partial.appliedProductSkus || [];
    if (partial.targetIds && Array.isArray(partial.targetIds)) {
      this.targetIds = partial.targetIds;
      this.targetId = partial.targetId || partial.targetIds.join(', ');
    } else if (partial.targetId) {
      this.targetId = partial.targetId;
      this.targetIds = partial.targetId.split(',').map(s => s.trim()).filter(Boolean);
    } else {
      this.targetIds = [...this.appliedCategoryIds, ...this.appliedProductSkus];
      this.targetId = this.targetIds.join(', ');
    }
    if (partial.tiers) {
      this.tiers = partial.tiers.map((t) => new DiscountTier(t));
    } else {
      this.tiers = [];
    }
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
  }
}
