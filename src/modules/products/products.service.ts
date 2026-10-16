import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { CategoriesService } from '../categories/categories.service';
import { DatabaseService } from '../../database/database.service';
import { ProductStatus } from '../../common/enums/product-status.enum';
import { CreateProductDto } from './dto/create-product.dto';
import { GetProductsFilterDto } from './dto/get-products-filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity } from './entities/product.entity';
import { ProductUnitEntity } from './entities/product-unit.entity';
import { ProductPriceHistory } from './entities/product-price-history.entity';
import { PaginatedProductsResponse } from './interfaces/paginated-products.interface';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import {
  ImportProductItemDto,
  PreviewImportResult,
  ConfirmImportResult,
} from './dto/import-product.dto';
import { ProductUnitDto } from './dto/product-unit.dto';
import { OrdersService } from '../orders/orders.service';
import { DEFAULT_WAREHOUSE_ID } from '../warehouses/warehouse.constants';
import { randomUUID } from 'crypto';

/**
 * Service Quản lý Sản phẩm & SKU Hàng hóa (SN-138 & SN-20):
 * - Xử lý nghiệp vụ CRUD danh mục SKU, tính toán biên lợi nhuận (margin)
 * - Ràng buộc tính duy nhất của mã SKU (chuẩn hóa uppercase, không khoảng trắng)
 * - Ràng buộc toàn vẹn dữ liệu: Chặn xóa sản phẩm đã phát sinh giao dịch đơn hàng / phiếu kho
 * - Tìm kiếm đa trường (SKU, Tên) và phân trang linh hoạt
 */
@Injectable()
export class ProductsService implements OnModuleInit {
  private products = new Map<string, ProductEntity>();

  /**
   * Lưu trữ lịch sử giá trong bộ nhớ (In-memory fallback & cache) - SN-29
   * Key: productId hoặc SKU (lowercase)
   */
  private priceHistories = new Map<string, ProductPriceHistory[]>();

  /**
   * Danh sách ID/SKU đã phát sinh giao dịch đơn hàng (order_items) hoặc kho (inventory_transactions)
   */
  private transactionProductIds = new Set<string>([
    'prod-001',
    'prod-002',
    'prod-003',
    'prod-004',
    'prod-005',
    'prod-006',
    'prod-011',
    'LH-MILK-900G',
    'LH-NUT-180ML',
    'LH-NEST-70ML',
    'LH-CEREAL-500G',
    'LH-COLLAGEN-50ML',
    'LH-TEA-240ML',
    'LH-OLD-COFFEE-CAN',
  ]);

