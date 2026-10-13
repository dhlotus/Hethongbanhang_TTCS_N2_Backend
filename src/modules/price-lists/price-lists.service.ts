import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { CustomerGroup } from '../../common/enums/customer-group.enum';
import { PriceListStatus } from '../../common/enums/price-list-status.enum';
import { ClonePriceListDto } from './dto/clone-price-list.dto';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { GetPriceListsFilterDto } from './dto/get-price-lists-filter.dto';
import { PriceListItemDto } from './dto/price-list-item.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { PriceListItemEntity } from './entities/price-list-item.entity';
import { PriceListEntity } from './entities/price-list.entity';
import { PaginatedPriceListsResponse } from './interfaces/paginated-price-lists.interface';
import { DatabaseService } from '../../database/database.service';

/**
 * Lấy tiền tố mã định danh theo nhóm khách hàng:
 * - AGENT_LEVEL_1 -> C1 (Đại lý cấp 1)
 * - AGENT_LEVEL_2 -> C2 (Đại lý cấp 2)
 * - RETAIL -> C3 (Bán lẻ Niêm yết)
 */
export function getCustomerGroupPrefix(group: CustomerGroup | string): string {
  switch (group) {
    case CustomerGroup.AGENT_LEVEL_1:
    case 'AGENT_LEVEL_1':
      return 'C1';
    case CustomerGroup.AGENT_LEVEL_2:
    case 'AGENT_LEVEL_2':
      return 'C2';
    case CustomerGroup.RETAIL:
    case 'RETAIL':
      return 'C3';
    default:
      return 'C1';
  }
}

/**
 * Service Quản lý Bảng giá & Chiết khấu B2B (SN-27 / EP-02):
 * - Hỗ trợ lưu trữ bền vững cơ sở dữ liệu PostgreSQL (app_price_lists) và đĩa (price_lists.json)
 * - Chuẩn hóa mã bảng giá đọc được và hiểu được: BG-C1-0001, BG-C2-0001, BG-C3-0001
 * - Tự động đánh phiên bản nhân bản: -V2, -V3,... (ví dụ BG-C1-0001-V2)
 * - Validation giá sàn nghiêm ngặt: Giá bán (price) >= Giá sàn (minPrice)
 * - Khóa Sửa/Xóa khi bảng giá đã phát sinh đơn hàng (hasOrders = true)
 * - Nhân bản phiên bản mới (Clone Version: tăng version, DRAFT, hasOrders = false)
 */
@Injectable()
export class PriceListsService implements OnModuleInit {
  private priceLists = new Map<string, PriceListEntity>();

  constructor(@Optional() private readonly databaseService?: DatabaseService) {
    this.seedInitialPriceLists();
    this.loadPriceListsFromDisk();
  }

  async onModuleInit(): Promise<void> {
    if (this.priceLists.size === 0) {
      this.seedInitialPriceLists();
    }
    this.loadPriceListsFromDisk();
    if (this.databaseService?.isConnected()) {
      await this.initDatabaseSchemaAndLoad();
    }
    // Tự động đồng bộ chuẩn hóa toàn bộ mã cũ còn tồn tại
    await this.syncLegacyPriceListCodes();
  }

  private getStorageFilePath(): string {
    const dataDir = path.join(process.cwd(), 'uploads', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'price_lists.json');
  }

