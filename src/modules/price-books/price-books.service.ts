import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CustomerGroup } from './enums/customer-group.enum';
import { PriceListStatus } from './enums/price-list-status.enum';
import { PriceListItemEntity } from './entities/price-list-item.entity';
import { PriceListEntity } from './entities/price-list.entity';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { CreatePriceListItemDto } from './dto/create-price-list-item.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { ClonePriceListDto } from './dto/clone-price-list.dto';
import { GetPriceListsFilterDto } from './dto/get-price-lists-filter.dto';
import { PaginatedPriceListsResponse } from './interfaces/paginated-price-lists.interface';

/**
 * Service Quản lý Bảng giá & Chiết khấu B2B (Task SN-27 / EP-02):
 * - Quản lý danh mục bảng giá theo nhóm khách hàng B2B (Đại lý cấp 1, cấp 2, Bán lẻ)
 * - RÀNG BUỘC GIÁ SÀN (Min Price Validation): Giá bán áp dụng không được nhỏ hơn giá sàn
 * - QUY TẮC BẤT BIẾN (Immutable Price List): Bảng giá đã phát sinh đơn hàng (hasOrders = true)
 *   tuyệt đối không được sửa/xóa trực tiếp, chỉ cho phép Tạo phiên bản mới (Clone Version).
 * - Tương thích cơ sở dữ liệu PostgreSQL và resilient memory fallback
 */
@Injectable()
export class PriceBooksService implements OnModuleInit {
  private priceLists = new Map<string, PriceListEntity>();

  constructor(@Optional() private readonly dbService?: DatabaseService) {
    this.seedInitialPriceLists();
  }

  async onModuleInit(): Promise<void> {
    if (this.priceLists.size === 0) {
      this.seedInitialPriceLists();
    }
    if (this.dbService?.isConnected()) {
      await this.initDatabaseSchemaAndLoad();
    }
  }

