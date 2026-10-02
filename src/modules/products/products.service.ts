import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity } from './entities/product.entity';
import {
  DeleteProductResult,
  PaginatedProductsResult,
} from './interfaces/product.interface';

/**
 * Service Quản lý Sản phẩm & SKU Hàng hóa (SN-138 / SN-139 / SN-20 / EP-02)
 * Cung cấp các thao tác CRUD, tìm kiếm đa tiêu chí, phân trang,
 * kiểm soát toàn vẹn giao dịch và tính toán biên lợi nhuận tự động.
 */
@Injectable()
export class ProductsService implements OnModuleInit {
  private products = new Map<string, ProductEntity>();

  constructor() {
    this.seedInitialProducts();
  }

  onModuleInit(): void {
    if (this.products.size === 0) {
      this.seedInitialProducts();
    }
  }

  /**
   * Khởi tạo dữ liệu mẫu phong phú với đầy đủ cấu trúc ngành hàng 2 cấp,
   * quy cách đóng gói, giá vốn và trạng thái giao dịch thực tế.
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
        status: 'ACTIVE',
        barcode: '8936012345011',
        imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=300&q=80',
        hasTransactions: true,
        description: 'Dòng sữa cao cấp bổ sung Canxi và DHA cho cả gia đình',
      },
      {
        id: 'prod-002',
        sku: 'LH-NUT-180ML',
        name: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
        parentCategory: 'Sữa & Chế phẩm sữa',
        subCategory: 'Sữa hạt hữu cơ',
        category: 'Sữa & Chế phẩm sữa / Sữa hạt hữu cơ',
        baseUnit: 'Hộp',
        packagingSpec: '48 hộp/thùng',
        price: 18000,
        costPrice: 11500,
        margin: 36.11,
        stockQuantity: 1200,
        status: 'ACTIVE',
        barcode: '8936012345028',
        imageUrl: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=300&q=80',
        hasTransactions: true,
        description: 'Sữa hạt thuần chay ít ngọt tốt cho tim mạch và vóc dáng',
      },
      {
        id: 'prod-003',
        sku: 'LH-NEST-70ML',
        name: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
        parentCategory: 'Yến Sào & Bổ Dưỡng',
        subCategory: 'Yến chưng sẵn',
        category: 'Yến Sào & Bổ Dưỡng / Yến chưng sẵn',
        baseUnit: 'Hũ',
        packagingSpec: '30 hũ/thùng',
        price: 65000,
        costPrice: 42000,
        margin: 35.38,
        stockQuantity: 580,
        status: 'ACTIVE',
        barcode: '8936012345035',
        imageUrl: 'https://images.unsplash.com/photo-1544816155-12df9643f363?w=300&q=80',
        hasTransactions: true,
        description: 'Tổ yến thiên nhiên chưng đường phèn thanh mát bồi bổ sức khỏe',
      },
      {
        id: 'prod-004',
        sku: 'LH-CEREAL-500G',
        name: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
        parentCategory: 'Ngũ Cốc Thực Dưỡng',
        subCategory: 'Ngũ cốc hạt mầm',
        category: 'Ngũ Cốc Thực Dưỡng / Ngũ cốc hạt mầm',
        baseUnit: 'Túi',
        packagingSpec: '20 túi/thùng',
        price: 145000,
        costPrice: 95000,
        margin: 34.48,
        stockQuantity: 410,
        status: 'ACTIVE',
        barcode: '8936012345042',
        imageUrl: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=300&q=80',
        hasTransactions: false,
        description: 'Hỗn hợp 12 loại hạt mầm nướng chín nguyên chất',
      },
      {
        id: 'prod-005',
        sku: 'LH-COLLAGEN-50ML',
        name: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
        parentCategory: 'Thực Phẩm Chức Năng',
        subCategory: 'Collagen làm đẹp',
        category: 'Thực Phẩm Chức Năng / Collagen làm đẹp',
        baseUnit: 'Chai',
        packagingSpec: '10 chai/hộp',
        price: 85000,
        costPrice: 55000,
        margin: 35.29,
        stockQuantity: 260,
        status: 'ACTIVE',
        barcode: '8936012345059',
        imageUrl: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&q=80',
        hasTransactions: false,
        description: 'Collagen thủy phân kết hợp chiết xuất đông trùng hạ thảo tự nhiên',
      },
    ];

    for (const item of initialList) {
      const entity = new ProductEntity(item);
      this.products.set(entity.id, entity);
    }
  }

  /**
   * Lấy danh sách sản phẩm có tìm kiếm đa tiêu chí & phân trang (GET /api/products)
   */
  async findAll(query?: QueryProductsDto): Promise<PaginatedProductsResult> {
    let list = Array.from(this.products.values());

    if (query) {
      const { search, parentCategory, subCategory, status } = query;

      if (search && search.trim() !== '') {
        const keyword = search.trim().toLowerCase();
        list = list.filter(
          (p) =>
            p.sku.toLowerCase().includes(keyword) ||
            p.name.toLowerCase().includes(keyword) ||
            (p.barcode && p.barcode.toLowerCase().includes(keyword)) ||
            (p.description && p.description.toLowerCase().includes(keyword)),
        );
      }

      if (parentCategory && parentCategory.trim() !== '') {
        const pc = parentCategory.trim().toLowerCase();
        list = list.filter(
          (p) =>
            p.parentCategory.toLowerCase().includes(pc) ||
            p.category.toLowerCase().includes(pc),
        );
      }

      if (subCategory && subCategory.trim() !== '') {
        const sc = subCategory.trim().toLowerCase();
        list = list.filter(
          (p) =>
            p.subCategory.toLowerCase().includes(sc) ||
            p.category.toLowerCase().includes(sc),
        );
      }

      if (status && status.trim() !== '') {
        list = list.filter((p) => p.status === status);
      }
    }

    const total = list.length;
    const page = query?.page && query.page > 0 ? query.page : 1;
    const limit = query?.limit && query.limit > 0 ? query.limit : 20;
    const totalPages = Math.ceil(total / limit) || 1;

    const startIndex = (page - 1) * limit;
    const paginatedData = list.slice(startIndex, startIndex + limit);

    return {
      data: paginatedData,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Lấy chi tiết một sản phẩm theo ID hoặc SKU (GET /api/products/:id)
   */
  async findById(idOrSku: string): Promise<ProductEntity> {
    const product =
      this.products.get(idOrSku) ||
      Array.from(this.products.values()).find(
        (p) => p.sku.toLowerCase() === idOrSku.toLowerCase(),
      );

    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có mã hoặc ID: ${idOrSku}`);
    }

    return product;
  }

  /**
   * Thêm mới SKU sản phẩm vào danh mục (POST /api/products)
   * Ràng buộc:
   * - SKU duy nhất trên toàn hệ thống (không trùng mã)
   * - Tự động tính biên lợi nhuận margin %
   * - Mặc định chưa có giao dịch (hasTransactions = false)
   */
  async create(dto: CreateProductDto): Promise<ProductEntity> {
    const normalizedSku = dto.sku.trim().toUpperCase();

    const existing = Array.from(this.products.values()).find(
      (p) => p.sku.toUpperCase() === normalizedSku,
    );

    if (existing) {
      throw new BadRequestException('Mã SKU đã tồn tại trên hệ thống');
    }

    const parentCategory = dto.parentCategory?.trim() || '';
    const subCategory = dto.subCategory?.trim() || '';
    const category =
      dto.category?.trim() ||
      [parentCategory, subCategory].filter(Boolean).join(' / ') ||
      'Tổng hợp';

    const costPrice = dto.costPrice ?? 0;
    const margin =
      dto.price > 0
        ? Number((((dto.price - costPrice) / dto.price) * 100).toFixed(2))
        : 0;

    const newProduct = new ProductEntity({
      id: `prod-${Date.now()}`,
      sku: normalizedSku,
      name: dto.name.trim(),
      parentCategory: parentCategory || category,
      subCategory: subCategory || category,
      category,
      baseUnit: dto.baseUnit.trim(),
      packagingSpec: dto.packagingSpec?.trim() || '1 đơn vị/gói',
      price: dto.price,
      costPrice,
      margin,
      stockQuantity: dto.stockQuantity ?? 0,
      status: dto.status ?? 'ACTIVE',
      barcode: dto.barcode?.trim(),
      imageUrl: dto.imageUrl?.trim(),
      hasTransactions: false,
      description: dto.description?.trim(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.products.set(newProduct.id, newProduct);
    return newProduct;
  }

  /**
   * Cập nhật thông tin sản phẩm (PATCH /api/products/:id)
   * Ràng buộc:
   * - Nếu sửa SKU: kiểm tra tính duy nhất với các sản phẩm khác
   * - Tự động tính lại Margin % nếu giá bán hoặc giá vốn thay đổi
   */
  async update(id: string, dto: UpdateProductDto): Promise<ProductEntity> {
    const product = await this.findById(id);

    if (dto.sku) {
      const normalizedSku = dto.sku.trim().toUpperCase();
      if (normalizedSku !== product.sku) {
        const duplicate = Array.from(this.products.values()).find(
          (p) => p.sku.toUpperCase() === normalizedSku && p.id !== product.id,
        );
        if (duplicate) {
          throw new BadRequestException('Mã SKU đã tồn tại trên hệ thống');
        }
        product.sku = normalizedSku;
      }
    }

    if (dto.name !== undefined) product.name = dto.name.trim();
    if (dto.parentCategory !== undefined) product.parentCategory = dto.parentCategory.trim();
    if (dto.subCategory !== undefined) product.subCategory = dto.subCategory.trim();
    if (dto.category !== undefined) {
      product.category = dto.category.trim();
    } else if (dto.parentCategory !== undefined || dto.subCategory !== undefined) {
      product.category = [product.parentCategory, product.subCategory]
        .filter(Boolean)
        .join(' / ');
    }

    if (dto.baseUnit !== undefined) product.baseUnit = dto.baseUnit.trim();
    if (dto.packagingSpec !== undefined) product.packagingSpec = dto.packagingSpec.trim();
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.costPrice !== undefined) product.costPrice = dto.costPrice;

    if (dto.price !== undefined || dto.costPrice !== undefined) {
      product.margin =
        product.price > 0
          ? Number((((product.price - product.costPrice) / product.price) * 100).toFixed(2))
          : 0;
    }

    if (dto.status !== undefined) product.status = dto.status;
    if (dto.stockQuantity !== undefined) product.stockQuantity = dto.stockQuantity;
    if (dto.barcode !== undefined) product.barcode = dto.barcode.trim();
    if (dto.imageUrl !== undefined) product.imageUrl = dto.imageUrl.trim();
    if (dto.description !== undefined) product.description = dto.description.trim();

    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return product;
  }

  /**
   * Xóa sản phẩm với ràng buộc toàn vẹn dữ liệu (DELETE /api/products/:id)
   * Ràng buộc cứng:
   * - Nếu đã có giao dịch (hasTransactions = true): từ chối xóa và yêu cầu chuyển sang Ngừng kinh doanh.
   * - Nếu chưa có giao dịch: xóa an toàn khỏi hệ thống.
   */
  async delete(id: string): Promise<DeleteProductResult> {
    const product = await this.findById(id);

    if (product.hasTransactions) {
      throw new BadRequestException(
        'Sản phẩm đã phát sinh giao dịch kho hoặc đơn hàng. Không thể xóa, chỉ được phép chuyển trạng thái sang Ngừng kinh doanh',
      );
    }

    this.products.delete(product.id);

    return {
      success: true,
      message: 'Đã xóa sản phẩm thành công',
      deletedId: product.id,
    };
  }

  /**
   * Cập nhật tồn kho (được gọi từ InventoryService hoặc OrdersService).
   * Khi phát sinh thay đổi tồn kho, sản phẩm tự động đánh dấu hasTransactions = true.
   */
  async updateStock(idOrSku: string, deltaQuantity: number): Promise<ProductEntity> {
    const product = await this.findById(idOrSku);
    product.stockQuantity += deltaQuantity;
    if (product.stockQuantity < 0) {
      product.stockQuantity = 0;
    }
    product.hasTransactions = true;
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return product;
  }
}