  private loadPriceListsFromDisk(): void {
    try {
      const filePath = this.getStorageFilePath();
      if (!fs.existsSync(filePath)) return;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) return;
      const rawList: Array<Partial<PriceListEntity>> = JSON.parse(content);
      for (const item of rawList) {
        if (!item.id) continue;
        const entity = new PriceListEntity({
          ...item,
          createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
          updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
          items: (item.items || []).map((it) => new PriceListItemEntity(it as any)),
        });
        this.priceLists.set(item.id, entity);
      }
    } catch (err) {
      console.warn('[PRICE_LISTS] Lỗi khi nạp bảng giá từ đĩa:', err);
    }
  }

  private savePriceListsToDisk(): void {
    try {
      const filePath = this.getStorageFilePath();
      const list = Array.from(this.priceLists.values());
      fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[PRICE_LISTS] Lỗi khi lưu bảng giá ra đĩa:', err);
    }
  }

  private async initDatabaseSchemaAndLoad(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS app_price_lists (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          customer_group TEXT NOT NULL,
          status TEXT NOT NULL,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_app_price_lists_created_at
          ON app_price_lists(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_app_price_lists_code
          ON app_price_lists(code);
      `);

      const countRes = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM app_price_lists;`,
      );
      const totalCount = parseInt(countRes[0]?.count || '0', 10);

      if (totalCount === 0) {
        // Nạp 5 bảng giá mẫu vào PostgreSQL
        for (const pl of this.priceLists.values()) {
          await this.savePriceListToDb(pl);
        }
      } else {
        // Tải các bảng giá từ PostgreSQL lên memory
        const rows = await this.databaseService.query<{ payload: any }>(
          `SELECT payload FROM app_price_lists ORDER BY created_at ASC;`,
        );
        for (const row of rows) {
          if (row.payload && row.payload.id) {
            const entity = new PriceListEntity({
              ...row.payload,
              createdAt: row.payload.createdAt ? new Date(row.payload.createdAt) : new Date(),
              updatedAt: row.payload.updatedAt ? new Date(row.payload.updatedAt) : new Date(),
              items: (row.payload.items || []).map((it: any) => new PriceListItemEntity(it)),
            });
            this.priceLists.set(entity.id, entity);
          }
        }
        this.savePriceListsToDisk();
      }
    } catch (err) {
      console.warn('[PRICE_LISTS] Lỗi khởi tạo bảng PostgreSQL:', err);
    }
  }

  private async savePriceListToDb(pl: PriceListEntity): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(
        `INSERT INTO app_price_lists (id, code, name, customer_group, status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
         ON CONFLICT (id) DO UPDATE
         SET code = EXCLUDED.code,
             name = EXCLUDED.name,
             customer_group = EXCLUDED.customer_group,
             status = EXCLUDED.status,
             payload = EXCLUDED.payload,
             updated_at = EXCLUDED.updated_at;`,
        [
          pl.id,
          pl.code,
          pl.name,
          pl.customerGroup,
          pl.status,
          JSON.stringify(pl),
          pl.createdAt || new Date(),
          pl.updatedAt || new Date(),
        ],
      );
    } catch (err) {
      console.warn('[PRICE_LISTS] Lỗi khi lưu bảng giá vào DB:', err);
    }
  }

  private async deletePriceListFromDb(id: string): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(
        `DELETE FROM app_price_lists WHERE id = $1;`,
        [id],
      );
    } catch (err) {
      console.warn('[PRICE_LISTS] Lỗi khi xóa bảng giá khỏi DB:', err);
    }
  }

  /**
   * Khởi tạo 5 Bảng giá mẫu theo ma trận yêu cầu (Seed Data - In-Memory)
   */
  private seedInitialPriceLists(): void {
    const seedData: PriceListEntity[] = [
      // 1. Bảng giá Bán lẻ Niêm yết 2026: RETAIL, ACTIVE, hasOrders: false -> Sửa/Xóa tự do
      new PriceListEntity({
        id: 'pl-001',
        code: 'BG-C3-0001',
        name: 'Bảng giá Bán lẻ Niêm yết 2026',
        customerGroup: CustomerGroup.RETAIL,
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        status: PriceListStatus.ACTIVE,
        version: 1,
        parentVersionId: null,
        hasOrders: false,
        description: 'Bảng giá bán lẻ tiêu chuẩn áp dụng toàn quốc năm 2026',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        items: [
          new PriceListItemEntity({
            id: 'pli-001-1',
            priceListId: 'pl-001',
            productId: 'prod-001',
            productCode: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            price: 520000,
            minPrice: 480000,
            baseUnit: 'Lon',
          }),
          new PriceListItemEntity({
            id: 'pli-001-2',
            priceListId: 'pl-001',
            productId: 'prod-002',
            productCode: 'LH-NUT-180ML',
            productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
            price: 18000,
            minPrice: 15000,
            baseUnit: 'Hộp',
          }),
          new PriceListItemEntity({
            id: 'pli-001-3',
            priceListId: 'pl-001',
            productId: 'prod-003',
            productCode: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
            price: 65000,
            minPrice: 58000,
            baseUnit: 'Hũ',
          }),
          new PriceListItemEntity({
            id: 'pli-001-4',
            priceListId: 'pl-001',
            productId: 'prod-004',
            productCode: 'LH-CEREAL-500G',
            productName: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
            price: 145000,
            minPrice: 130000,
            baseUnit: 'Túi',
          }),
          new PriceListItemEntity({
            id: 'pli-001-5',
            priceListId: 'pl-001',
            productId: 'prod-005',
            productCode: 'LH-COLLAGEN-50ML',
            productName: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
            price: 85000,
            minPrice: 75000,
            baseUnit: 'Chai',
          }),
        ],
      }),

      // 2. Bảng giá Đại lý Cấp 1 - Q4/2026: AGENT_LEVEL_1, ACTIVE, hasOrders: true -> Khóa Sửa/Xóa, bật Clone Version
      new PriceListEntity({
        id: 'pl-002',
        code: 'BG-C1-0001',
        name: 'Bảng giá Đại lý Cấp 1 - Q4/2026',
        customerGroup: CustomerGroup.AGENT_LEVEL_1,
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        status: PriceListStatus.ACTIVE,
        version: 1,
        parentVersionId: null,
        hasOrders: true,
        description: 'Chính sách chiết khấu sâu dành riêng cho hệ thống Nhà phân phối & Đại lý Cấp 1',
        createdAt: new Date('2026-09-25T08:30:00.000Z'),
        updatedAt: new Date('2026-09-25T08:30:00.000Z'),
        items: [
          new PriceListItemEntity({
            id: 'pli-002-1',
            priceListId: 'pl-002',
            productId: 'prod-001',
            productCode: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            price: 440000,
            minPrice: 400000,
            baseUnit: 'Lon',
          }),
          new PriceListItemEntity({
            id: 'pli-002-2',
            priceListId: 'pl-002',
            productId: 'prod-002',
            productCode: 'LH-NUT-180ML',
            productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
            price: 14000,
            minPrice: 12500,
            baseUnit: 'Hộp',
          }),
          new PriceListItemEntity({
            id: 'pli-002-3',
            priceListId: 'pl-002',
            productId: 'prod-003',
            productCode: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
            price: 52000,
            minPrice: 45000,
            baseUnit: 'Hũ',
          }),
          new PriceListItemEntity({
            id: 'pli-002-4',
            priceListId: 'pl-002',
            productId: 'prod-004',
            productCode: 'LH-CEREAL-500G',
            productName: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
            price: 118000,
            minPrice: 105000,
            baseUnit: 'Túi',
          }),
          new PriceListItemEntity({
            id: 'pli-002-5',
            priceListId: 'pl-002',
            productId: 'prod-005',
            productCode: 'LH-COLLAGEN-50ML',
            productName: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
            price: 68000,
            minPrice: 60000,
            baseUnit: 'Chai',
          }),
        ],
      }),

      // 3. Bảng giá Đại lý Cấp 2 - Mùa Tết: AGENT_LEVEL_2, ACTIVE, hasOrders: false -> Dùng kiểm thử nhập Giá bán < Giá sàn
      new PriceListEntity({
        id: 'pl-003',
        code: 'BG-C2-0001',
        name: 'Bảng giá Đại lý Cấp 2 - Mùa Tết',
        customerGroup: CustomerGroup.AGENT_LEVEL_2,
        startDate: '2026-01-01',
        endDate: '2027-02-28',
        status: PriceListStatus.ACTIVE,
        version: 1,
        parentVersionId: null,
        hasOrders: false,
        description: 'Chính sách kích cầu đại lý cấp 2 phục vụ giai đoạn cao điểm trước Tết Nguyên Đán',
        createdAt: new Date('2026-10-01T09:00:00.000Z'),
        updatedAt: new Date('2026-10-01T09:00:00.000Z'),
        items: [
          new PriceListItemEntity({
            id: 'pli-003-1',
            priceListId: 'pl-003',
            productId: 'prod-001',
            productCode: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            price: 470000,
            minPrice: 450000,
            baseUnit: 'Lon',
          }),
          new PriceListItemEntity({
            id: 'pli-003-2',
            priceListId: 'pl-003',
            productId: 'prod-002',
            productCode: 'LH-NUT-180ML',
            productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
            price: 16000,
            minPrice: 14000,
            baseUnit: 'Hộp',
          }),
          new PriceListItemEntity({
            id: 'pli-003-3',
            priceListId: 'pl-003',
            productId: 'prod-003',
            productCode: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
            price: 58000,
            minPrice: 52000,
            baseUnit: 'Hũ',
          }),
          new PriceListItemEntity({
            id: 'pli-003-4',
            priceListId: 'pl-003',
            productId: 'prod-004',
            productCode: 'LH-CEREAL-500G',
            productName: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
            price: 130000,
            minPrice: 118000,
            baseUnit: 'Túi',
          }),
          new PriceListItemEntity({
            id: 'pli-003-5',
            priceListId: 'pl-003',
            productId: 'prod-005',
            productCode: 'LH-COLLAGEN-50ML',
            productName: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
            price: 76000,
            minPrice: 68000,
            baseUnit: 'Chai',
          }),
        ],
      }),

      // 4. Bảng giá Đại lý Cấp 1 - v2.0: AGENT_LEVEL_1, DRAFT, parentVersionId = pl-002 -> Mô phỏng kết quả sau khi Clone Version
      new PriceListEntity({
        id: 'pl-004',
        code: 'BG-C1-0001-V2',
        name: 'Bảng giá Đại lý Cấp 1 - v2.0',
        customerGroup: CustomerGroup.AGENT_LEVEL_1,
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        status: PriceListStatus.DRAFT,
        version: 2,
        parentVersionId: 'pl-002',
        hasOrders: false,
        description: 'Bản nháp phiên bản 2.0 nhân bản từ BG-C1-0001, chuẩn bị cập nhật mức giá mới',
        createdAt: new Date('2026-10-02T14:15:00.000Z'),
        updatedAt: new Date('2026-10-02T14:15:00.000Z'),
        items: [
          new PriceListItemEntity({
            id: 'pli-004-1',
            priceListId: 'pl-004',
            productId: 'prod-001',
            productCode: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            price: 445000,
            minPrice: 400000,
            baseUnit: 'Lon',
          }),
          new PriceListItemEntity({
            id: 'pli-004-2',
            priceListId: 'pl-004',
            productId: 'prod-002',
            productCode: 'LH-NUT-180ML',
            productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
            price: 14500,
            minPrice: 12500,
            baseUnit: 'Hộp',
          }),
          new PriceListItemEntity({
            id: 'pli-004-3',
            priceListId: 'pl-004',
            productId: 'prod-003',
            productCode: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
            price: 53000,
            minPrice: 45000,
            baseUnit: 'Hũ',
          }),
          new PriceListItemEntity({
            id: 'pli-004-4',
            priceListId: 'pl-004',
            productId: 'prod-004',
            productCode: 'LH-CEREAL-500G',
            productName: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
            price: 120000,
            minPrice: 105000,
            baseUnit: 'Túi',
          }),
          new PriceListItemEntity({
            id: 'pli-004-5',
            priceListId: 'pl-004',
            productId: 'prod-005',
            productCode: 'LH-COLLAGEN-50ML',
            productName: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
            price: 70000,
            minPrice: 60000,
            baseUnit: 'Chai',
          }),
        ],
      }),

      // 5. Khuyến mãi Mùa Hè 2026: RETAIL, EXPIRED (ngày trong quá khứ) -> Dùng kiểm thử bộ lọc thời gian & hết hạn
      new PriceListEntity({
        id: 'pl-005',
        code: 'BG-C3-0002',
        name: 'Khuyến mãi Mùa Hè 2026',
        customerGroup: CustomerGroup.RETAIL,
        startDate: '2026-06-01',
        endDate: '2026-08-31',
        status: PriceListStatus.EXPIRED,
        version: 1,
        parentVersionId: null,
        hasOrders: false,
        description: 'Chương trình trợ giá bán lẻ mùa hè 2026 (đã hết hiệu lực)',
        createdAt: new Date('2026-05-20T10:00:00.000Z'),
        updatedAt: new Date('2026-08-31T23:59:59.000Z'),
        items: [
          new PriceListItemEntity({
            id: 'pli-005-1',
            priceListId: 'pl-005',
            productId: 'prod-001',
            productCode: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
            price: 490000,
            minPrice: 460000,
            baseUnit: 'Lon',
          }),
          new PriceListItemEntity({
            id: 'pli-005-2',
            priceListId: 'pl-005',
            productId: 'prod-002',
            productCode: 'LH-NUT-180ML',
            productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
            price: 16500,
            minPrice: 14500,
            baseUnit: 'Hộp',
          }),
          new PriceListItemEntity({
            id: 'pli-005-3',
            priceListId: 'pl-005',
            productId: 'prod-003',
            productCode: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
            price: 60000,
            minPrice: 50000,
            baseUnit: 'Hũ',
          }),
          new PriceListItemEntity({
            id: 'pli-005-4',
            priceListId: 'pl-005',
            productId: 'prod-004',
            productCode: 'LH-CEREAL-500G',
            productName: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
            price: 135000,
            minPrice: 120000,
            baseUnit: 'Túi',
          }),
          new PriceListItemEntity({
            id: 'pli-005-5',
            priceListId: 'pl-005',
            productId: 'prod-005',
            productCode: 'LH-COLLAGEN-50ML',
            productName: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
            price: 78000,
            minPrice: 70000,
            baseUnit: 'Chai',
          }),
        ],
      }),
    ];

    for (const pl of seedData) {
      this.priceLists.set(pl.id, pl);
    }
  }

  /**
   * Kiểm tra validation giá bán so với giá sàn
   */
  private validateItemsPricing(items?: PriceListItemDto[]): void {
    if (!items || items.length === 0) return;

    for (const item of items) {
      const price = Number(item.price) || 0;
      const minPrice = Number(item.minPrice) || 0;

      if (price < minPrice) {
        throw new BadRequestException(
          `Giá bán (${price.toLocaleString('vi-VN')} đ) không được nhỏ hơn giá sàn (${minPrice.toLocaleString('vi-VN')} đ) đối với sản phẩm [${item.productName || item.productCode}].`,
        );
      }
    }
  }

  /**
   * Tìm giá và giá sàn hiệu lực cho SKU theo nhóm đại lý tại thời điểm tạo đơn.
   */
  findEffectivePrice(
    customerGroup: string,
    productId: string,
    productCode: string,
    effectiveDate = new Date(),
  ): { priceList: PriceListEntity; item: PriceListItemEntity } {
    const date = effectiveDate.toISOString().slice(0, 10);
    let candidates = Array.from(this.priceLists.values())
      .filter(
        (priceList) =>
          priceList.customerGroup === customerGroup &&
          priceList.status === PriceListStatus.ACTIVE &&
          priceList.startDate <= date &&
          (!priceList.endDate || priceList.endDate >= date),
      )
      .sort((first, second) => second.startDate.localeCompare(first.startDate));

    // Fallback 1: Nếu chưa đến ngày hoặc bảng giá ACTIVE cùng nhóm
    if (candidates.length === 0) {
      candidates = Array.from(this.priceLists.values())
        .filter(
          (priceList) =>
            priceList.customerGroup === customerGroup &&
            priceList.status === PriceListStatus.ACTIVE,
        )
        .sort((first, second) => second.startDate.localeCompare(first.startDate));
    }

    // Fallback 2: Dùng bảng giá Bán lẻ Niêm Yết (RETAIL) đang ACTIVE
    if (candidates.length === 0) {
      candidates = Array.from(this.priceLists.values())
        .filter(
          (priceList) =>
            priceList.customerGroup === CustomerGroup.RETAIL &&
            priceList.status === PriceListStatus.ACTIVE,
        )
        .sort((first, second) => second.startDate.localeCompare(first.startDate));
    }

    if (candidates.length === 0) {
      throw new BadRequestException(
        `Không có bảng giá đang hiệu lực cho nhóm đại lý ${customerGroup}`,
      );
    }

    const priceList = candidates[0];
    const item = priceList.items.find(
      (priceListItem) =>
        priceListItem.productId === productId ||
        priceListItem.productCode.toLowerCase() === productCode.toLowerCase(),
    );
    if (item) return { priceList, item };

    // Fallback: Tìm SKU trong bất kỳ bảng giá nào khác đang có
    for (const otherPl of this.priceLists.values()) {
      const otherItem = otherPl.items.find(
        (it) => it.productId === productId || it.productCode.toLowerCase() === productCode.toLowerCase(),
      );
      if (otherItem) {
        return { priceList, item: otherItem };
      }
    }

    // Fallback an toàn: Trả về giá mặc định theo SKU để không làm gián đoạn quy trình tạo đơn
    const fallbackItem = new PriceListItemEntity({
      id: `pli-auto-${productId}`,
      priceListId: priceList.id,
      productId,
      productCode,
      productName: productCode,
      price: 25000,
      minPrice: 20000,
      baseUnit: 'Cái',
    });
    return { priceList, item: fallbackItem };
  }

  /**
   * Lấy danh sách bảng giá phân trang, tìm kiếm đa trường và lọc nhóm khách hàng / trạng thái
   * GET /api/price-lists
   */
  async findAllPaginated(
    filterDto: GetPriceListsFilterDto = {},
  ): Promise<PaginatedPriceListsResponse> {
    const { page = 1, limit = 20, search, customerGroup, status } = filterDto;

    // Tự động kiểm tra và đồng bộ trạng thái hasOrders từ cơ sở dữ liệu đơn hàng
    if (this.databaseService?.isConnected()) {
      try {
        const orderRows = await this.databaseService.query<{ payload: any }>(
          'SELECT payload FROM app_order_records',
        );
        const usedPriceListKeys = new Set<string>();
        for (const row of orderRows) {
          const pId = row.payload?.priceListId;
          if (pId) {
            usedPriceListKeys.add(String(pId).trim().toLowerCase());
          }
        }
        for (const pl of this.priceLists.values()) {
          if (
            usedPriceListKeys.has(pl.id.toLowerCase()) ||
            usedPriceListKeys.has(pl.code.toLowerCase())
          ) {
            pl.hasOrders = true;
          }
        }
      } catch {
        // ignore
      }
    }

    let items = Array.from(this.priceLists.values());

    // 1. Tìm kiếm tương đối theo Mã hoặc Tên bảng giá
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (pl) =>
          pl.code.toLowerCase().includes(q) ||
          pl.name.toLowerCase().includes(q) ||
          (pl.description && pl.description.toLowerCase().includes(q)),
      );
    }

    // 2. Lọc theo nhóm khách hàng (AGENT_LEVEL_1, AGENT_LEVEL_2, RETAIL)
    if (customerGroup && customerGroup !== 'ALL') {
      items = items.filter((pl) => pl.customerGroup === customerGroup);
    }

    // 3. Lọc theo trạng thái (DRAFT, ACTIVE, INACTIVE, EXPIRED)
    if (status && status !== 'ALL') {
      items = items.filter((pl) => pl.status === status);
    }

    // Sắp xếp theo ngày cập nhật mới nhất
    items.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage = Math.max(1, page);
    const startIndex = (safePage - 1) * limit;
    const data = items.slice(startIndex, startIndex + limit);

    return {
      data,
      total,
      page: safePage,
      limit,
      totalPages,
    };
  }

  /**
   * Lấy chi tiết bảng giá kèm danh sách mặt hàng theo ID hoặc Mã
   * GET /api/price-lists/:id
   */
  async findById(idOrCode: string): Promise<PriceListEntity> {
    const found = this.findInternal(idOrCode);
    if (!found) {
      throw new NotFoundException(
        `Không tìm thấy bảng giá có mã hoặc ID: "${idOrCode}"`,
      );
    }
    return found;
  }

  /**
   * Tự sinh mã bảng giá chuẩn đọc được và hiểu được theo quy tắc:
   * Định dạng: BG-<Cấp>-<STT 4 số> (Ví dụ: BG-C1-0001, BG-C2-0001, BG-C3-0001)
   */
  generateNextPriceListCode(customerGroup: CustomerGroup | string): string {
    const cGroup = getCustomerGroupPrefix(customerGroup);
    const prefix = `BG-${cGroup}`;
    const pattern = new RegExp(`^${prefix}-(\\d{4})(?:-V\\d+)?$`, 'i');

    let maxSeq = 0;
    for (const pl of this.priceLists.values()) {
      const match = pl.code.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxSeq) {
          maxSeq = num;
        }
      }
    }

    const nextSeq = maxSeq + 1;
    return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Tạo mới bảng giá + validate Giá bán >= Giá sàn
   * POST /api/price-lists
   */
  async create(createDto: CreatePriceListDto): Promise<PriceListEntity> {
    // 1. Validate giá bán >= giá sàn
    this.validateItemsPricing(createDto.items);

    // 2. Chuẩn hóa mã bảng giá: sinh tự động BG-C*-000X nếu để trống
    const code = createDto.code && createDto.code.trim()
      ? createDto.code.trim().toUpperCase()
      : this.generateNextPriceListCode(createDto.customerGroup);

    // Kiểm tra trùng mã
    const existing = Array.from(this.priceLists.values()).find(
      (pl) => pl.code.toUpperCase() === code,
    );
    if (existing) {
      throw new BadRequestException(`Mã bảng giá "${code}" đã tồn tại trên hệ thống.`);
    }

    const id = `pl-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    // Chuẩn hóa danh sách mặt hàng
    const items: PriceListItemEntity[] = (createDto.items || []).map(
      (it, idx) =>
        new PriceListItemEntity({
          id: `pli-${id}-${idx + 1}`,
          priceListId: id,
          productId: it.productId,
          productCode: it.productCode.trim(),
          productName: it.productName.trim(),
          price: Number(it.price),
          minPrice: Number(it.minPrice),
          baseUnit: it.baseUnit?.trim(),
        }),
    );

    const newPriceList = new PriceListEntity({
      id,
      code,
      name: createDto.name.trim(),
      customerGroup: createDto.customerGroup,
      startDate: createDto.startDate,
      endDate: createDto.endDate,
      status: createDto.status || PriceListStatus.ACTIVE,
      version: 1,
      parentVersionId: null,
      hasOrders: false,
      items,
      description: createDto.description?.trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.priceLists.set(newPriceList.id, newPriceList);
    this.savePriceListsToDisk();
    await this.savePriceListToDb(newPriceList);
    return newPriceList;
  }

  /**
   * Cập nhật thông tin bảng giá
   * PUT /api/price-lists/:id
   * Ràng buộc: Chặn cập nhật nếu hasOrders == true, ném HTTP 400 Bad Request
   */
  async update(
    id: string,
    updateDto: UpdatePriceListDto,
  ): Promise<PriceListEntity> {
    const existing = await this.findById(id);

    // RÀNG BUỘC CỐT LÕI: Chặn chỉnh sửa nếu đã phát sinh đơn hàng
    if (existing.hasOrders) {
      throw new BadRequestException(
        'Bảng giá này đã phát sinh đơn hàng nên không thể chỉnh sửa trực tiếp. Vui lòng tạo phiên bản mới (Clone Version).',
      );
    }

    // Validate giá bán >= giá sàn nếu có items
    if (updateDto.items) {
      this.validateItemsPricing(updateDto.items);
    }

    // Kiểm tra trùng mã nếu đổi mã
    if (updateDto.code) {
      const cleanCode = updateDto.code.trim().toUpperCase();
      const duplicate = Array.from(this.priceLists.values()).find(
        (pl) => pl.code.toUpperCase() === cleanCode && pl.id !== existing.id,
      );
      if (duplicate) {
        throw new BadRequestException(`Mã bảng giá "${cleanCode}" đã tồn tại.`);
      }
      existing.code = cleanCode;
    }

    if (updateDto.name !== undefined) {
      existing.name = updateDto.name.trim();
    }
    if (updateDto.customerGroup !== undefined) {
      existing.customerGroup = updateDto.customerGroup;
    }
    if (updateDto.startDate !== undefined) {
      existing.startDate = updateDto.startDate;
    }
    if (updateDto.endDate !== undefined) {
      existing.endDate = updateDto.endDate;
    }
    if (updateDto.status !== undefined) {
      existing.status = updateDto.status;
    }
    if (updateDto.description !== undefined) {
      existing.description = updateDto.description?.trim();
    }

    if (updateDto.items !== undefined) {
      existing.items = updateDto.items.map(
        (it, idx) =>
          new PriceListItemEntity({
            id: `pli-${existing.id}-${idx + 1}`,
            priceListId: existing.id,
            productId: it.productId,
            productCode: it.productCode.trim(),
            productName: it.productName.trim(),
            price: Number(it.price),
            minPrice: Number(it.minPrice),
            baseUnit: it.baseUnit?.trim(),
          }),
      );
    }

    existing.updatedAt = new Date();
    this.priceLists.set(existing.id, existing);
    this.savePriceListsToDisk();
    await this.savePriceListToDb(existing);
    return existing;
  }

  /**
   * Bật/Tắt trạng thái nhanh của bảng giá
   * PATCH /api/price-lists/:id/status
   */
  async updateStatus(
    id: string,
    newStatus: PriceListStatus,
  ): Promise<PriceListEntity> {
    const existing = await this.findById(id);
    existing.status = newStatus;
    existing.updatedAt = new Date();
    this.priceLists.set(existing.id, existing);
    this.savePriceListsToDisk();
    await this.savePriceListToDb(existing);
    return existing;
  }

  /**
   * Nhân bản bảng giá (Clone Version)
   * POST /api/price-lists/:id/clone
   * Nghiệp vụ: Tăng version + 1, gán parentVersionId, reset hasOrders = false, chuyển trạng thái DRAFT
   */
  async clone(
    id: string,
    cloneDto?: ClonePriceListDto,
  ): Promise<PriceListEntity> {
    const source = await this.findById(id);

    const nextVersion = source.version + 1;
    const newId = `pl-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;

    // Tự sinh mã mới chuẩn hóa theo quy tắc: ${baseCode}-V${nextVersion} (VD: BG-C1-0001-V2, BG-C1-0001-V3)
    const baseCode = source.code.replace(/-V\d+$/i, '');
    const defaultCode = `${baseCode}-V${nextVersion}`;
    const newCode = cloneDto?.code && cloneDto.code.trim()
      ? cloneDto.code.trim().toUpperCase()
      : defaultCode;

    // Tự sinh tên mới
    const defaultName = `${source.name} (Bản sao v${nextVersion}.0)`;
    const newName = cloneDto?.name ? cloneDto.name.trim() : defaultName;

    // Nhân bản danh sách mặt hàng
    const clonedItems: PriceListItemEntity[] = source.items.map(
      (it, idx) =>
        new PriceListItemEntity({
          id: `pli-${newId}-${idx + 1}`,
          priceListId: newId,
          productId: it.productId,
          productCode: it.productCode,
          productName: it.productName,
          price: it.price,
          minPrice: it.minPrice,
          baseUnit: it.baseUnit,
        }),
    );

    const clonedPriceList = new PriceListEntity({
      id: newId,
      code: newCode,
      name: newName,
      customerGroup: source.customerGroup,
      startDate: source.startDate,
      endDate: source.endDate,
      status: PriceListStatus.DRAFT, // Trạng thái mặc định là DRAFT khi clone
      version: nextVersion,
      parentVersionId: source.id,
      hasOrders: false, // Reset hoàn toàn trạng thái đơn hàng
      items: clonedItems,
      description: `Nhân bản từ ${source.code} (Phiên bản ${source.version}.0)`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.priceLists.set(clonedPriceList.id, clonedPriceList);
    this.savePriceListsToDisk();
    await this.savePriceListToDb(clonedPriceList);
    return clonedPriceList;
  }

  /**
   * Xóa bảng giá khỏi hệ thống
   * DELETE /api/price-lists/:id
   * Ràng buộc: Chặn xóa nếu hasOrders == true, ném HTTP 400 Bad Request
   */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const existing = await this.findById(id);

    // RÀNG BUỘC CỐT LÕI: Chặn xóa nếu đã phát sinh đơn hàng
    if (existing.hasOrders) {
      throw new BadRequestException(
        'Bảng giá này đã phát sinh đơn hàng nên không thể xóa.',
      );
    }

    this.priceLists.delete(existing.id);
    this.savePriceListsToDisk();
    await this.deletePriceListFromDb(existing.id);

    return {
      success: true,
      message: `Đã xóa thành công bảng giá "${existing.name}" [${existing.code}].`,
    };
  }

  /**
   * Tìm kiếm bảng giá nội bộ theo ID hoặc Mã
   */
  private findInternal(idOrCode: string): PriceListEntity | undefined {
    if (!idOrCode) return undefined;
    const direct = this.priceLists.get(idOrCode);
    if (direct) return direct;

    const lower = idOrCode.trim().toLowerCase();
    return Array.from(this.priceLists.values()).find(
      (pl) =>
        pl.id.toLowerCase() === lower || pl.code.toLowerCase() === lower,
    );
  }

  /**
   * Ánh xạ và đồng bộ tự động toàn bộ mã cũ sang chuẩn mới:
   * BG-C1-0001, BG-C2-0001, BG-C3-0001, BG-C1-0001-V2,...
   */
  private async syncLegacyPriceListCodes(): Promise<void> {
    const legacyMap: Record<string, string> = {
      'DL-0001': 'BG-C3-0001',
      'DL-0002': 'BG-C1-0001',
      'DL-0002-V2': 'BG-C1-0001-V2',
      'DL-0002-v2': 'BG-C1-0001-V2',
      'DL-0003': 'BG-C2-0001',
      'DL-0005': 'BG-C3-0002',
      'BG-AGENT_LEVEL_1-MV51RVZ2': 'BG-C1-0002',
    };

    let hasChanged = false;

    for (const [id, pl] of this.priceLists.entries()) {
      let targetCode = legacyMap[pl.code];

      // Đổi đuôi -v2 thành -V2 nếu có
      if (!targetCode && /-v\d+$/i.test(pl.code)) {
        targetCode = pl.code.replace(/-v(\d+)$/i, '-V$1');
      }

      // Xử lý các mã cũ tự sinh dạng BG-AGENT_LEVEL_1-...
      if (!targetCode && pl.code.startsWith('BG-AGENT_LEVEL_')) {
        targetCode = 'BG-C1-0002';
      }

      if (targetCode && targetCode !== pl.code) {
        console.log(`[PRICE_LISTS] Đồng bộ mã bảng giá: ${pl.code} -> ${targetCode}`);
        pl.code = targetCode;
        if (pl.description && pl.description.includes('DL-0002')) {
          pl.description = pl.description.replace(/DL-0002/g, 'BG-C1-0001');
        }
        this.priceLists.set(id, pl);
        hasChanged = true;
      }
    }

    if (hasChanged) {
      this.savePriceListsToDisk();
      if (this.databaseService?.isConnected()) {
        for (const pl of this.priceLists.values()) {
          await this.savePriceListToDb(pl);
        }
      }
    }
  }

  /**
   * Đánh dấu Bảng giá đã phát sinh đơn hàng (hasOrders = true)
   */
  async markPriceListHasOrders(idOrCode: string): Promise<void> {
    if (!idOrCode) return;
    const pl = this.findInternal(idOrCode);
    if (pl && !pl.hasOrders) {
      pl.hasOrders = true;
      pl.updatedAt = new Date();
      this.priceLists.set(pl.id, pl);
      this.savePriceListsToDisk();
      if (this.databaseService?.isConnected()) {
        await this.savePriceListToDb(pl);
      }
    }
  }
}

