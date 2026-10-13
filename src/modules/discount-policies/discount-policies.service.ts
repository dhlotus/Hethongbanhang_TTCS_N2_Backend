import { Injectable, NotFoundException, Optional, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DiscountTier } from './entities/discount-tier.entity';
import { DiscountPolicyEntity } from './entities/discount-policy.entity';
import { CreateDiscountPolicyDto } from './dto/create-discount-policy.dto';
import { UpdateDiscountPolicyDto } from './dto/update-discount-policy.dto';
import { DiscountPolicyStatus } from './enums/discount.enum';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class DiscountPoliciesService implements OnModuleInit {
  private discountPolicies = new Map<string, DiscountPolicyEntity>();

  constructor(@Optional() private readonly databaseService?: DatabaseService) {
    this.seed();
    this.loadPoliciesFromDisk();
  }

  async onModuleInit(): Promise<void> {
    if (this.discountPolicies.size === 0) {
      this.seed();
    }
    this.loadPoliciesFromDisk();
    if (this.databaseService?.isConnected()) {
      await this.initDatabaseSchemaAndLoad();
    }
  }

  private getStorageFilePath(): string {
    const dataDir = path.join(process.cwd(), 'uploads', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'discount_policies.json');
  }

  private loadPoliciesFromDisk(): void {
    try {
      const filePath = this.getStorageFilePath();
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) return;
      const rawList: Array<Partial<DiscountPolicyEntity>> = JSON.parse(content);
      for (const item of rawList) {
        if (!item.id) continue;
        const existing = this.discountPolicies.get(item.id);
        if (existing) {
          Object.assign(existing, item);
        } else {
          this.discountPolicies.set(item.id, new DiscountPolicyEntity(item as any));
        }
      }
    } catch (err) {
      console.warn('[DISCOUNT_POLICIES] Lỗi khi nạp chính sách chiết khấu từ đĩa:', err);
    }
  }

  private savePoliciesToDisk(): void {
    try {
      const filePath = this.getStorageFilePath();
      const list = Array.from(this.discountPolicies.values());
      fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[DISCOUNT_POLICIES] Lỗi khi lưu chính sách chiết khấu ra đĩa:', err);
    }
  }

  private async initDatabaseSchemaAndLoad(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS app_discount_policies (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_app_discount_policies_created_at
          ON app_discount_policies(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_app_discount_policies_code
          ON app_discount_policies(code);
      `);

      const countRes = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM app_discount_policies;`,
      );
      const totalCount = parseInt(countRes[0]?.count || '0', 10);

      if (totalCount === 0) {
        // Nạp toàn bộ dữ liệu ban đầu từ memory vào PostgreSQL
        for (const policy of this.discountPolicies.values()) {
          await this.savePolicyToDb(policy);
        }
      } else {
        // Tải các chính sách từ PostgreSQL lên Map
        const rows = await this.databaseService.query<{ payload: any }>(
          `SELECT payload FROM app_discount_policies ORDER BY created_at ASC;`,
        );
        for (const row of rows) {
          if (row.payload && row.payload.id) {
            this.discountPolicies.set(
              row.payload.id,
              new DiscountPolicyEntity(row.payload),
            );
          }
        }
        this.savePoliciesToDisk();
      }
    } catch (err) {
      console.warn('[DISCOUNT_POLICIES] Lỗi khởi tạo bảng PostgreSQL:', err);
    }
  }

  private async savePolicyToDb(policy: DiscountPolicyEntity): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(
        `INSERT INTO app_discount_policies (id, code, name, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT (id) DO UPDATE
         SET code = EXCLUDED.code,
             name = EXCLUDED.name,
             payload = EXCLUDED.payload,
             updated_at = EXCLUDED.updated_at;`,
        [
          policy.id,
          policy.code,
          policy.name,
          JSON.stringify(policy),
          policy.createdAt || new Date(),
          policy.updatedAt || new Date(),
        ],
      );
    } catch (err) {
      console.warn('[DISCOUNT_POLICIES] Lỗi khi lưu chính sách vào DB:', err);
    }
  }

  private async deletePolicyFromDb(id: string): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(
        `DELETE FROM app_discount_policies WHERE id = $1;`,
        [id],
      );
    } catch (err) {
      console.warn('[DISCOUNT_POLICIES] Lỗi khi xóa chính sách khỏi DB:', err);
    }
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

  async create(dto: CreateDiscountPolicyDto): Promise<DiscountPolicyEntity> {
    const policy = new DiscountPolicyEntity({
      ...dto,
      tiers: dto.tiers.map((t) => new DiscountTier(t as any)),
    });
    this.discountPolicies.set(policy.id, policy);
    this.savePoliciesToDisk();
    await this.savePolicyToDb(policy);
    return policy;
  }

  async update(id: string, dto: UpdateDiscountPolicyDto): Promise<DiscountPolicyEntity> {
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
    this.savePoliciesToDisk();
    await this.savePolicyToDb(policy);
    
    return policy;
  }

  async remove(id: string): Promise<void> {
    const policy = this.findById(id);
    this.discountPolicies.delete(policy.id);
    this.savePoliciesToDisk();
    await this.deletePolicyFromDb(policy.id);
  }

  calculateBestDiscount(
    productId: string,
    categoryId: string,
    quantity: number,
    productSku?: string,
    productName?: string,
  ): number {
    if (quantity <= 0) return 0;

    const today = new Date().toISOString().split('T')[0];

    // BƯỚC 1: LỌC TẤT CẢ CÁC CHÍNH SÁCH ĐANG HIỆU LỰC (ACTIVE) VÀ TRONG THỜI HẠN
    // Các chính sách INACTIVE hoặc hết hạn bị loại bỏ ngay lập tức tại đây!
    const activePolicies = Array.from(this.discountPolicies.values()).filter(
      (p) => {
        // Chỉ chấp nhận chính sách ĐANG HIỆU LỰC (ACTIVE)
        if (p.status !== DiscountPolicyStatus.ACTIVE) return false;
        if (p.startDate && p.startDate.split('T')[0] > today) return false;
        if (p.endDate && p.endDate.split('T')[0] < today) return false;

        return this.isProductMatchingPolicy(p, productId, productSku, categoryId, productName);
      },
    );

    // BƯỚC 2: NẾU KHÔNG CÓ CHÍNH SÁCH NÀO ĐANG HIỆU LỰC CHO SẢN PHẨM NÀY -> 0%
    if (activePolicies.length === 0) {
      return 0;
    }

    // BƯỚC 3: DUYỆT TẤT CẢ CÁC MÃ ĐANG HIỆU LỰC, TÍNH ƯU ĐÃI VÀ CHỌN CHÍNH SÁCH CÓ ƯU ĐÃI TỐT NHẤT (CAO NHẤT)
    let bestDiscountPercent = 0;

    for (const policy of activePolicies) {
      if (!policy.tiers || policy.tiers.length === 0) continue;

      // 1. Sắp xếp các nấc theo Q_min tăng dần
      const sortedTiers = [...policy.tiers].sort(
        (a, b) => (Number(a.minQuantity) || 0) - (Number(b.minQuantity) || 0),
      );

      // 2. Tìm các nấc thỏa mãn: Quantity >= Q_min VÀ (Quantity <= Q_max HOẶC Q_max rỗng/0/null/undefined/Infinity)
      const matchedTiers = sortedTiers.filter((t) => {
        const min = Number(t.minQuantity) || 0;
        const rawMax = t.maxQuantity;
        const max =
          rawMax !== null && rawMax !== undefined && String(rawMax).trim() !== ''
            ? Number(rawMax)
            : null;

        if (quantity < min) return false;
        if (max === null || isNaN(max) || max <= 0 || max === Infinity) return true;
        return quantity <= max;
      });

      // 3. Lấy nấc thỏa mãn có Q_min cao nhất trong chính sách này
      const applicableTier = matchedTiers.length > 0 ? matchedTiers[matchedTiers.length - 1] : null;

      if (applicableTier) {
        const val = Number(applicableTier.discountValue) || 0;
        // So sánh để chọn ưu đãi tốt hơn (cao nhất) giữa các chính sách
        if ((policy.discountType === 'PERCENTAGE' || !policy.discountType) && val > bestDiscountPercent) {
          bestDiscountPercent = val;
        }
      }
    }

    return bestDiscountPercent;
  }

  /**
   * Kiểm tra xem sản phẩm có nằm trong phạm vi áp dụng của chính sách hay không
   */
  private isProductMatchingPolicy(
    policy: DiscountPolicyEntity,
    productId: string,
    productSku?: string,
    categoryId?: string,
    productName?: string,
  ): boolean {
    // Thu thập toàn bộ targets được chỉ định trong chính sách
    const targets = new Set<string>();
    (policy.targetIds || []).forEach((t) => targets.add(t.trim().toUpperCase()));
    if (policy.targetId) {
      policy.targetId.split(',').forEach((t) => targets.add(t.trim().toUpperCase()));
    }
    (policy.appliedCategoryIds || []).forEach((t) => targets.add(t.trim().toUpperCase()));
    (policy.appliedProductSkus || []).forEach((t) => targets.add(t.trim().toUpperCase()));

    // 1. Áp dụng cho toàn bộ sản phẩm nếu targets có 'ALL' hoặc rỗng hoàn toàn
    if (targets.has('ALL') || targets.size === 0) {
      return true;
    }

    // 2. Thu thập toàn bộ định danh và nhóm ngành hàng của sản phẩm
    const productKeys = new Set<string>();
    if (productId) productKeys.add(productId.trim().toUpperCase());
    if (productSku) productKeys.add(productSku.trim().toUpperCase());
    if (categoryId) productKeys.add(categoryId.trim().toUpperCase());
    if (productName) productKeys.add(productName.trim().toUpperCase());

    // Nhận diện phân loại ngành hàng theo chuỗi đa chiều: SKU + ID + Ngành hàng + Tên sản phẩm
    const searchStr = `${productSku || ''} ${productId || ''} ${categoryId || ''} ${productName || ''}`.toUpperCase();

    if (searchStr.includes('MILK') || searchStr.includes('SỮA')) {
      productKeys.add('MILK');
      productKeys.add('MILK_POWDER');
      productKeys.add('CAT-MILK-POWDER');
      productKeys.add('MILK_READY');
      productKeys.add('MILK_NUT');
      productKeys.add('CAT-MILK-NUT');
    }
    if (
      searchStr.includes('NUT') ||
      searchStr.includes('HẠT') ||
      searchStr.includes('ÓC CHÓ') ||
      searchStr.includes('HẠNH NHÂN') ||
      searchStr.includes('MACCA') ||
      searchStr.includes('ĐẬU')
    ) {
      productKeys.add('MILK_NUT');
      productKeys.add('MILK');
      productKeys.add('CEREAL_NUTS');
      productKeys.add('CEREAL');
      productKeys.add('CAT-MILK-NUT');
      productKeys.add('CAT-CEREAL-NUTS');
    }
    if (searchStr.includes('NEST') || searchStr.includes('YẾN')) {
      productKeys.add('NEST');
      productKeys.add('NEST_READY');
      productKeys.add('NEST_PURE');
      productKeys.add('CAT-NEST-READY');
      productKeys.add('CAT-NEST-PURE');
    }
    if (searchStr.includes('CEREAL') || searchStr.includes('NGŨ CỐC')) {
      productKeys.add('CEREAL');
      productKeys.add('CEREAL_SPROUT');
      productKeys.add('CEREAL_NUTS');
      productKeys.add('CAT-CEREAL-SPROUT');
      productKeys.add('CAT-CEREAL-NUTS');
    }
    if (
      searchStr.includes('COLLAGEN') ||
      searchStr.includes('SUPP') ||
      searchStr.includes('ĐÔNG TRÙNG') ||
      searchStr.includes('THỰC PHẨM CHỨC NĂNG')
    ) {
      productKeys.add('SUPP');
      productKeys.add('SUPP_COLLAGEN');
      productKeys.add('SUPP_HERB');
      productKeys.add('CAT-SUPP-COLLAGEN');
    }
    if (
      searchStr.includes('TEA') ||
      searchStr.includes('WATER') ||
      searchStr.includes('COLA') ||
      searchStr.includes('ORANGE') ||
      searchStr.includes('BEVERAGE') ||
      searchStr.includes('COFFEE') ||
      searchStr.includes('TRÀ') ||
      searchStr.includes('KHOÁNG') ||
      searchStr.includes('NƯỚC') ||
      searchStr.includes('NƯỚC GIẢI KHÁT')
    ) {
      productKeys.add('BEVERAGE');
      productKeys.add('CARBONATED');
      productKeys.add('WATER');
      productKeys.add('TEA_JUICE');
      productKeys.add('COLA_CAN');
      productKeys.add('ORANGE_CAN');
      productKeys.add('PURE_BOTTLE');
      productKeys.add('GREEN_TEA');
    }

    // 3. Khớp nếu có bất kỳ giao điểm nào giữa policy targets và productKeys
    for (const key of productKeys) {
      if (targets.has(key)) return true;
    }

    // 4. Khớp từng từ khóa trong targets nếu xuất hiện trong searchStr
    for (const target of targets) {
      if (target && target.length >= 3 && searchStr.includes(target)) {
        return true;
      }
    }

    return false;
  }
}