  constructor(
    @Optional() private readonly dbService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => CategoriesService))
    private readonly categoriesService?: CategoriesService,
    @Optional()
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService?: OrdersService,
  ) {
    this.seedInitialProducts();
  }

  /**
   * Tính toán và cập nhật tồn khả dụng cho thực thể sản phẩm (SN-39):
   * availableStock = physicalStock (Tồn thực tế) - reservedStock (Tồn đang giữ chỗ)
   */
  public populateProductStock(
    product: ProductEntity,
    reservedMap?: Map<string, number>,
  ): ProductEntity {
    const reserved = reservedMap
      ? (reservedMap.get(product.id) ||
          (product.sku ? reservedMap.get(product.sku.toUpperCase()) : 0) ||
          0)
      : this.ordersService
      ? this.ordersService.getReservedStock(product.id || product.sku)
      : 0;

    product.physicalStock = product.stockQuantity ?? 0;
    product.reservedStock = reserved;
    const computedAvailable = Math.max(0, product.physicalStock - reserved);
    product.availableStock = computedAvailable;
    product.availableQuantity = computedAvailable;
    if (!product.uuid && product.id) {
      const match = product.id.match(/^prod-(\d+)$/i);
      if (match) {
        product.uuid = `33333333-0000-0000-0000-${String(parseInt(match[1], 10)).padStart(12, '0')}`;
      }
    }
    return product;
  }

  /**
   * Trừ tồn khả dụng của sản phẩm khi đặt hàng thành công (SN-42):
   * product.availableStock = product.availableStock - quantity
   */
  public deductAvailableStock(productIdOrSku: string, quantity: number): number {
    const product = this.findProductInternal(productIdOrSku);
    if (!product) return 0;

    const currentStock = typeof product.availableStock === 'number'
      ? product.availableStock
      : Math.max(0, (product.stockQuantity ?? 0) - (this.ordersService?.getReservedStock(product.id || product.sku) ?? 0));

    product.availableStock = Math.max(0, currentStock - quantity);
    product.availableQuantity = product.availableStock;
    return product.availableStock;
  }

  /**
   * Hoàn lại tồn khả dụng khi đơn hàng bị hủy (SN-180 AC2)
   */
  public restoreAvailableStock(productIdOrSku: string, quantity: number): number {
    const product = this.findProductInternal(productIdOrSku);
    if (!product) return 0;
    this.populateProductStock(product);
    return product.availableStock;
  }

  async onModuleInit(): Promise<void> {
    if (this.products.size === 0) {
      this.seedInitialProducts();
    }
    if (this.dbService?.isConnected()) {
      await this.ensurePriceHistoryTable();
      await this.loadProductsFromDatabase();
      await this.loadPersistedStockBalances();
    }
  }

  private async ensurePriceHistoryTable(): Promise<void> {
    if (!this.dbService?.isConnected()) return;
    try {
      await this.dbService.query(`
        CREATE TABLE IF NOT EXISTS product_price_histories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id VARCHAR(255) NOT NULL,
          old_price NUMERIC(15, 2) NOT NULL,
          new_price NUMERIC(15, 2) NOT NULL,
          changed_by VARCHAR(255) NOT NULL,
          changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_product_price_histories_product_id ON product_price_histories(product_id);
        CREATE INDEX IF NOT EXISTS idx_product_price_histories_changed_at ON product_price_histories(changed_at DESC);
      `);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ProductsService] Lỗi khởi tạo bảng product_price_histories:', msg);
    }
  }

  private async loadPersistedStockBalances(): Promise<void> {
    if (!this.dbService?.isConnected()) return;
    const table = await this.dbService.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.app_inventory_stock_balances')::text AS table_name`,
    );
    if (!table[0]?.table_name) return;
    const balances = await this.dbService.query<{
      product_sku: string;
      physical_quantity: string;
    }>(
      `SELECT product_sku, physical_quantity::text FROM app_inventory_stock_balances
       WHERE warehouse_id = $1::uuid`,
      [DEFAULT_WAREHOUSE_ID],
    );
    const balanceBySku = new Map(
      balances.map((balance) => [balance.product_sku.toUpperCase(), Number(balance.physical_quantity)]),
    );
    for (const product of this.products.values()) {
      const balance = balanceBySku.get(product.sku.toUpperCase());
      if (balance !== undefined) product.stockQuantity = balance;
    }
  }

  /**
   * Tải danh mục sản phẩm từ cơ sở dữ liệu PostgreSQL (nếu đã kết nối)
   */
  private async loadProductsFromDatabase(): Promise<void> {
    try {
      const rows = await this.dbService!.query<{
        id: string;
        sku: string;
        name: string;
        category_id: number;
        category_name?: string;
        category_code?: string;
        parent_category_name?: string;
        base_unit: string;
        cost_price: string | number;
        status: string;
        image_url?: string;
        created_at: Date;
        updated_at: Date;
        price?: string | number;
        stock_quantity?: string | number;
        is_batch_managed?: boolean;
      }>(
        `SELECT p.id, p.sku, p.name, p.category_id, p.base_unit, p.cost_price, p.status, p.image_url, p.is_batch_managed, p.created_at, p.updated_at,
                c.name as category_name, c.code as category_code,
                pcat.name as parent_category_name,
                COALESCE(pli.price, ROUND(p.cost_price * 1.35)) as price,
                COALESCE(inv.on_hand, 0) as stock_quantity
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN categories pcat ON c.parent_id = pcat.id
         LEFT JOIN LATERAL (
           SELECT price FROM price_list_items 
           WHERE product_id = p.id 
           ORDER BY created_at ASC LIMIT 1
         ) pli ON true
         LEFT JOIN LATERAL (
           SELECT SUM(on_hand) as on_hand FROM inventories 
           WHERE product_id = p.id
         ) inv ON true;`,
      );

      if (rows && rows.length > 0) {
        // Khi PostgreSQL đã có sản phẩm thực tế, loại bỏ hoàn toàn mock tĩnh để tránh lệch Foreign Key
        this.products.clear();

        // Tải danh sách đơn vị tính quy đổi của từng sản phẩm từ PostgreSQL
        let unitsByProductId = new Map<string, ProductUnitEntity[]>();
        try {
          const unitRows = await this.dbService!.query<{
            id: string;
            product_id: string;
            unit_name: string;
            conversion_factor: string | number;
            is_base_unit: boolean;
          }>(
            `SELECT id, product_id, unit_name, conversion_factor, is_base_unit FROM product_units;`
          );
          for (const u of unitRows) {
            const list = unitsByProductId.get(u.product_id) || [];
            list.push(
              new ProductUnitEntity({
                id: u.id,
                unitName: u.unit_name,
                conversionRate: Number(u.conversion_factor) || 1,
                isBaseUnit: Boolean(u.is_base_unit),
              }),
            );
            unitsByProductId.set(u.product_id, list);
          }
        } catch {
          // Fallback nếu bảng product_units trống
        }

        for (const row of rows) {
          const catName = row.category_name || 'Đồ uống & Nước giải khát';
          const parentName = row.parent_category_name || catName;
          const fullCat = row.parent_category_name ? `${parentName} / ${catName}` : catName;
          const costPrice = Number(row.cost_price) || 0;
          const sellingPrice = Number(row.price) || Math.round(costPrice * 1.35);
          const stock = Number(row.stock_quantity) || 0;

          const productUnits = unitsByProductId.get(row.id) || [];
          if (productUnits.length === 0) {
            productUnits.push(
              new ProductUnitEntity({
                id: `unit-${row.id}-base`,
                unitName: row.base_unit || 'Cái',
                conversionRate: 1,
                isBaseUnit: true,
              }),
            );
          }

          const entity = new ProductEntity({
            id: row.id,
            sku: row.sku,
            name: row.name,
            categoryId: row.category_id ? String(row.category_id) : undefined,
            category: fullCat,
            parentCategory: parentName,
            subCategory: catName,
            baseUnit: row.base_unit || 'Cái',
            units: productUnits,
            costPrice,
            price: sellingPrice,
            stockQuantity: stock,
            status: (row.status as ProductStatus) || ProductStatus.ACTIVE,
            imageUrl: row.image_url,
            isBatchManaged: row.is_batch_managed !== undefined ? Boolean(row.is_batch_managed) : true,
            hasTransactions: false,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
          });
          this.products.set(entity.id, entity);
        }
      }
    } catch {
      // Fallback êm ái nếu có lỗi truy vấn
    }
  }

  /**
   * Khởi tạo danh mục sản phẩm mẫu chuẩn hóa nghiệp vụ FMCG & Đồ uống
   */
  private seedInitialProducts(): void {
    const initialList: Partial<ProductEntity>[] = [
      {
        id: 'prod-001',
        sku: 'LH-MILK-900G',
        name: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        categoryId: 'cat-milk-powder',
        parentCategory: 'Sữa & Chế phẩm sữa',
        subCategory: 'Sữa bột công thức',
        category: 'Sữa & Chế phẩm sữa / Sữa bột công thức',
        baseUnit: 'Lon',
        packagingSpec: '24 lon/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Lon', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Lốc', conversionRate: 6, isBaseUnit: false }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 24, isBaseUnit: false }),
        ],
        price: 520000,
        costPrice: 380000,
        margin: 26.92,
        stockQuantity: 1500,
        status: ProductStatus.ACTIVE,
        hasTransactions: true,
        imageUrl:
          'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&auto=format&fit=crop&q=80',
        description:
          'Dòng sữa dinh dưỡng cao cấp bổ sung Canxi, DHA cho trẻ nhỏ và người cao tuổi',
      },
      {
        id: 'prod-002',
        sku: 'LH-NUT-180ML',
        name: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
        categoryId: 'cat-milk-nut',
        parentCategory: 'Sữa & Chế phẩm sữa',
        subCategory: 'Sữa hạt organic',
        category: 'Sữa & Chế phẩm sữa / Sữa hạt organic',
        baseUnit: 'Hộp',
        packagingSpec: '48 hộp/thùng (12 lốc x 4 hộp)',
        units: [
          new ProductUnitEntity({ unitName: 'Hộp', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Lốc', conversionRate: 4, isBaseUnit: false }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 48, isBaseUnit: false }),
        ],
        price: 18000,
        costPrice: 11500,
        margin: 36.11,
        stockQuantity: 1200,
        status: ProductStatus.ACTIVE,
        hasTransactions: true,
        imageUrl:
          'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&auto=format&fit=crop&q=80',
        description:
          'Sữa hạt thuần chay ít đường, giàu omega-3 tốt cho tim mạch và trí não',
      },
      {
        id: 'prod-003',
        sku: 'LH-NEST-70ML',
        name: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
        categoryId: 'cat-nest-ready',
        parentCategory: 'Nước yến & Bổ dưỡng',
        subCategory: 'Nước yến chưng sẵn',
        category: 'Nước yến & Bổ dưỡng / Nước yến chưng sẵn',
        baseUnit: 'Hũ',
        packagingSpec: '30 hũ/thùng (5 hộp x 6 hũ)',
        units: [
          new ProductUnitEntity({ unitName: 'Hũ', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Hộp', conversionRate: 6, isBaseUnit: false }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 30, isBaseUnit: false }),
        ],
        price: 65000,
        costPrice: 42000,
        margin: 35.38,
        stockQuantity: 580,
        status: ProductStatus.ACTIVE,
        hasTransactions: true,
        imageUrl:
          'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=200&auto=format&fit=crop&q=80',
        description:
          'Tổ yến đảo thiên nhiên chưng đường phèn thanh mát bồi bổ khí huyết',
      },
      {
        id: 'prod-004',
        sku: 'LH-CEREAL-500G',
        name: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
        categoryId: 'cat-cereal-sprout',
        parentCategory: 'Ngũ cốc & Hạt dinh dưỡng',
        subCategory: 'Ngũ cốc hạt mầm',
        category: 'Ngũ cốc & Hạt dinh dưỡng / Ngũ cốc hạt mầm',
        baseUnit: 'Túi',
        packagingSpec: '20 túi/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Túi', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 20, isBaseUnit: false }),
        ],
        price: 145000,
        costPrice: 95000,
        margin: 34.48,
        stockQuantity: 410,
        status: ProductStatus.ACTIVE,
        hasTransactions: true,
        description: 'Hỗn hợp 12 loại hạt mầm nướng chín nguyên chất',
      },
      {
        id: 'prod-005',
        sku: 'LH-COLLAGEN-50ML',
        name: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
        categoryId: 'cat-supp-collagen',
        parentCategory: 'Thực phẩm chức năng',
        subCategory: 'Collagen & Chống lão hóa',
        category: 'Thực phẩm chức năng / Collagen & Chống lão hóa',
        baseUnit: 'Chai',
        packagingSpec: '30 chai/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Chai', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Hộp', conversionRate: 10, isBaseUnit: false }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 30, isBaseUnit: false }),
        ],
        price: 85000,
        costPrice: 55000,
        margin: 35.29,
        stockQuantity: 260,
        status: ProductStatus.ACTIVE,
        hasTransactions: true,
        description:
          'Collagen thủy phân kết hợp chiết xuất đông trùng hạ thảo tự nhiên',
      },
      {
        id: 'prod-006',
        sku: 'LH-TEA-240ML',
        name: 'Trà Hoa Cúc La Hán Quả Thanh Nhiệt 240ml',
        categoryId: 'cat-bev-tea',
        parentCategory: 'Nước giải khát & Trà',
        subCategory: 'Trà thảo mộc thanh nhiệt',
        category: 'Nước giải khát & Trà / Trà thảo mộc thanh nhiệt',
        baseUnit: 'Lon',
        packagingSpec: '24 lon/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Lon', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Lốc', conversionRate: 6, isBaseUnit: false }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 24, isBaseUnit: false }),
        ],
        price: 15000,
        costPrice: 9200,
        margin: 38.67,
        stockQuantity: 890,
        status: ProductStatus.ACTIVE,
        hasTransactions: true,
        imageUrl:
          'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=200&auto=format&fit=crop&q=80',
        description:
          'Trà hoa cúc nguyên bông nấu la hán quả thanh nhiệt giải độc',
      },
      {
        id: 'prod-007',
        sku: 'LH-WATER-500ML',
        name: 'Nước Khoáng Kiềm Thiên Nhiên Loha Ion 500ml',
        categoryId: 'cat-bev-water',
        parentCategory: 'Nước giải khát & Trà',
        subCategory: 'Nước khoáng thiên nhiên',
        category: 'Nước giải khát & Trà / Nước khoáng thiên nhiên',
        baseUnit: 'Chai',
        packagingSpec: '24 chai/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Chai', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Lốc', conversionRate: 6, isBaseUnit: false }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 24, isBaseUnit: false }),
        ],
        price: 12000,
        costPrice: 6800,
        margin: 43.33,
        stockQuantity: 1500,
        status: ProductStatus.ACTIVE,
        hasTransactions: false,
        imageUrl:
          'https://images.unsplash.com/photo-1548839140-29a749e1bc4e?w=200&auto=format&fit=crop&q=80',
        description:
          'Nước khoáng kiềm pH 9.0 khai thác từ mạch nước ngầm núi cao',
      },
      {
        id: 'prod-008',
        sku: 'LH-MILK-PAST-1L',
        name: 'Sữa Tươi Thanh Trùng Nguyên Chất 1 Lít',
        categoryId: 'cat-milk-ready',
        parentCategory: 'Sữa & Chế phẩm sữa',
        subCategory: 'Sữa tươi & Tiệt trùng',
        category: 'Sữa & Chế phẩm sữa / Sữa tươi & Tiệt trùng',
        baseUnit: 'Chai',
        packagingSpec: '12 chai/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Chai', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 12, isBaseUnit: false }),
        ],
        price: 38000,
        costPrice: 26000,
        margin: 31.58,
        stockQuantity: 180,
        status: ProductStatus.ACTIVE,
        hasTransactions: false,
        imageUrl:
          'https://images.unsplash.com/photo-1528750997573-59b89d56f4f7?w=200&auto=format&fit=crop&q=80',
        description: '100% sữa bò tươi thanh trùng bảo quản lạnh 2-4 độ C',
      },
      {
        id: 'prod-009',
        sku: 'LH-NEST-PREM-100G',
        name: 'Hộp Quà Yến Sào Tinh Chế Thượng Hạng 100g',
        categoryId: 'cat-nest-pure',
        parentCategory: 'Nước yến & Bổ dưỡng',
        subCategory: 'Tổ yến sào tinh chế',
        category: 'Nước yến & Bổ dưỡng / Tổ yến sào tinh chế',
        baseUnit: 'Hộp',
        packagingSpec: '10 hộp/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Hộp', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 10, isBaseUnit: false }),
        ],
        price: 4200000,
        costPrice: 3100000,
        margin: 26.19,
        stockQuantity: 45,
        status: ProductStatus.ACTIVE,
        hasTransactions: false,
        imageUrl:
          'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=200&auto=format&fit=crop&q=80',
        description:
          'Tổ yến tai to đều sạch lông sấy khô tiệt trùng kèm đường phèn táo đỏ',
      },
      {
        id: 'prod-010',
        sku: 'LH-NUTS-MIX-250G',
        name: 'Hạt Hỗn Hợp Macca Óc Chó Hạnh Nhân Sấy Giòn 250g',
        categoryId: 'cat-cereal-nuts',
        parentCategory: 'Ngũ cốc & Hạt dinh dưỡng',
        subCategory: 'Hạt dinh dưỡng sấy giòn',
        category: 'Ngũ cốc & Hạt dinh dưỡng / Hạt dinh dưỡng sấy giòn',
        baseUnit: 'Hũ',
        packagingSpec: '24 hũ/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Hũ', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Lốc', conversionRate: 6, isBaseUnit: false }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 24, isBaseUnit: false }),
        ],
        price: 135000,
        costPrice: 88000,
        margin: 34.81,
        stockQuantity: 320,
        status: ProductStatus.ACTIVE,
        hasTransactions: false,
        imageUrl:
          'https://images.unsplash.com/photo-1508061253366-f7da158b6d46?w=200&auto=format&fit=crop&q=80',
        description:
          'Hạt dinh dưỡng nhập khẩu sấy mộc không muối thơm ngậy giòn tan',
      },
      {
        id: 'prod-011',
        sku: 'LH-OLD-COFFEE-CAN',
        name: 'Cà Phê Sữa Đóng Lon Loha Classic 240ml (Mẫu Cũ)',
        categoryId: 'cat-bev-tea',
        parentCategory: 'Nước giải khát & Trà',
        subCategory: 'Trà thảo mộc thanh nhiệt',
        category: 'Nước giải khát & Trà / Trà thảo mộc thanh nhiệt',
        baseUnit: 'Lon',
        packagingSpec: '24 lon/thùng',
        units: [
          new ProductUnitEntity({ unitName: 'Lon', conversionRate: 1, isBaseUnit: true }),
          new ProductUnitEntity({ unitName: 'Lốc', conversionRate: 6, isBaseUnit: false }),
          new ProductUnitEntity({ unitName: 'Thùng', conversionRate: 24, isBaseUnit: false }),
        ],
        price: 14000,
        costPrice: 9000,
        margin: 35.71,
        stockQuantity: 0,
        status: ProductStatus.INACTIVE,
        hasTransactions: true,
        description:
          'Sản phẩm phiên bản cũ năm 2025, hiện đã ngừng kinh doanh để thay thế mẫu mới',
      },
    ];

    for (let i = 0; i < initialList.length; i++) {
      const item = initialList[i];
      const uuid = `33333333-0000-0000-0000-${String(i + 1).padStart(12, '0')}`;
      item.uuid = uuid;
      const entity = new ProductEntity(item as Partial<ProductEntity>);
      this.products.set(entity.id, entity);
    }
  }

  /**
   * Lấy danh sách sản phẩm dạng mảng phẳng (Tương thích nội bộ và unit test)
   */
  async findAll(filterDto?: GetProductsFilterDto): Promise<ProductEntity[]> {
    if (this.dbService?.isConnected()) {
      await this.loadProductsFromDatabase();
    }
    if (!filterDto || Object.keys(filterDto).length === 0) {
      const reservedMap = this.ordersService?.getReservedStockMap();
      return Array.from(this.products.values()).map((p) =>
        this.populateProductStock(p, reservedMap),
      );
    }
    const paginated = await this.findAllPaginated(filterDto);
    return paginated.data;
  }

  /**
   * Lấy danh sách sản phẩm phân trang, tìm kiếm và lọc danh mục / trạng thái
   * GET /api/products
   */
  async findAllPaginated(
    filterDto: GetProductsFilterDto = {},
  ): Promise<PaginatedProductsResponse> {
    const {
      page = 1,
      limit = 20,
      search,
      categoryId,
      parentCategory,
      subCategory,
      category,
      status,
    } = filterDto;

    if (this.dbService?.isConnected()) {
      await this.loadProductsFromDatabase();
    }

    let items = Array.from(this.products.values());

    // 1. Tìm kiếm tương đối theo SKU, Tên sản phẩm
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (p) =>
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q),
      );
    }

    // 2. Lọc theo categoryId (hỗ trợ phân cấp cây: nhóm cha hiển thị tất cả sản phẩm của nhánh con/cháu)
    if (categoryId && categoryId !== 'ALL') {
      const cid = categoryId.trim().toLowerCase();
      const targetSet = new Set<string>([cid]);

      if (this.categoriesService) {
        const cat = this.categoriesService.findCategoryInternal(categoryId);
        if (cat) {
          targetSet.add(cat.id.toLowerCase().trim());
          if (cat.code) targetSet.add(cat.code.toLowerCase().trim());
          const descendantIds = this.categoriesService.getDescendantIds(cat.id);
          for (const dId of descendantIds) {
            targetSet.add(dId.toLowerCase().trim());
            const dCat = this.categoriesService.findCategoryInternal(dId);
            if (dCat?.code) targetSet.add(dCat.code.toLowerCase().trim());
          }
        }
      }

      items = items.filter((p) => {
        if (p.categoryId) {
          const pCid = p.categoryId.toLowerCase().trim();
          if (targetSet.has(pCid)) return true;
          if (this.categoriesService) {
            const resolved = this.categoriesService.findCategoryInternal(pCid);
            if (
              resolved &&
              (targetSet.has(resolved.id.toLowerCase().trim()) ||
                (resolved.code && targetSet.has(resolved.code.toLowerCase().trim())))
            ) {
              return true;
            }
          }
          return false;
        }
        return p.id && targetSet.has(p.id.toLowerCase().trim());
      });
    }

    // 2. Lọc theo nhóm hàng cấp 1 (parentCategory - hỗ trợ tên tiếng Việt, code hoặc ID)
    if (parentCategory && parentCategory !== 'ALL') {
      const parentTrim = parentCategory.trim();
      const parentLower = parentTrim.toLowerCase();
      const matchSet = new Set<string>([parentLower]);

      if (this.categoriesService) {
        const cat = this.categoriesService.findCategoryInternal(parentTrim);
        if (cat) {
          if (cat.name) matchSet.add(cat.name.trim().toLowerCase());
          if (cat.code) matchSet.add(cat.code.trim().toLowerCase());
          if (cat.id) matchSet.add(cat.id.trim().toLowerCase());
        }
      }

      items = items.filter((p) => {
        const pParent = p.parentCategory?.trim().toLowerCase();
        const pCat = p.category?.trim().toLowerCase();
        for (const target of matchSet) {
          if (pParent && pParent === target) return true;
          if (pCat && pCat.includes(target)) return true;
        }
        return false;
      });
    }

    // 3. Lọc theo nhóm hàng cấp 2 (subCategory - hỗ trợ tên tiếng Việt, code hoặc ID)
    if (subCategory && subCategory !== 'ALL') {
      const subTrim = subCategory.trim();
      const subLower = subTrim.toLowerCase();
      const matchSet = new Set<string>([subLower]);

      if (this.categoriesService) {
        const cat = this.categoriesService.findCategoryInternal(subTrim);
        if (cat) {
          if (cat.name) matchSet.add(cat.name.trim().toLowerCase());
          if (cat.code) matchSet.add(cat.code.trim().toLowerCase());
          if (cat.id) matchSet.add(cat.id.trim().toLowerCase());
        }
      }

      items = items.filter((p) => {
        const pSub = p.subCategory?.trim().toLowerCase();
        const pCat = p.category?.trim().toLowerCase();
        for (const target of matchSet) {
          if (pSub && pSub === target) return true;
          if (pCat && pCat.includes(target)) return true;
        }
        return false;
      });
    }

    // 4. Lọc theo ngành hàng (category)
    if (category && category !== 'ALL') {
      const catLower = category.trim().toLowerCase();
      items = items.filter(
        (p) => p.category && p.category.toLowerCase().includes(catLower),
      );
    }

    // 5. Lọc theo trạng thái hoạt động (ACTIVE / INACTIVE)
    if (status && (status as string) !== 'ALL') {
      const statusUpper = String(status).toUpperCase();
      items = items.filter((p) => String(p.status).toUpperCase() === statusUpper);
    }

    const total = items.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const safePage = Math.max(1, page);
    const startIndex = (safePage - 1) * limit;
    const reservedMap = this.ordersService?.getReservedStockMap();
    const data = items
      .slice(startIndex, startIndex + limit)
      .map((p) => this.populateProductStock(p, reservedMap));

    return {
      data,
      total,
      page: safePage,
      limit,
      totalPages,
    };
  }

  /**
   * Ghi nhận lịch sử điều chỉnh giá bán sản phẩm (SN-29)
   * Bảng này chỉ cho phép INSERT và SELECT (không sửa, không xóa)
   */
  public async recordPriceHistory(
    product: ProductEntity,
    oldPrice: number,
    newPrice: number,
    changedBy: string,
  ): Promise<ProductPriceHistory> {
    const historyId = randomUUID();
    const changedAt = new Date();

    const historyRecord = new ProductPriceHistory({
      id: historyId,
      productId: product.id,
      oldPrice,
      newPrice,
      changedBy: changedBy || 'Quản trị viên',
      changedAt,
    });

    // 1. Lưu vào in-memory cache cho cả product.id và product.sku
    const key = product.id.toLowerCase().trim();
    const currentList = this.priceHistories.get(key) || [];
    currentList.unshift(historyRecord);
    this.priceHistories.set(key, currentList);

    if (product.sku) {
      const skuKey = product.sku.toLowerCase().trim();
      if (skuKey !== key) {
        const skuList = this.priceHistories.get(skuKey) || [];
        skuList.unshift(historyRecord);
        this.priceHistories.set(skuKey, skuList);
      }
    }

    // 2. Lưu vào PostgreSQL nếu đã kết nối
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `INSERT INTO product_price_histories (id, product_id, old_price, new_price, changed_by, changed_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [historyId, product.id, oldPrice, newPrice, changedBy || 'Quản trị viên', changedAt],
        );
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ProductsService] Lỗi khi lưu lịch sử giá SP ${product.id} vào DB:`, errorMsg);
      }
    }

    return historyRecord;
  }

  /**
   * Lấy lịch sử thay đổi giá của 1 sản phẩm (SN-29)
   * Trả về danh sách sắp xếp theo thời gian mới nhất lên đầu (ORDER BY changedAt DESC)
   */
  async getPriceHistory(productIdOrSku: string): Promise<ProductPriceHistory[]> {
    // Kiểm tra sản phẩm có tồn tại trên hệ thống không
    const product = await this.findById(productIdOrSku);

    // 1. Truy vấn từ cơ sở dữ liệu PostgreSQL nếu có kết nối
    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<{
          id: string;
          product_id: string;
          old_price: string | number;
          new_price: string | number;
          changed_by: string;
          changed_at: string | Date;
        }>(
          `SELECT id, product_id, old_price, new_price, changed_by, changed_at
           FROM product_price_histories
           WHERE product_id = $1 OR product_id = $2
           ORDER BY changed_at DESC`,
          [product.id, product.sku],
        );

        if (rows && rows.length > 0) {
          const dbRecords = rows.map(
            (row) =>
              new ProductPriceHistory({
                id: row.id,
                productId: row.product_id,
                oldPrice: Number(row.old_price),
                newPrice: Number(row.new_price),
                changedBy: row.changed_by,
                changedAt: new Date(row.changed_at),
              }),
          );

          // Cập nhật lại cache in-memory
          const key = product.id.toLowerCase().trim();
          this.priceHistories.set(key, dbRecords);

          return dbRecords;
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[ProductsService] Lỗi khi lấy lịch sử giá SP ${product.id}:`, errorMsg);
      }
    }

    // 2. Tra cứu từ in-memory cache nếu DB chưa có bản ghi hoặc chưa kết nối
    const key = product.id.toLowerCase().trim();
    const skuKey = product.sku ? product.sku.toLowerCase().trim() : '';
    const memList =
      this.priceHistories.get(key) ||
      (skuKey ? this.priceHistories.get(skuKey) : []) ||
      [];

    return [...memList].sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
  }

  /**
   * Lấy chi tiết sản phẩm theo ID hoặc SKU
   * GET /api/products/:id
   */
  async findById(idOrSku: string): Promise<ProductEntity> {
    const product = this.findProductInternal(idOrSku);

    if (!product) {
      throw new NotFoundException(
        `Không tìm thấy sản phẩm có mã hoặc ID: ${idOrSku}`,
      );
    }

    return this.populateProductStock(product);
  }

  /**
   * Thêm mới SKU sản phẩm
   * POST /api/products
   * Quyền: ADMIN, SALES_MANAGER
   */
  async create(dto: CreateProductDto): Promise<ProductEntity> {
    const cleanSku = dto.sku ? dto.sku.trim().toUpperCase() : '';

    if (!cleanSku) {
      throw new BadRequestException('Mã SKU không được để trống');
    }

    if (/\s/.test(cleanSku)) {
      throw new BadRequestException('Mã SKU không được chứa khoảng trắng');
    }

    // Ràng buộc tính duy nhất của mã SKU
    const existing = this.findProductInternal(cleanSku);
    if (existing) {
      throw new BadRequestException('Mã SKU đã tồn tại trên hệ thống');
    }

    if (dto.price <= 0) {
      throw new BadRequestException('Giá bán phải là số dương lớn hơn 0');
    }

    const costPrice =
      dto.costPrice !== undefined ? Number(dto.costPrice) : 0;
    if (costPrice < 0) {
      throw new BadRequestException('Giá vốn không được âm');
    }

    // Tính toán biên lợi nhuận (margin %)
    const margin =
      dto.price > 0
        ? Number((((dto.price - costPrice) / dto.price) * 100).toFixed(2))
        : 0;

    const parentCat = dto.parentCategory ? dto.parentCategory.trim() : '';
    const subCat = dto.subCategory ? dto.subCategory.trim() : '';
    const category =
      dto.category?.trim() ||
      (parentCat && subCat ? `${parentCat} / ${subCat}` : parentCat || subCat);

    // Chuẩn hóa và xác thực danh sách đơn vị quy đổi (units - SN-23)
    const baseUnitName = dto.baseUnit.trim();
    let productUnits: ProductUnitEntity[] = [];

    if (dto.units && dto.units.length > 0) {
      const seenNames = new Set<string>();
      for (const u of dto.units) {
        const uName = (u.unitName || '').trim();
        if (!uName) {
          throw new BadRequestException('Tên đơn vị quy đổi không được để trống');
        }
        const lower = uName.toLowerCase();
        if (seenNames.has(lower)) {
          throw new BadRequestException(`Đơn vị quy đổi "${uName}" bị trùng lặp`);
        }
        seenNames.add(lower);

        // Fix #1: Merge hệ số quy đổi từ 3 alias theo priority
        // conversionRate (canonical) > conversionFactor (camelCase FE) > conversion_factor (snake_case)
        const rawRate =
          u.conversionRate ??
          (u as unknown as Record<string, unknown>)['conversionFactor'] ??
          (u as unknown as Record<string, unknown>)['conversion_factor'];
        const rate = Number(rawRate);
        if (!Number.isFinite(rate) || rate <= 0) {
          throw new BadRequestException(
            `Hệ số quy đổi của đơn vị "${uName}" phải là số lớn hơn 0 (nhận được: ${rawRate})`,
          );
        }

        const isBase =
          lower === baseUnitName.toLowerCase() || Boolean(u.isBaseUnit);
        productUnits.push(
          new ProductUnitEntity({
            unitName: uName,
            conversionRate: isBase ? 1 : rate,
            isBaseUnit: isBase,
            barcode: u.barcode,
            price: u.price,
            costPrice: u.costPrice,
          }),
        );
      }

      // Đảm bảo đơn vị cơ sở có mặt trong danh sách units
      const hasBase = productUnits.some(
        (u) => u.unitName.toLowerCase() === baseUnitName.toLowerCase(),
      );
      if (!hasBase) {
        productUnits.unshift(
          new ProductUnitEntity({
            unitName: baseUnitName,
            conversionRate: 1,
            isBaseUnit: true,
          }),
        );
      }
    } else {
      productUnits = [
        new ProductUnitEntity({
          unitName: baseUnitName,
          conversionRate: 1,
          isBaseUnit: true,
        }),
      ];
    }

    const newProduct = new ProductEntity({
      id: `prod-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      sku: cleanSku,
      name: dto.name.trim(),
      categoryId: dto.categoryId?.trim(),
      parentCategory: parentCat,
      subCategory: subCat,
      category,
      baseUnit: baseUnitName,
      packagingSpec: dto.packagingSpec?.trim(),
      units: productUnits,
      price: Number(dto.price),
      costPrice,
      margin,
      stockQuantity: dto.stockQuantity ?? 0,
      status: dto.status ?? ProductStatus.ACTIVE,
      imageUrl: dto.imageUrl?.trim(),
      description: dto.description?.trim(),
      isBatchManaged: dto.isBatchManaged !== undefined ? Boolean(dto.isBatchManaged) : true,
      hasTransactions: false,
    });

    this.products.set(newProduct.id, newProduct);

    if (this.dbService?.isConnected()) {
      try {
        let dbCategoryId = 1;
        if (newProduct.categoryId) {
          const num = parseInt(newProduct.categoryId, 10);
          if (!isNaN(num) && num > 0) {
            dbCategoryId = num;
          } else {
            try {
              const catRows = await this.dbService.query<{ id: number }>(
                'SELECT id FROM categories WHERE UPPER(code) = $1 OR id::text = $1 LIMIT 1;',
                [newProduct.categoryId.toUpperCase()],
              );
              if (catRows.length > 0) {
                dbCategoryId = catRows[0].id;
              }
            } catch {}
          }
        }

        const prodRows = await this.dbService.query<{ id: string }>(
          `INSERT INTO products (sku, name, category_id, base_unit, cost_price, status, image_url, is_batch_managed)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (sku) DO UPDATE SET
             name = EXCLUDED.name,
             cost_price = EXCLUDED.cost_price,
             category_id = EXCLUDED.category_id,
             status = EXCLUDED.status,
             image_url = EXCLUDED.image_url,
             is_batch_managed = EXCLUDED.is_batch_managed,
             updated_at = CURRENT_TIMESTAMP
           RETURNING id;`,
          [
            newProduct.sku,
            newProduct.name,
            dbCategoryId,
            newProduct.baseUnit,
            newProduct.costPrice,
            newProduct.status,
            newProduct.imageUrl || null,
            newProduct.isBatchManaged,
          ],
        );

        const dbProductId = prodRows[0]?.id;
        if (dbProductId) {
          // Tự động phân bổ tồn kho xuống đủ cả 4 kho chuẩn hệ thống (Step 1.2)
          const totalStock = dto.stockQuantity && dto.stockQuantity > 0 ? Number(dto.stockQuantity) : 4000;
          const baseQty = Math.floor(totalStock / 4);
          const rem = totalStock - baseQty * 4;
          const distList = [
            { id: '11111111-0000-0000-0000-000000000002', qty: baseQty }, // Miền Bắc
            { id: '11111111-0000-0000-0000-000000000004', qty: baseQty }, // Miền Trung
            { id: '11111111-0000-0000-0000-000000000001', qty: baseQty + rem }, // Miền Nam
            { id: '11111111-0000-0000-0000-000000000003', qty: baseQty }, // Miền Tây
          ];

          for (const item of distList) {
            await this.dbService.query(
              `INSERT INTO inventories (product_id, warehouse_id, on_hand, allocated)
               VALUES ($1, $2::uuid, $3, 0)
               ON CONFLICT (warehouse_id, product_id)
               DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = CURRENT_TIMESTAMP;`,
              [dbProductId, item.id, item.qty],
            );
            await this.dbService.query(
              `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity)
               VALUES ($1, $2::uuid, $3)
               ON CONFLICT (product_sku, warehouse_id)
               DO UPDATE SET physical_quantity = EXCLUDED.physical_quantity, updated_at = CURRENT_TIMESTAMP;`,
              [newProduct.sku.toUpperCase(), item.id, item.qty],
            );
          }
        }
      } catch {
        // Fallback
      }
    }

    return newProduct;
  }

  /**
   * Cập nhật thông tin SKU sản phẩm
   * PATCH /api/products/:id
   * Quyền: ADMIN, SALES_MANAGER
   */
  async update(
    idOrSku: string,
    dto: UpdateProductDto,
    updatedBy: string = 'Quản trị viên',
  ): Promise<ProductEntity> {
    const product = await this.findById(idOrSku);

    // Nếu có cập nhật SKU, kiểm tra tính duy nhất
    if (dto.sku !== undefined) {
      const cleanSku = dto.sku.trim().toUpperCase();

      if (!cleanSku) {
        throw new BadRequestException('Mã SKU không được để trống');
      }

      if (/\s/.test(cleanSku)) {
        throw new BadRequestException('Mã SKU không được chứa khoảng trắng');
      }

      const duplicate = this.findProductInternal(cleanSku);

      if (duplicate && duplicate.id !== product.id) {
        throw new BadRequestException('Mã SKU đã tồn tại trên hệ thống');
      }

      product.sku = cleanSku;
    }

    if (dto.name !== undefined) {
      product.name = dto.name.trim();
    }

    if (dto.categoryId !== undefined) {
      product.categoryId = dto.categoryId?.trim();
      if (this.categoriesService && product.categoryId) {
        const cat = this.categoriesService.findCategoryInternal(product.categoryId);
        if (cat) {
          if (dto.subCategory === undefined) {
            product.subCategory = cat.name;
          }
          if (dto.parentCategory === undefined) {
            const parent = cat.parentId
              ? this.categoriesService.findCategoryInternal(cat.parentId)
              : undefined;
            product.parentCategory = parent ? parent.name : cat.name;
          }
          if (dto.category === undefined) {
            product.category =
              product.parentCategory !== product.subCategory
                ? `${product.parentCategory} / ${product.subCategory}`
                : product.subCategory;
          }
        }
      }
    }

    if (dto.parentCategory !== undefined) {
      product.parentCategory = dto.parentCategory.trim();
    }

    if (dto.subCategory !== undefined) {
      product.subCategory = dto.subCategory.trim();
    }

    if (dto.category !== undefined) {
      product.category = dto.category.trim();
    } else if (
      dto.parentCategory !== undefined ||
      dto.subCategory !== undefined
    ) {
      product.category = `${product.parentCategory} / ${product.subCategory}`;
    }

    if (dto.baseUnit !== undefined) {
      const newBaseUnit = dto.baseUnit.trim();
      // Fix #3: Chặn đổi baseUnit khi còn tồn kho để tránh sai lệch nghĩa số tồn (SN-23 AC3)
      // Ví dụ: 240 lon → đổi baseUnit thành "Thùng" → hệ thống hiểu là "240 thùng" (SAI)
      if (
        newBaseUnit.toLowerCase() !== product.baseUnit.toLowerCase() &&
        product.stockQuantity > 0
      ) {
        throw new BadRequestException(
          `Không thể đổi đơn vị cơ sở từ "${product.baseUnit}" sang "${newBaseUnit}" khi sản phẩm đang có tồn kho (${product.stockQuantity} ${product.baseUnit}). ` +
          `Vui lòng xuất kho hết hàng về 0 trước khi thay đổi đơn vị cơ sở.`,
        );
      }
      product.baseUnit = newBaseUnit;
    }

    if (dto.packagingSpec !== undefined) {
      product.packagingSpec = dto.packagingSpec.trim();
    }

    if (dto.price !== undefined) {
      if (dto.price <= 0) {
        throw new BadRequestException('Giá bán phải là số dương lớn hơn 0');
      }
      
      const oldPrice = product.price || 0;
      const newPrice = Number(dto.price);
      
      // BẮT ĐẦU LOGIC SN-29: LƯU LỊCH SỬ GIÁ
      if (oldPrice !== newPrice) {
        await this.recordPriceHistory(product, oldPrice, newPrice, updatedBy);
      }
      // KẾT THÚC LOGIC SN-29
      
      product.price = newPrice;
    }

    if (dto.costPrice !== undefined) {
      if (dto.costPrice < 0) {
        throw new BadRequestException('Giá vốn không được âm');
      }
      product.costPrice = Number(dto.costPrice);
    }

    // Tự động tính toán lại margin khi giá bán hoặc giá vốn thay đổi
    if (dto.price !== undefined || dto.costPrice !== undefined) {
      product.margin =
        product.price > 0
          ? Number(
              (
                ((product.price - product.costPrice) / product.price) *
                100
              ).toFixed(2),
            )
          : 0;
    }

    if (dto.stockQuantity !== undefined) {
      if (dto.stockQuantity < 0) {
        throw new BadRequestException('Số lượng tồn không được âm');
      }
      product.stockQuantity = Number(dto.stockQuantity);
    }

    if (dto.status !== undefined) {
      product.status = dto.status;
    }

    if (dto.imageUrl !== undefined) {
      product.imageUrl = dto.imageUrl?.trim();
    }

    if (dto.description !== undefined) {
      product.description = dto.description?.trim();
    }

    // Cập nhật danh sách đơn vị quy đổi (units - SN-23)
    if (dto.units !== undefined) {
      const baseUnitName = (dto.baseUnit ? dto.baseUnit.trim() : product.baseUnit).trim();
      const seenNames = new Set<string>();
      const updatedUnits: ProductUnitEntity[] = [];

      for (const u of dto.units) {
        const uName = (u.unitName || '').trim();
        if (!uName) {
          throw new BadRequestException('Tên đơn vị quy đổi không được để trống');
        }
        const lower = uName.toLowerCase();
        if (seenNames.has(lower)) {
          throw new BadRequestException(`Đơn vị quy đổi "${uName}" bị trùng lặp`);
        }
        seenNames.add(lower);

        // Fix #1: Merge hệ số quy đổi từ 3 alias theo priority
        // conversionRate (canonical) > conversionFactor (camelCase FE) > conversion_factor (snake_case)
        const rawRate =
          u.conversionRate ??
          (u as unknown as Record<string, unknown>)['conversionFactor'] ??
          (u as unknown as Record<string, unknown>)['conversion_factor'];
        const rate = Number(rawRate);
        if (!Number.isFinite(rate) || rate <= 0) {
          throw new BadRequestException(
            `Hệ số quy đổi của đơn vị "${uName}" phải là số lớn hơn 0 (nhận được: ${rawRate})`,
          );
        }

        const isBase =
          lower === baseUnitName.toLowerCase() || Boolean(u.isBaseUnit);
        updatedUnits.push(
          new ProductUnitEntity({
            productId: product.id,
            unitName: uName,
            conversionRate: isBase ? 1 : rate,
            isBaseUnit: isBase,
            barcode: u.barcode,
            price: u.price,
            costPrice: u.costPrice,
          }),
        );
      }

      // Đảm bảo đơn vị cơ sở có mặt trong danh sách units
      const hasBase = updatedUnits.some(
        (u) => u.unitName.toLowerCase() === baseUnitName.toLowerCase(),
      );
      if (!hasBase) {
        updatedUnits.unshift(
          new ProductUnitEntity({
            productId: product.id,
            unitName: baseUnitName,
            conversionRate: 1,
            isBaseUnit: true,
          }),
        );
      }

      product.units = updatedUnits;
    }

    if (dto.isBatchManaged !== undefined) {
      product.isBatchManaged = Boolean(dto.isBatchManaged);
    }

    product.updatedAt = new Date();
    this.products.set(product.id, product);

    if (this.dbService?.isConnected()) {
      try {
        let dbCategoryId: number | null = null;
        if (dto.categoryId !== undefined) {
          if (dto.categoryId) {
            const num = parseInt(dto.categoryId, 10);
            if (!isNaN(num) && num > 0) {
              dbCategoryId = num;
            } else {
              try {
                const catRows = await this.dbService.query<{ id: number }>(
                  'SELECT id FROM categories WHERE UPPER(code) = $1 OR id::text = $1 LIMIT 1;',
                  [dto.categoryId.toUpperCase()],
                );
                if (catRows.length > 0) {
                  dbCategoryId = catRows[0].id;
                }
              } catch {}
            }
          }
        }

        await this.dbService.query(
          `UPDATE products 
           SET name = COALESCE($1, name),
               base_unit = COALESCE($2, base_unit),
               cost_price = COALESCE($3, cost_price),
               status = COALESCE($4, status),
               image_url = COALESCE($5, image_url),
               category_id = COALESCE($7, category_id),
               is_batch_managed = COALESCE($8, is_batch_managed),
               updated_at = CURRENT_TIMESTAMP
           WHERE sku = $6;`,
          [
            dto.name ? dto.name.trim() : null,
            dto.baseUnit ? dto.baseUnit.trim() : null,
            dto.costPrice !== undefined ? Number(dto.costPrice) : null,
            dto.status || null,
            dto.imageUrl ? dto.imageUrl.trim() : null,
            product.sku,
            dbCategoryId,
            dto.isBatchManaged !== undefined ? Boolean(dto.isBatchManaged) : null,
          ],
        );
      } catch {}
    }

    return product;
  }

  /**
   * Xóa sản phẩm khỏi danh mục (Ràng buộc toàn vẹn dữ liệu)
   * DELETE /api/products/:id
   * Quyền: ADMIN, SALES_MANAGER
   */
  async delete(
    idOrSku: string,
  ): Promise<{ success: boolean; message: string }> {
    const product = await this.findById(idOrSku);

    // Kiểm tra ràng buộc giao dịch đơn hàng và kho
    if (this.hasTransactions(product.id) || product.hasTransactions) {
      throw new BadRequestException(
        'Sản phẩm đã phát sinh giao dịch kho hoặc đơn hàng. Không thể xóa, chỉ được phép chuyển trạng thái sang Ngừng kinh doanh',
      );
    }

    this.products.delete(product.id);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `DELETE FROM products WHERE sku = $1;`,
          [product.sku],
        );
      } catch {}
    }

    return {
      success: true,
      message: `Đã xóa thành công sản phẩm [${product.sku}] khỏi danh mục.`,
    };
  }

  /**
   * Điều chỉnh tồn kho hàng hóa
   */
  async updateStock(
    idOrSku: string,
    deltaQuantity: number,
  ): Promise<ProductEntity> {
    const product = await this.findById(idOrSku);
    product.stockQuantity += deltaQuantity;
    if (product.stockQuantity < 0) {
      product.stockQuantity = 0;
    }
    // Ghi nhận đã phát sinh biến động tồn kho
    this.recordTransaction(product.id);
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return product;
  }

  async setStockQuantity(idOrSku: string, quantity: number): Promise<ProductEntity> {
    const product = await this.findById(idOrSku);
    product.stockQuantity = Math.max(0, quantity);
    this.recordTransaction(product.id);
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return product;
  }

  /**
   * Tra cứu hệ số quy đổi của một đơn vị đối với SKU (SN-23):
   * - Nếu không truyền unitName hoặc unitName trùng baseUnit: rate = 1
   * - Nếu truyền unitName: tra cứu trong product.units
   * - Nếu không tìm thấy: ném BadRequestException
   */
  findUnitConversion(
    product: ProductEntity,
    unitName?: string,
  ): { unitName: string; conversionRate: number; isBaseUnit: boolean } {
    if (
      !unitName ||
      unitName.trim().toLowerCase() === product.baseUnit.toLowerCase()
    ) {
      return {
        unitName: product.baseUnit,
        conversionRate: 1,
        isBaseUnit: true,
      };
    }

    const cleanUnit = unitName.trim().toLowerCase();
    const found = product.units?.find(
      (u) => u.unitName.toLowerCase() === cleanUnit,
    );

    if (!found) {
      const validNames = (product.units || [])
        .map((u) => u.unitName)
        .join(', ');
      throw new BadRequestException(
        `Đơn vị tính "${unitName}" không tồn tại cho SKU "${product.sku}". Các đơn vị hợp lệ: ${validNames || product.baseUnit}`,
      );
    }

    return {
      unitName: found.unitName,
      conversionRate: found.conversionRate,
      isBaseUnit: found.isBaseUnit,
    };
  }

  /**
   * Lấy danh sách đơn vị quy đổi của SKU (SN-21 / SN-23)
   */
  async getUnitsByProductId(idOrSku: string): Promise<ProductUnitEntity[]> {
    const product = await this.findById(idOrSku);
    return product.units || [];
  }

  /**
   * Thêm đơn vị quy đổi mới cho SKU (SN-21 / SN-23)
   */
  async addUnit(
    idOrSku: string,
    dto: ProductUnitDto,
  ): Promise<ProductUnitEntity> {
    const product = await this.findById(idOrSku);
    if (!product.units) product.units = [];

    const cleanName = dto.unitName.trim();
    const isDuplicate = product.units.some(
      (u) => u.unitName.toLowerCase() === cleanName.toLowerCase(),
    );
    if (isDuplicate) {
      throw new BadRequestException(
        `Đơn vị "${cleanName}" đã tồn tại cho SKU "${product.sku}".`,
      );
    }

    const rate = dto.conversionRate !== undefined ? Number(dto.conversionRate) : 1;
    const newUnit = new ProductUnitEntity({
      productId: product.id,
      unitName: cleanName,
      conversionRate: rate,
      isBaseUnit: false,
      barcode: dto.barcode,
      price: dto.price,
      costPrice: dto.costPrice,
    });

    product.units.push(newUnit);
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return newUnit;
  }

  /**
   * Cập nhật đơn vị quy đổi của SKU (SN-21 / SN-23)
   */
  async updateUnit(
    idOrSku: string,
    unitId: string,
    dto: Partial<ProductUnitDto>,
  ): Promise<ProductUnitEntity> {
    const product = await this.findById(idOrSku);
    const unit = product.units?.find((u) => u.id === unitId || u.unitName.toLowerCase() === unitId.toLowerCase());
    if (!unit) {
      throw new NotFoundException(`Không tìm thấy đơn vị quy đổi "${unitId}".`);
    }

    if (unit.isBaseUnit && dto.conversionRate !== undefined && dto.conversionRate !== 1) {
      throw new BadRequestException('Không thể thay đổi hệ số của đơn vị cơ sở khác 1.');
    }

    if (dto.unitName) unit.unitName = dto.unitName.trim();
    if (dto.conversionRate !== undefined) unit.conversionRate = Number(dto.conversionRate);
    if (dto.barcode !== undefined) unit.barcode = dto.barcode;
    if (dto.price !== undefined) unit.price = dto.price;
    if (dto.costPrice !== undefined) unit.costPrice = dto.costPrice;

    unit.updatedAt = new Date();
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return unit;
  }

  /**
   * Xóa đơn vị quy đổi của SKU (SN-21 / SN-23)
   */
  async deleteUnit(
    idOrSku: string,
    unitId: string,
  ): Promise<{ success: boolean; message: string }> {
    const product = await this.findById(idOrSku);
    const unit = product.units?.find((u) => u.id === unitId || u.unitName.toLowerCase() === unitId.toLowerCase());
    if (!unit) {
      throw new NotFoundException(`Không tìm thấy đơn vị quy đổi "${unitId}".`);
    }

    if (unit.isBaseUnit) {
      throw new BadRequestException('Không được phép xóa đơn vị cơ sở của SKU.');
    }

    product.units = product.units?.filter((u) => u.id !== unit.id);
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return { success: true, message: `Đã xóa đơn vị "${unit.unitName}".` };
  }

  /**
   * Tạo tệp Excel mẫu để nhập sản phẩm (SN-24)
   */
  async generateImportTemplate(res: Response): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Danh mục sản phẩm');

    sheet.columns = [
      { header: 'Mã SKU (*)', key: 'sku', width: 20, style: { alignment: { horizontal: 'center' } } },
      { header: 'Tên sản phẩm (*)', key: 'name', width: 30, style: { alignment: { horizontal: 'left' } } },
      { header: 'Nhóm hàng (*)', key: 'category', width: 20, style: { alignment: { horizontal: 'left' } } },
      { header: 'Đơn vị tính (*)', key: 'baseUnit', width: 15, style: { alignment: { horizontal: 'center' } } },
      { header: 'Quy cách', key: 'packagingSpec', width: 20, style: { alignment: { horizontal: 'center' } } },
      { header: 'Giá niêm yết (*)', key: 'price', width: 15, style: { alignment: { horizontal: 'right' } } },
      { header: 'Tồn kho', key: 'stockQuantity', width: 15, style: { alignment: { horizontal: 'right' } } },
      { header: 'Giá vốn (*)', key: 'costPrice', width: 15, style: { alignment: { horizontal: 'right' } } },
      { header: 'Mô tả', key: 'description', width: 30, style: { alignment: { horizontal: 'left' } } },
    ];

    sheet.addRow({
      sku: 'SP-001',
      name: 'Sản phẩm mẫu',
      category: 'Hàng hóa',
      baseUnit: 'Cái',
      packagingSpec: '24 lon/thùng',
      price: 100000,
      stockQuantity: 10,
      costPrice: 80000,
      description: 'Đây là dòng dữ liệu mẫu, hãy xóa dòng này trước khi nhập',
    });

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    const sampleRow = sheet.getRow(2);
    sampleRow.alignment = { vertical: 'middle', horizontal: 'center' };
    const descCell = sampleRow.getCell(9);
    descCell.alignment = { vertical: 'middle', horizontal: 'left' };

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=Template_Nhap_SanPham.xlsx',
    );

    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Xem trước tệp Excel nhập sản phẩm (SN-24)
   */
  async previewImport(file: Express.Multer.File): Promise<PreviewImportResult> {
    if (!file) {
      throw new BadRequestException('Vui lòng tải lên tệp Excel');
    }

    const workbook = new ExcelJS.Workbook();
    try {
      const safeBuffer = file.buffer.buffer.slice(
        file.buffer.byteOffset,
        file.buffer.byteOffset + file.buffer.byteLength,
      );
      await workbook.xlsx.load(safeBuffer as ArrayBuffer);
    } catch {
      throw new BadRequestException('Tệp không đúng định dạng Excel');
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Tệp Excel không có dữ liệu');
    }

    const previewData: ImportProductItemDto[] = [];
    const seenSkus = new Map<string, number>();
    let validCount = 0;
    let invalidCount = 0;

    sheet.eachRow((row: ExcelJS.Row, rowNumber: number) => {
      if (rowNumber === 1) return;

      const sku = row.getCell(1).text?.trim();
      const name = row.getCell(2).text?.trim();
      const category = row.getCell(3).text?.trim();
      const baseUnit = row.getCell(4).text?.trim();
      const packagingSpec = row.getCell(5).text?.trim();
      const price = Number(row.getCell(6).value) || 0;
      const stockQuantity = Number(row.getCell(7).value) || 0;
      const costPrice = Number(row.getCell(8).value) || 0;
      const description = row.getCell(9).text?.trim();

      if (!sku && !name && !category && !baseUnit && price === 0 && costPrice === 0) return;

      const errors: string[] = [];
      if (!sku) {
        errors.push('Mã SKU không được để trống');
      } else {
        const lowerSku = sku.toLowerCase();
        if (seenSkus.has(lowerSku)) {
          errors.push(`Mã SKU '${sku}' bị trùng lặp với dòng ${seenSkus.get(lowerSku)} trong tệp`);
        } else {
          seenSkus.set(lowerSku, rowNumber - 1);
        }
      }
      if (!name) errors.push('Tên sản phẩm không được để trống');
      if (!category) errors.push('Nhóm hàng không được để trống');
      if (!baseUnit) errors.push('Đơn vị tính không được để trống');
      if (price <= 0) errors.push('Giá niêm yết phải lớn hơn 0');
      if (costPrice <= 0) errors.push('Giá vốn phải lớn hơn 0');

      const existingProduct = Array.from(this.products.values()).find(
        (p) => p.sku.toLowerCase() === sku?.toLowerCase(),
      );

      const status = existingProduct ? 'UPDATE' : 'NEW';
      if (errors.length > 0) {
        invalidCount++;
      } else {
        validCount++;
      }

      previewData.push({
        row: rowNumber - 1,
        sku: sku || '',
        name: name || '',
        category: category || '',
        baseUnit: baseUnit || '',
        packagingSpec,
        price,
        costPrice,
        stockQuantity,
        description,
        status,
        errors,
        isValid: errors.length === 0,
      });
    });

    return {
      total: previewData.length,
      valid: validCount,
      invalid: invalidCount,
      data: previewData,
    };
  }

  /**
   * Xác nhận nhập dữ liệu từ bản xem trước (SN-24)
   */
  async confirmImport(items: ImportProductItemDto[]): Promise<ConfirmImportResult> {
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        if (!item.isValid) {
          errorCount++;
          errors.push(`Dòng ${item.row}: Dữ liệu không hợp lệ`);
          continue;
        }

        if (item.status === 'UPDATE') {
          await this.update(item.sku, {
            name: item.name,
            category: item.category,
            parentCategory: item.category?.includes('/') ? item.category.split('/')[0].trim() : item.category,
            baseUnit: item.baseUnit,
            packagingSpec: item.packagingSpec,
            price: item.price,
            costPrice: item.costPrice,
            description: item.description,
          });
        } else {
          await this.create({
            sku: item.sku,
            name: item.name,
            category: item.category,
            parentCategory: item.category?.includes('/') ? item.category.split('/')[0].trim() : item.category,
            baseUnit: item.baseUnit,
            packagingSpec: item.packagingSpec,
            price: item.price,
            costPrice: item.costPrice,
            stockQuantity: item.stockQuantity,
            description: item.description,
          });
        }
        successCount++;
      } catch (err: unknown) {
        errorCount++;
        errors.push(`Dòng ${item.row}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      success: successCount,
      error: errorCount,
      errorDetails: errors,
    };
  }

  /**
   * Kiểm tra xem sản phẩm đã phát sinh giao dịch hay chưa
   */
  public hasTransactions(productIdOrSku: string): boolean {
    const p = this.findProductInternal(productIdOrSku);
    if (!p) return false;
    return (
      p.hasTransactions === true ||
      this.transactionProductIds.has(p.id) ||
      this.transactionProductIds.has(p.sku)
    );
  }

  /**
   * Ghi nhận giao dịch phát sinh cho sản phẩm (Khóa quyền xóa)
   */
  public recordTransaction(productIdOrSku: string): void {
    const p = this.findProductInternal(productIdOrSku);
    if (p) {
      p.hasTransactions = true;
      this.transactionProductIds.add(p.id);
      this.transactionProductIds.add(p.sku);
    }
  }

  /**
   * Lấy danh sách sản phẩm thuộc một nhóm hàng (theo categoryId, code hoặc tên)
   */
  public findProductsByCategoryId(
    categoryId: string,
    categoryCode?: string,
    categoryName?: string,
  ): ProductEntity[] {
    const cidLower = categoryId.toLowerCase().trim();
    const codeLower = categoryCode ? categoryCode.toLowerCase().trim() : '';
    const nameLower = categoryName ? categoryName.toLowerCase().trim() : '';

    return Array.from(this.products.values()).filter((p) => {
      // 1. Nếu sản phẩm đã có categoryId: ĐÂY LÀ ĐỊNH DANH DUY NHẤT VÀ CHÍNH XÁC NHẤT
      if (p.categoryId) {
        const pCid = p.categoryId.toLowerCase().trim();
        if (pCid === cidLower) return true;
        if (codeLower && (pCid === codeLower || pCid.replace(/^cat-/, '').replace(/-/g, '_') === codeLower)) {
          return true;
        }
        if (this.categoriesService) {
          const resolved = this.categoriesService.findCategoryInternal(pCid);
          if (
            resolved &&
            (resolved.id.toLowerCase() === cidLower ||
              (codeLower && resolved.code.toLowerCase() === codeLower))
          ) {
            return true;
          }
        }
        return false; // Tuyệt đối không fallback sang so khớp tên cũ khi đã có categoryId
      }

      // 2. Fallback cho dữ liệu cũ (legacy seed) chưa có categoryId
      if (p.subCategory && p.subCategory.toLowerCase().trim() === nameLower) return true;
      if (p.parentCategory && p.parentCategory.toLowerCase().trim() === nameLower) return true;
      if (p.category && nameLower && p.category.toLowerCase().includes(nameLower)) return true;
      return false;
    });
  }

  /**
   * Đếm số lượng sản phẩm thuộc một nhóm hàng
   */
  public countProductsByCategoryId(
    categoryId: string,
    categoryCode?: string,
    categoryName?: string,
  ): number {
    return this.findProductsByCategoryId(categoryId, categoryCode, categoryName).length;
  }

  /**
   * Đếm số lượng sản phẩm trực tiếp thuộc một nhóm hàng (phục vụ tính toán cây đa cấp)
   */
  public countDirectProductsByCategoryId(
    categoryId: string,
    categoryCode?: string,
    categoryName?: string,
    hasChildren: boolean = false,
  ): number {
    const cidLower = categoryId.toLowerCase().trim();
    const codeLower = categoryCode ? categoryCode.toLowerCase().trim() : '';
    const nameLower = categoryName ? categoryName.toLowerCase().trim() : '';

    return Array.from(this.products.values()).filter((p) => {
      if (p.categoryId) {
        const pCid = p.categoryId.toLowerCase().trim();
        if (pCid === cidLower) return true;
        if (codeLower && (pCid === codeLower || pCid.replace(/^cat-/, '').replace(/-/g, '_') === codeLower)) {
          return true;
        }
        if (this.categoriesService) {
          const resolved = this.categoriesService.findCategoryInternal(pCid);
          if (
            resolved &&
            (resolved.id.toLowerCase() === cidLower ||
              (codeLower && resolved.code.toLowerCase() === codeLower))
          ) {
            return true;
          }
        }
        return false;
      }
      if (!hasChildren) {
        return (
          (p.subCategory && p.subCategory.toLowerCase().trim() === nameLower) ||
          (p.parentCategory && p.parentCategory.toLowerCase().trim() === nameLower)
        );
      }
      return false;
    }).length;
  }

  /**
   * Lấy danh sách sản phẩm thuộc nhánh phân cấp (nhóm chỉ định + tất cả nhóm con/cháu)
   */
  public findProductsByBranch(
    categoryIds: string[],
    categoryCode?: string,
    categoryName?: string,
  ): ProductEntity[] {
    const targetSet = new Set(categoryIds.map((id) => id.toLowerCase().trim()));
    const codeLower = categoryCode ? categoryCode.toLowerCase().trim() : '';
    const nameLower = categoryName ? categoryName.toLowerCase().trim() : '';

    return Array.from(this.products.values()).filter((p) => {
      // 1. Nếu có categoryId: Phải thuộc targetSet hoặc code của nhánh này
      if (p.categoryId) {
        const pCid = p.categoryId.toLowerCase().trim();
        if (targetSet.has(pCid)) {
          return true;
        }
        if (codeLower && (pCid === codeLower || pCid.replace(/^cat-/, '').replace(/-/g, '_') === codeLower)) {
          return true;
        }
        if (this.categoriesService) {
          const resolved = this.categoriesService.findCategoryInternal(pCid);
          if (
            resolved &&
            (targetSet.has(resolved.id.toLowerCase().trim()) ||
              (resolved.code && targetSet.has(resolved.code.toLowerCase().trim())))
          ) {
            return true;
          }
        }
        return false; // Tuyệt đối KHÔNG fallback sang chuỗi tên text nếu p.categoryId không khớp!
      }

      // 2. Fallback cho dữ liệu cũ chưa có categoryId
      if (p.parentCategory && p.parentCategory.toLowerCase().trim() === nameLower) {
        return true;
      }
      if (p.subCategory && p.subCategory.toLowerCase().trim() === nameLower) {
        return true;
      }
      if (p.category && nameLower && p.category.toLowerCase().includes(nameLower)) {
        return true;
      }
      return false;
    });
  }

  /**
   * Chuyển sản phẩm giữa các nhóm hàng (SN-150)
   */
  public async moveProductsBetweenCategories(
    sourceCategoryIdOrIds: string | string[],
    targetCategoryId: string,
    targetCategoryName: string,
    productIds?: string[],
    sourceCategoryCode?: string,
    sourceCategoryName?: string,
    targetParentCategoryName?: string,
  ): Promise<number> {
    const rawIds = Array.isArray(sourceCategoryIdOrIds)
      ? sourceCategoryIdOrIds
      : [sourceCategoryIdOrIds];

    // Thu thập tất cả ID nhóm nguồn và các nhóm con/cháu đệ quy
    const allSourceIds = new Set<string>(rawIds.map((id) => id.toLowerCase().trim()));
    if (this.categoriesService) {
      for (const sId of rawIds) {
        const desc = this.categoriesService.getDescendantIds(sId);
        for (const d of desc) {
          allSourceIds.add(d.toLowerCase().trim());
        }
      }
    }

    const sourceIdsArray = Array.from(allSourceIds);

    const candidates = this.findProductsByBranch(
      sourceIdsArray,
      sourceCategoryCode,
      sourceCategoryName,
    );

    const toMove =
      productIds && productIds.length > 0
        ? Array.from(this.products.values()).filter(
            (p) =>
              (productIds.includes(p.id) || productIds.includes(p.sku)) &&
              (candidates.length === 0 ||
                candidates.some((c) => c.id === p.id || c.sku === p.sku) ||
                (p.categoryId && allSourceIds.has(p.categoryId.toLowerCase().trim()))),
          )
        : candidates;

    if (toMove.length === 0) {
      return 0;
    }

    // Xác định numeric ID của nhóm đích trong database PostgreSQL
    let dbCatId: number | null = null;
    const num = parseInt(targetCategoryId, 10);
    if (!isNaN(num) && num > 0) {
      dbCatId = num;
    } else if (this.categoriesService) {
      const catObj = this.categoriesService.findCategoryInternal(targetCategoryId);
      if (catObj) {
        const cNum = parseInt(catObj.id, 10);
        if (!isNaN(cNum) && cNum > 0) dbCatId = cNum;
      }
    }

    if (this.dbService?.isConnected() && dbCatId === null) {
      try {
        const rows = await this.dbService.query<{ id: number }>(
          `SELECT id FROM categories WHERE id::text = $1 OR UPPER(code) = UPPER($1) LIMIT 1;`,
          [targetCategoryId],
        );
        if (rows.length > 0) {
          dbCatId = rows[0].id;
        }
      } catch (err) {
        console.error('[ProductsService] Lỗi tìm ID danh mục trong DB:', err);
      }
    }

    const parentName = targetParentCategoryName || targetCategoryName;

    for (const p of toMove) {
      p.categoryId = targetCategoryId;
      p.subCategory = targetCategoryName;
      p.parentCategory = parentName;
      p.category =
        parentName !== targetCategoryName
          ? `${parentName} / ${targetCategoryName}`
          : targetCategoryName;
      p.updatedAt = new Date();

      if (this.dbService?.isConnected() && dbCatId !== null) {
        try {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id);
          if (isUuid) {
            await this.dbService.query(
              `UPDATE products SET category_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2::uuid OR sku = $3;`,
              [dbCatId, p.id, p.sku],
            );
          } else {
            await this.dbService.query(
              `UPDATE products SET category_id = $1, updated_at = CURRENT_TIMESTAMP WHERE sku = $2;`,
              [dbCatId, p.sku],
            );
          }
        } catch (dbErr) {
          console.error(`[ProductsService] Lỗi cập nhật category_id vào DB cho sản phẩm ${p.sku}:`, dbErr);
        }
      }
    }

    return toMove.length;
  }

  /**
   * Hàm tìm kiếm sản phẩm theo ID hoặc SKU (SN-39)
   */
  public findProductInternal(idOrSku: string): ProductEntity | undefined {
    if (!idOrSku) return undefined;
    const direct = this.products.get(idOrSku);
    if (direct) return direct;

    const lowerKey = idOrSku.toLowerCase().trim();
    if (lowerKey === 'lh-milk-900g') {
      const alias = Array.from(this.products.values()).find((p) => p.sku.toLowerCase() === 'lh-milk-powder-900g');
      if (alias) return alias;
    }
    if (lowerKey === 'lh-tea-240ml') {
      const alias = Array.from(this.products.values()).find((p) => p.sku.toLowerCase() === 'lh-tea-350ml');
      if (alias) return alias;
    }

    return Array.from(this.products.values()).find(
      (p) =>
        (p.uuid && p.uuid.toLowerCase() === lowerKey) ||
        p.id.toLowerCase() === lowerKey ||
        p.sku.toLowerCase() === lowerKey,
    );
  }
}