  /**
   * Khởi tạo dữ liệu mẫu chuẩn hóa cho Bảng giá & Chiết khấu B2B
   */
  private seedInitialPriceLists(): void {
    const defaultData: PriceListEntity[] = [
      new PriceListEntity({
        id: 'pl-001',
        code: 'BG-RETAIL-2026',
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
      new PriceListEntity({
        id: 'pl-002',
        code: 'BG-AGENT1-Q4-2026',
        name: 'Bảng giá Đại lý Cấp 1 - Q4/2026',
        customerGroup: CustomerGroup.AGENT_LEVEL_1,
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        status: PriceListStatus.ACTIVE,
        version: 1,
        parentVersionId: null,
        hasOrders: true, // RÀNG BUỘC BẤT BIẾN: Đã phát sinh đơn hàng, khóa Sửa/Xóa
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
      new PriceListEntity({
        id: 'pl-003',
        code: 'BG-AGENT2-TET-2027',
        name: 'Bảng giá Đại lý Cấp 2 - Mùa Tết',
        customerGroup: CustomerGroup.AGENT_LEVEL_2,
        startDate: '2026-11-01',
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
      new PriceListEntity({
        id: 'pl-004',
        code: 'BG-AGENT1-Q4-2026-V2',
        name: 'Bảng giá Đại lý Cấp 1 - v2.0',
        customerGroup: CustomerGroup.AGENT_LEVEL_1,
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        status: PriceListStatus.DRAFT,
        version: 2,
        parentVersionId: 'pl-002',
        hasOrders: false,
        description: 'Bản nháp phiên bản 2.0 nhân bản từ BG-AGENT1-Q4-2026, chuẩn bị cập nhật mức giá mới',
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
      new PriceListEntity({
        id: 'pl-005',
        code: 'BG-SUMMER-PROMO-2026',
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

    for (const pl of defaultData) {
      this.priceLists.set(pl.id, pl);
    }
  }

  /**
   * Tự động kiểm tra và cập nhật cấu trúc schema CSDL nếu cần
   */
  private async initDatabaseSchemaAndLoad(): Promise<void> {
    try {
      await this.dbService!.query(`
        ALTER TABLE price_lists ADD COLUMN IF NOT EXISTS version INT DEFAULT 1;
        ALTER TABLE price_lists ADD COLUMN IF NOT EXISTS parent_version_id VARCHAR(100);
        ALTER TABLE price_lists ADD COLUMN IF NOT EXISTS has_orders BOOLEAN DEFAULT FALSE;
        ALTER TABLE price_lists ADD COLUMN IF NOT EXISTS description TEXT;
      `);

      const countRes = await this.dbService!.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM price_lists;`,
      );
      const totalCount = parseInt(countRes[0]?.count || '0', 10);

      if (totalCount === 0) {
        // Nạp seed data vào PostgreSQL
        for (const pl of this.priceLists.values()) {
          await this.insertPriceListToDb(pl);
        }
      } else {
        // Tải dữ liệu từ PostgreSQL lên memory
        await this.loadPriceListsFromDb();
      }
    } catch {
      // Tiếp tục hoạt động ở chế độ in-memory nếu DB gặp sự cố
    }
  }

  private async insertPriceListToDb(pl: PriceListEntity): Promise<void> {
    if (!this.dbService?.isConnected()) return;
    try {
      await this.dbService.query(
        `INSERT INTO price_lists (id, code, name, customer_group, start_date, end_date, status, version, parent_version_id, has_orders, description, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO NOTHING;`,
        [
          pl.id,
          pl.code,
          pl.name,
          pl.customerGroup,
          pl.startDate,
          pl.endDate,
          pl.status,
          pl.version,
          pl.parentVersionId,
          pl.hasOrders,
          pl.description,
          pl.createdAt,
          pl.updatedAt,
        ],
      );
    } catch {
      // Ignored for resilience
    }
  }

  private async loadPriceListsFromDb(): Promise<void> {
    if (!this.dbService?.isConnected()) return;
    try {
      const rows = await this.dbService.query<{
        id: string;
        code: string;
        name: string;
        customer_group: string;
        start_date: Date | string;
        end_date: Date | string;
        status: string;
        version: number;
        parent_version_id: string | null;
        has_orders: boolean;
        description?: string;
        created_at: Date;
        updated_at: Date;
      }>(`
        SELECT id, code, name, customer_group, start_date, end_date, status, version, parent_version_id, has_orders, description, created_at, updated_at
        FROM price_lists;
      `);

      for (const row of rows) {
        const existing = this.priceLists.get(row.id);
        const entity = new PriceListEntity({
          id: row.id,
          code: row.code,
          name: row.name,
          customerGroup: row.customer_group as CustomerGroup,
          startDate:
            row.start_date instanceof Date
              ? row.start_date.toISOString().split('T')[0]
              : String(row.start_date).split('T')[0],
          endDate:
            row.end_date instanceof Date
              ? row.end_date.toISOString().split('T')[0]
              : String(row.end_date).split('T')[0],
          status: row.status as PriceListStatus,
          version: Number(row.version) || 1,
          parentVersionId: row.parent_version_id || null,
          hasOrders: Boolean(row.has_orders),
          description: row.description,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          items: existing?.items || [],
        });
        this.priceLists.set(entity.id, entity);
      }
    } catch {
      // Fallback in-memory
    }
  }

  /**
   * KIỂM TRA RÀNG BUỘC GIÁ SÀN (Min Price Validation):
   * Bắt buộc kiểm tra mọi mặt hàng trong bảng giá: Giá bán không được nhỏ hơn giá sàn
   */
  private validateItemsMinPrice(items: (CreatePriceListItemDto | PriceListItemEntity)[]): void {
    for (const item of items) {
      const price = Number(item.price) || 0;
      const minPrice = Number(item.minPrice) || 0;
      if (price < minPrice) {
        throw new BadRequestException(
          `Ràng buộc giá sàn vi phạm: Mặt hàng [${item.productCode || item.productName}] có giá bán (${price.toLocaleString(
            'vi-VN',
          )} đ) nhỏ hơn giá sàn quy định (${minPrice.toLocaleString(
            'vi-VN',
          )} đ). Vui lòng điều chỉnh lại giá bán để bảo toàn biên lợi nhuận tối thiểu.`,
        );
      }
    }
  }

  /**
   * Lấy danh sách bảng giá phân trang, tìm kiếm và lọc
   */
  async findAllPaginated(filter: GetPriceListsFilterDto): Promise<PaginatedPriceListsResponse> {
    if (this.dbService?.isConnected()) {
      try {
        const orderRows = await this.dbService.query<{ payload: any }>(
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

    // Sắp xếp mặc định: mới nhất lên đầu
    items.sort(
      (a, b) =>
        new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
    );

    // Lọc theo từ khóa tìm kiếm (Mã, Tên, Mô tả)
    if (filter.search && filter.search.trim()) {
      const query = filter.search.trim().toLowerCase();
      items = items.filter(
        (pl) =>
          pl.code.toLowerCase().includes(query) ||
          pl.name.toLowerCase().includes(query) ||
          (pl.description && pl.description.toLowerCase().includes(query)),
      );
    }

    // Lọc theo Nhóm khách hàng
    if (filter.customerGroup && filter.customerGroup !== 'ALL') {
      items = items.filter((pl) => pl.customerGroup === filter.customerGroup);
    }

    // Lọc theo Trạng thái
    if (filter.status && filter.status !== 'ALL') {
      items = items.filter((pl) => pl.status === filter.status);
    }

    const page = Math.max(1, Number(filter.page) || 1);
    const limit = Math.max(1, Number(filter.limit) || 20);
    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const data = items.slice(startIndex, startIndex + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Lấy chi tiết bảng giá theo ID hoặc Code
   */
  async findById(id: string): Promise<PriceListEntity> {
    let found = this.priceLists.get(id);
    if (!found) {
      found = Array.from(this.priceLists.values()).find(
        (pl) => pl.code.toUpperCase() === id.toUpperCase(),
      );
    }
    if (!found) {
      throw new NotFoundException(`Không tìm thấy bảng giá với định danh: ${id}`);
    }
    return found;
  }

  /**
   * Thêm mới bảng giá & kiểm tra ràng buộc giá sàn
   */
  async create(createDto: CreatePriceListDto): Promise<PriceListEntity> {
    const code =
      createDto.code?.trim() || `BG-${Date.now().toString(36).toUpperCase()}`;

    // Kiểm tra trùng mã
    const existingCode = Array.from(this.priceLists.values()).find(
      (pl) => pl.code.toUpperCase() === code.toUpperCase(),
    );
    if (existingCode) {
      throw new BadRequestException(`Mã bảng giá "${code}" đã tồn tại trong hệ thống.`);
    }

    // Kiểm tra thời gian hiệu lực
    if (new Date(createDto.endDate) < new Date(createDto.startDate)) {
      throw new BadRequestException('Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.');
    }

    // Kiểm tra ràng buộc giá sàn từng mặt hàng
    const inputItems = createDto.items || [];
    this.validateItemsMinPrice(inputItems);

    const priceListId = `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const items: PriceListItemEntity[] = inputItems.map((item, idx) => {
      return new PriceListItemEntity({
        id: `pli-${Date.now().toString(36)}-${idx}`,
        priceListId,
        productId: item.productId,
        productCode: item.productCode,
        productName: item.productName,
        price: Number(item.price) || 0,
        minPrice: Number(item.minPrice) || 0,
        baseUnit: item.baseUnit || 'Cái',
      });
    });

    const entity = new PriceListEntity({
      id: priceListId,
      code,
      name: createDto.name.trim(),
      customerGroup: createDto.customerGroup,
      startDate: createDto.startDate,
      endDate: createDto.endDate,
      status: createDto.status || PriceListStatus.ACTIVE,
      version: 1,
      parentVersionId: null,
      hasOrders: false,
      description: createDto.description?.trim() || '',
      items,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.priceLists.set(entity.id, entity);
    await this.insertPriceListToDb(entity);

    return entity;
  }

  /**
   * Cập nhật thông tin bảng giá:
   * RÀNG BUỘC BẤT BIẾN: Tuyệt đối không cho phép sửa nếu hasOrders == true
   */
  async update(id: string, updateDto: UpdatePriceListDto): Promise<PriceListEntity> {
    const existing = await this.findById(id);

    // QUY TẮC BẤT BIẾN (IMMUTABLE PRICE LIST)
    if (existing.hasOrders) {
      throw new BadRequestException(
        `Bảng giá [${existing.code}] đã phát sinh đơn hàng thực tế trong hệ thống. Tuyệt đối không được chỉnh sửa trực tiếp nội dung để bảo đảm tính toàn vẹn chứng từ kế toán. Vui lòng sử dụng tính năng "Tạo phiên bản mới (Clone Version)".`,
      );
    }

    // Kiểm tra ngày áp dụng nếu có cập nhật
    const startDate = updateDto.startDate || existing.startDate;
    const endDate = updateDto.endDate || existing.endDate;
    if (new Date(endDate) < new Date(startDate)) {
      throw new BadRequestException('Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.');
    }

    // Kiểm tra trùng mã nếu đổi mã
    if (updateDto.code && updateDto.code.trim().toUpperCase() !== existing.code.toUpperCase()) {
      const duplicate = Array.from(this.priceLists.values()).find(
        (pl) =>
          pl.id !== id &&
          pl.code.toUpperCase() === updateDto.code!.trim().toUpperCase(),
      );
      if (duplicate) {
        throw new BadRequestException(`Mã bảng giá "${updateDto.code}" đã được sử dụng.`);
      }
      existing.code = updateDto.code.trim();
    }

    // Kiểm tra ràng buộc giá sàn nếu cập nhật danh sách mặt hàng
    if (updateDto.items) {
      this.validateItemsMinPrice(updateDto.items);
      existing.items = updateDto.items.map((it, idx) => {
        return new PriceListItemEntity({
          id: `pli-${Date.now().toString(36)}-${idx}`,
          priceListId: existing.id,
          productId: it.productId,
          productCode: it.productCode,
          productName: it.productName,
          price: Number(it.price) || 0,
          minPrice: Number(it.minPrice) || 0,
          baseUnit: it.baseUnit || 'Cái',
        });
      });
    }

    if (updateDto.name !== undefined) existing.name = updateDto.name.trim();
    if (updateDto.customerGroup !== undefined) existing.customerGroup = updateDto.customerGroup;
    if (updateDto.startDate !== undefined) existing.startDate = startDate;
    if (updateDto.endDate !== undefined) existing.endDate = endDate;
    if (updateDto.status !== undefined) existing.status = updateDto.status;
    if (updateDto.description !== undefined) existing.description = updateDto.description.trim();
    existing.updatedAt = new Date();

    this.priceLists.set(existing.id, existing);

    // Đồng bộ DB nếu có kết nối
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE price_lists
           SET code = $1, name = $2, customer_group = $3, start_date = $4, end_date = $5, status = $6, description = $7, updated_at = $8
           WHERE id = $9;`,
          [
            existing.code,
            existing.name,
            existing.customerGroup,
            existing.startDate,
            existing.endDate,
            existing.status,
            existing.description,
            existing.updatedAt,
            existing.id,
          ],
        );
      } catch {
        // Ignored
      }
    }

    return existing;
  }

  /**
   * Cập nhật trạng thái bảng giá (Active / Inactive / Expired / Draft)
   */
  async updateStatus(id: string, status: PriceListStatus): Promise<PriceListEntity> {
    const existing = await this.findById(id);
    existing.status = status;
    existing.updatedAt = new Date();
    this.priceLists.set(existing.id, existing);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE price_lists SET status = $1, updated_at = $2 WHERE id = $3;`,
          [status, existing.updatedAt, existing.id],
        );
      } catch {
        // Ignored
      }
    }

    return existing;
  }

  /**
   * NHÂN BẢN BẢNG GIÁ (Clone Version):
   * Cho phép sao chép nguyên vẹn cơ cấu mặt hàng của bảng giá gốc sang phiên bản mới
   * Phiên bản mới có version = parent.version + 1, trạng thái DRAFT, hasOrders = false
   */
  async clone(id: string, cloneDto?: ClonePriceListDto): Promise<PriceListEntity> {
    const source = await this.findById(id);
    const nextVersion = (source.version || 1) + 1;

    let newCode = cloneDto?.code?.trim();
    if (!newCode) {
      newCode = `${source.code}-V${nextVersion}`;
    }

    // Đảm bảo mã mới không bị trùng
    let uniqueCode = newCode;
    let counter = 1;
    while (
      Array.from(this.priceLists.values()).some(
        (p) => p.code.toUpperCase() === uniqueCode.toUpperCase(),
      )
    ) {
      uniqueCode = `${newCode}-${counter++}`;
    }

    const newName =
      cloneDto?.name?.trim() || `${source.name} (v${nextVersion}.0)`;

    const newId = `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    // Sao chép các mặt hàng từ bảng giá nguồn với ID mới
    const clonedItems: PriceListItemEntity[] = source.items.map((it, idx) => {
      return new PriceListItemEntity({
        id: `pli-${Date.now().toString(36)}-${idx}`,
        priceListId: newId,
        productId: it.productId,
        productCode: it.productCode,
        productName: it.productName,
        price: it.price,
        minPrice: it.minPrice,
        baseUnit: it.baseUnit,
      });
    });

    const clonedEntity = new PriceListEntity({
      id: newId,
      code: uniqueCode,
      name: newName,
      customerGroup: source.customerGroup,
      startDate: source.startDate,
      endDate: source.endDate,
      status: PriceListStatus.DRAFT,
      version: nextVersion,
      parentVersionId: source.id,
      hasOrders: false,
      description: `Phiên bản v${nextVersion}.0 nhân bản từ [${source.code}] ${source.name}`,
      items: clonedItems,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.priceLists.set(clonedEntity.id, clonedEntity);
    await this.insertPriceListToDb(clonedEntity);

    return clonedEntity;
  }

  /**
   * XÓA BẢNG GIÁ:
   * Chặn xóa nếu bảng giá đã phát sinh đơn hàng (hasOrders == true)
   */
  async delete(id: string): Promise<{ success: boolean; message: string }> {
    const existing = await this.findById(id);

    // QUY TẮC RÀNG BUỘC TOÀN VẸN ĐƠN HÀNG
    if (existing.hasOrders) {
      throw new BadRequestException(
        `Bảng giá [${existing.code}] đã phát sinh đơn hàng trong hệ thống. Không thể xóa để bảo đảm tính toàn vẹn dữ liệu đơn hàng!`,
      );
    }

    this.priceLists.delete(existing.id);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(`DELETE FROM price_lists WHERE id = $1;`, [
          existing.id,
        ]);
      } catch {
        // Ignored
      }
    }

    return {
      success: true,
      message: `Đã xóa bảng giá "${existing.name}" [${existing.code}] khỏi hệ thống.`,
    };
  }

  /**
   * Đánh dấu Bảng giá đã phát sinh đơn hàng (hasOrders = true)
   */
  async markPriceListHasOrders(idOrCode: string): Promise<void> {
    if (!idOrCode) return;
    const pl =
      this.priceLists.get(idOrCode) ||
      Array.from(this.priceLists.values()).find(
        (p) => p.code.toUpperCase() === idOrCode.toUpperCase(),
      );
    if (pl && !pl.hasOrders) {
      pl.hasOrders = true;
      pl.updatedAt = new Date();
      this.priceLists.set(pl.id, pl);
      if (this.dbService?.isConnected()) {
        try {
          await this.dbService.query(
            'UPDATE price_lists SET has_orders = TRUE, updated_at = $2 WHERE id = $1',
            [pl.id, pl.updatedAt],
          );
        } catch {
          // ignore
        }
      }
    }
  }
}
