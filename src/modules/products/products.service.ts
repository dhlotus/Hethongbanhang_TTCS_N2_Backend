import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ProductStatus } from '../../common/enums/product-status.enum';
import { CreateProductDto } from './dto/create-product.dto';
import { GetProductsFilterDto } from './dto/get-products-filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity } from './entities/product.entity';
import { PaginatedProductsResponse } from './interfaces/paginated-products.interface';

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

  constructor(@Optional() private readonly dbService?: DatabaseService) {
    this.seedInitialProducts();
  }

  async onModuleInit(): Promise<void> {
    if (this.products.size === 0) {
      this.seedInitialProducts();
    }
    if (this.dbService?.isConnected()) {
      await this.loadProductsFromDatabase();
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
        base_unit: string;
        cost_price: string | number;
        status: string;
        image_url?: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT p.id, p.sku, p.name, p.category_id, p.base_unit, p.cost_price, p.status, p.image_url, p.created_at, p.updated_at, c.name as category_name
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id;`,
      );

      for (const row of rows) {
        const existing = Array.from(this.products.values()).find(
          (p) => p.sku.toUpperCase() === row.sku.toUpperCase() || p.id === row.id,
        );
        if (!existing) {
          const catName = row.category_name || 'Đồ uống & Nước giải khát';
          const costPrice = Number(row.cost_price) || 0;
          const entity = new ProductEntity({
            id: row.id,
            sku: row.sku,
            name: row.name,
            category: catName,
            parentCategory: catName,
            subCategory: catName,
            baseUnit: row.base_unit,
            costPrice,
            price: Math.round(costPrice * 1.35),
            stockQuantity: 100,
            status: (row.status as ProductStatus) || ProductStatus.ACTIVE,
            imageUrl: row.image_url,
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
        parentCategory: 'Sữa & Chế phẩm sữa',
        subCategory: 'Sữa bột công thức',
        category: 'Sữa & Chế phẩm sữa / Sữa bột công thức',
        baseUnit: 'Lon',
        packagingSpec: '24 lon/thùng',
        price: 520000,
        costPrice: 380000,
        margin: 26.92,
        stockQuantity: 340,
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
        parentCategory: 'Sữa & Chế phẩm sữa',
        subCategory: 'Sữa hạt organic',
        category: 'Sữa & Chế phẩm sữa / Sữa hạt organic',
        baseUnit: 'Hộp',
        packagingSpec: '48 hộp/thùng (12 lốc x 4 hộp)',
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
        parentCategory: 'Nước yến & Bổ dưỡng',
        subCategory: 'Nước yến chưng sẵn',
        category: 'Nước yến & Bổ dưỡng / Nước yến chưng sẵn',
        baseUnit: 'Hũ',
        packagingSpec: '30 hũ/thùng (5 hộp x 6 hũ)',
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
        parentCategory: 'Ngũ cốc & Hạt dinh dưỡng',
        subCategory: 'Ngũ cốc hạt mầm',
        category: 'Ngũ cốc & Hạt dinh dưỡng / Ngũ cốc hạt mầm',
        baseUnit: 'Túi',
        packagingSpec: '20 túi/thùng',
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
        parentCategory: 'Thực phẩm chức năng',
        subCategory: 'Collagen & Chống lão hóa',
        category: 'Thực phẩm chức năng / Collagen & Chống lão hóa',
        baseUnit: 'Chai',
        packagingSpec: '30 chai/thùng',
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
        parentCategory: 'Nước giải khát & Trà',
        subCategory: 'Trà thảo mộc thanh nhiệt',
        category: 'Nước giải khát & Trà / Trà thảo mộc thanh nhiệt',
        baseUnit: 'Lon',
        packagingSpec: '24 lon/thùng',
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
        parentCategory: 'Nước giải khát & Trà',
        subCategory: 'Nước khoáng thiên nhiên',
        category: 'Nước giải khát & Trà / Nước khoáng thiên nhiên',
        baseUnit: 'Chai',
        packagingSpec: '24 chai/thùng',
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
        parentCategory: 'Sữa & Chế phẩm sữa',
        subCategory: 'Sữa tươi & Tiệt trùng',
        category: 'Sữa & Chế phẩm sữa / Sữa tươi & Tiệt trùng',
        baseUnit: 'Chai',
        packagingSpec: '12 chai/thùng',
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
        parentCategory: 'Nước yến & Bổ dưỡng',
        subCategory: 'Tổ yến sào tinh chế',
        category: 'Nước yến & Bổ dưỡng / Tổ yến sào tinh chế',
        baseUnit: 'Hộp',
        packagingSpec: '10 hộp/thùng',
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
        parentCategory: 'Ngũ cốc & Hạt dinh dưỡng',
        subCategory: 'Hạt dinh dưỡng sấy giòn',
        category: 'Ngũ cốc & Hạt dinh dưỡng / Hạt dinh dưỡng sấy giòn',
        baseUnit: 'Hũ',
        packagingSpec: '24 hũ/thùng',
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
        parentCategory: 'Nước giải khát & Trà',
        subCategory: 'Trà thảo mộc thanh nhiệt',
        category: 'Nước giải khát & Trà / Trà thảo mộc thanh nhiệt',
        baseUnit: 'Lon',
        packagingSpec: '24 lon/thùng',
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

    for (const item of initialList) {
      const entity = new ProductEntity(item as Partial<ProductEntity>);
      this.products.set(entity.id, entity);
    }
  }

  /**
   * Lấy danh sách sản phẩm dạng mảng phẳng (Tương thích nội bộ và unit test)
   */
  async findAll(filterDto?: GetProductsFilterDto): Promise<ProductEntity[]> {
    if (!filterDto || Object.keys(filterDto).length === 0) {
      return Array.from(this.products.values());
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
      parentCategory,
      subCategory,
      category,
      status,
    } = filterDto;

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

    // 2. Lọc theo nhóm hàng cấp 1 (parentCategory)
    if (parentCategory && parentCategory !== 'ALL') {
      const parentLower = parentCategory.trim().toLowerCase();
      items = items.filter(
        (p) =>
          (p.parentCategory &&
            p.parentCategory.toLowerCase() === parentLower) ||
          (p.category && p.category.toLowerCase().includes(parentLower)),
      );
    }

    // 3. Lọc theo nhóm hàng cấp 2 (subCategory)
    if (subCategory && subCategory !== 'ALL') {
      const subLower = subCategory.trim().toLowerCase();
      items = items.filter(
        (p) =>
          (p.subCategory && p.subCategory.toLowerCase() === subLower) ||
          (p.category && p.category.toLowerCase().includes(subLower)),
      );
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
      items = items.filter((p) => p.status === status);
    }

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

    return product;
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

    const newProduct = new ProductEntity({
      id: `prod-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
      sku: cleanSku,
      name: dto.name.trim(),
      parentCategory: parentCat,
      subCategory: subCat,
      category,
      baseUnit: dto.baseUnit.trim(),
      packagingSpec: dto.packagingSpec?.trim(),
      price: Number(dto.price),
      costPrice,
      margin,
      stockQuantity: dto.stockQuantity ?? 0,
      status: dto.status ?? ProductStatus.ACTIVE,
      imageUrl: dto.imageUrl?.trim(),
      description: dto.description?.trim(),
      hasTransactions: false,
    });

    this.products.set(newProduct.id, newProduct);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `INSERT INTO products (sku, name, category_id, base_unit, cost_price, status, image_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (sku) DO UPDATE SET
             name = EXCLUDED.name,
             cost_price = EXCLUDED.cost_price,
             updated_at = CURRENT_TIMESTAMP;`,
          [
            newProduct.sku,
            newProduct.name,
            1,
            newProduct.baseUnit,
            newProduct.costPrice,
            newProduct.status,
            newProduct.imageUrl || null,
          ],
        );
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

      const duplicate = Array.from(this.products.values()).find(
        (p) => p.sku.toUpperCase() === cleanSku && p.id !== product.id,
      );

      if (duplicate) {
        throw new BadRequestException('Mã SKU đã tồn tại trên hệ thống');
      }

      product.sku = cleanSku;
    }

    if (dto.name !== undefined) {
      product.name = dto.name.trim();
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
      product.baseUnit = dto.baseUnit.trim();
    }

    if (dto.packagingSpec !== undefined) {
      product.packagingSpec = dto.packagingSpec.trim();
    }

    if (dto.price !== undefined) {
      if (dto.price <= 0) {
        throw new BadRequestException('Giá bán phải là số dương lớn hơn 0');
      }
      product.price = Number(dto.price);
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

    product.updatedAt = new Date();
    this.products.set(product.id, product);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE products 
           SET name = COALESCE($1, name),
               base_unit = COALESCE($2, base_unit),
               cost_price = COALESCE($3, cost_price),
               status = COALESCE($4, status),
               image_url = COALESCE($5, image_url),
               updated_at = CURRENT_TIMESTAMP
           WHERE sku = $6;`,
          [
            dto.name ? dto.name.trim() : null,
            dto.baseUnit ? dto.baseUnit.trim() : null,
            dto.costPrice !== undefined ? Number(dto.costPrice) : null,
            dto.status || null,
            dto.imageUrl ? dto.imageUrl.trim() : null,
            product.sku,
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
   * Hàm nội bộ tìm kiếm sản phẩm theo ID hoặc SKU
   */
  private findProductInternal(idOrSku: string): ProductEntity | undefined {
    if (!idOrSku) return undefined;
    const direct = this.products.get(idOrSku);
    if (direct) return direct;

    const lowerKey = idOrSku.toLowerCase().trim();
    return Array.from(this.products.values()).find(
      (p) =>
        p.id.toLowerCase() === lowerKey || p.sku.toLowerCase() === lowerKey,
    );
  }
}
