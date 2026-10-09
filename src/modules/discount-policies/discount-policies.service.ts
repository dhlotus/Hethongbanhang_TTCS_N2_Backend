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
        { id: 'tier-3', minQuantity: 100, maxQuantity: 2000, discountValue: 10 },
        { id: 'tier-4', minQuantity: 2001, maxQuantity: null, discountValue: 25 },
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
    const today = new Date().toISOString().split('T')[0];
    const activePolicies = Array.from(this.discountPolicies.values()).filter(
      p => {
        if (p.status !== DiscountPolicyStatus.ACTIVE) return false;
        if (p.startDate && p.startDate.split('T')[0] > today) return false;
        if (p.endDate && p.endDate.split('T')[0] < today) return false;

        const productIdentifiers = [productId, productSku].filter(Boolean) as string[];
        const policyTargetIds = (p.targetIds?.length ? p.targetIds : p.targetId.split(','))
          .map((target) => target.trim());
        const matchesProduct =
          p.appliedProductSkus?.includes('all') ||
          productIdentifiers.some((identifier) =>
            p.appliedProductSkus?.includes(identifier) || policyTargetIds.includes(identifier),
          ) ||
          (!p.targetId && policyTargetIds.length === 0 && (!p.appliedProductSkus || p.appliedProductSkus.length === 0));
        const matchesCategory =
          p.appliedCategoryIds?.includes('all') ||
          p.appliedCategoryIds?.includes(categoryId) ||
          ((p.targetType === 'CATEGORY' || (p.targetType as any) === 'HYBRID') &&
            (policyTargetIds.includes(categoryId) || p.targetId === categoryId));
        const matchesHybrid = (p.targetType as any) === 'HYBRID' && (matchesProduct || matchesCategory);
        return matchesProduct || matchesCategory || matchesHybrid;
      }
    );

    let maxDiscountPercent = 0;
    
    for (const policy of activePolicies) {
      if (!policy.tiers || policy.tiers.length === 0) continue;

      // 1. Sắp xếp các nấc theo Q_min tăng dần
      const sortedTiers = [...policy.tiers].sort((a, b) => (Number(a.minQuantity) || 0) - (Number(b.minQuantity) || 0));

      // 2. Tìm các nấc thỏa mãn: Quantity >= Q_min VÀ (Quantity <= Q_max HOẶC Q_max rỗng/0/null/undefined/Infinity)
      const matchedTiers = sortedTiers.filter(t => {
        const min = Number(t.minQuantity) || 0;
        const rawMax = t.maxQuantity;
        const max = rawMax !== null && rawMax !== undefined && String(rawMax).trim() !== '' ? Number(rawMax) : null;

        if (quantity < min) return false;
        if (max === null || isNaN(max) || max <= 0 || max === Infinity) return true;
        return quantity <= max;
      });

      // 3. Lấy nấc thỏa mãn có Q_min cao nhất (nấc cuối cùng sau khi sort tăng dần)
      const applicableTier = matchedTiers.length > 0 ? matchedTiers[matchedTiers.length - 1] : null;

      if (applicableTier) {
        const val = Number(applicableTier.discountValue) || 0;
        if ((policy.discountType === 'PERCENTAGE' || !policy.discountType) && val > maxDiscountPercent) {
          maxDiscountPercent = val;
        }
      }
    }

    // Chỉ dùng mức mặc định khi không có chính sách nào áp dụng cho SKU này.
    // >= 2001: 25% | >= 100: 10% | >= 50: 5% | >= 10: 2%
    if (activePolicies.length === 0) {
      if (quantity >= 2001) maxDiscountPercent = 25;
      else if (quantity >= 100) maxDiscountPercent = 10;
      else if (quantity >= 50) maxDiscountPercent = 5;
      else if (quantity >= 10) maxDiscountPercent = 2;
    }

    return maxDiscountPercent;
  }
}
