import { Injectable, NotFoundException } from '@nestjs/common';
import { DiscountTier } from './entities/discount-tier.entity';
import { DiscountPolicyEntity } from './entities/discount-policy.entity';
import { CreateDiscountPolicyDto } from './dto/create-discount-policy.dto';
import { UpdateDiscountPolicyDto } from './dto/update-discount-policy.dto';
import { DiscountPolicyStatus } from './enums/discount.enum';

@Injectable()
export class DiscountPoliciesService {
  private discountPolicies = new Map<string, DiscountPolicyEntity>();

  constructor() {
    this.seed();
  }

  private seed() {
    const defaultPolicy = new DiscountPolicyEntity({
      id: 'dp-001',
      code: 'DISC-VOL-01',
      name: 'Chiết khấu mua nhiều giảm giá (Lon)',
      targetType: 'SKU' as any,
      targetId: 'prod-001',
      targetIds: ['prod-001'],
      discountType: 'PERCENTAGE' as any,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      status: DiscountPolicyStatus.ACTIVE,
      tiers: [
        { id: 'tier-1', minQuantity: 10, maxQuantity: 49, discountValue: 2 },
        { id: 'tier-2', minQuantity: 50, maxQuantity: 99, discountValue: 5 },
        { id: 'tier-3', minQuantity: 100, maxQuantity: null, discountValue: 10 },
      ],
    });
    this.discountPolicies.set(defaultPolicy.id, defaultPolicy);

    // Keep the SN-40 sample policy for the nut milk SKU available after backend restarts.
    const nutMilkPolicy = new DiscountPolicyEntity({
      id: 'dp-205133',
      code: 'DP-205133',
      name: 'Chiết khấu sản lượng tháng 10 #1',
      targetType: 'SKU' as any,
      targetId: 'LH-NUT-180ML',
      targetIds: ['LH-NUT-180ML'],
      appliedProductSkus: ['LH-NUT-180ML'],
      discountType: 'PERCENTAGE' as any,
      startDate: '2026-10-08',
      endDate: '2027-10-08',
      status: DiscountPolicyStatus.ACTIVE,
      tiers: [
        { id: 'tier-nut-1', minQuantity: 1, maxQuantity: 10, discountValue: 0 },
        { id: 'tier-nut-2', minQuantity: 11, maxQuantity: 100, discountValue: 2 },
      ],
    });
    this.discountPolicies.set(nutMilkPolicy.id, nutMilkPolicy);
  }

  findAll(): DiscountPolicyEntity[] {
    return Array.from(this.discountPolicies.values());
  }

  findById(id: string): DiscountPolicyEntity {
    const policy = this.discountPolicies.get(id);
    if (!policy) {
      throw new NotFoundException(`Discount policy with ID ${id} not found`);
    }
    return policy;
  }

  create(dto: CreateDiscountPolicyDto): DiscountPolicyEntity {
    const policy = new DiscountPolicyEntity({
      ...dto,
      tiers: dto.tiers.map((t) => new DiscountTier(t as any)),
    });
    this.discountPolicies.set(policy.id, policy);
    return policy;
  }

  update(id: string, dto: UpdateDiscountPolicyDto): DiscountPolicyEntity {
    const policy = this.findById(id);
    
    if (dto.code) policy.code = dto.code;
    if (dto.name) policy.name = dto.name;
    if (dto.targetType) policy.targetType = dto.targetType;
    if (dto.targetIds) {
      policy.targetIds = dto.targetIds;
      policy.targetId = dto.targetId || dto.targetIds.join(', ');
    } else if (dto.targetId) {
      policy.targetId = dto.targetId;
      policy.targetIds = [dto.targetId];
    }
    if (dto.appliedCategoryIds !== undefined) policy.appliedCategoryIds = dto.appliedCategoryIds;
    if (dto.appliedProductSkus !== undefined) policy.appliedProductSkus = dto.appliedProductSkus;
    if (dto.discountType) policy.discountType = dto.discountType;
    if (dto.startDate) policy.startDate = dto.startDate;
    if (dto.endDate) policy.endDate = dto.endDate;
    if (dto.status) policy.status = dto.status;
    if (dto.tiers) {
      policy.tiers = dto.tiers.map(t => ({
        id: `tier-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        ...t
      }));
    }
    policy.updatedAt = new Date();
    
    return policy;
  }

  remove(id: string): void {
    const policy = this.findById(id);
    this.discountPolicies.delete(policy.id);
  }

  calculateBestDiscount(
    productId: string,
    categoryId: string,
    quantity: number,
    productSku?: string,
  ): number {
    const now = new Date().toISOString();
    const activePolicies = Array.from(this.discountPolicies.values()).filter(
      p => {
        if (p.status !== DiscountPolicyStatus.ACTIVE || p.startDate > now || p.endDate < now) {
          return false;
        }
        const matchesProduct = [productId, productSku].some(
          (identifier) => Boolean(identifier) && (
            p.appliedProductSkus?.includes(identifier!) ||
            (p.targetType === 'SKU' && (
              p.targetIds?.includes(identifier!) ||
              p.targetId.split(',').map((target) => target.trim()).includes(identifier!)
            ))
          ),
        );
        const matchesCategory = (p.appliedCategoryIds && p.appliedCategoryIds.includes(categoryId)) ||
                                (p.targetType === 'CATEGORY' && (p.targetIds?.includes(categoryId) || p.targetId === categoryId));
        const matchesHybrid = (p.targetType as any) === 'HYBRID' && (matchesProduct || matchesCategory);
        return matchesProduct || matchesCategory || matchesHybrid;
      }
    );

    let maxDiscountPercent = 0;
    
    for (const policy of activePolicies) {
      const applicableTier = policy.tiers.find(
        t => quantity >= t.minQuantity && (t.maxQuantity === null || quantity <= t.maxQuantity)
      );
      if (applicableTier) {
        if (policy.discountType === 'PERCENTAGE' && applicableTier.discountValue > maxDiscountPercent) {
          maxDiscountPercent = applicableTier.discountValue;
        }
      }
    }

    return maxDiscountPercent;
  }
}
