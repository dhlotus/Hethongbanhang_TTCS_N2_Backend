import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductEntity } from './entities/product.entity';

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

  private seedInitialProducts(): void {
    const initialList: Partial<ProductEntity>[] = [
      {
        id: 'prod-001',
        sku: 'LH-MILK-900G',
        name: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        category: 'Sữa Dinh Dưỡng',
        baseUnit: 'Lon',
        price: 520000,
        costPrice: 380000,
        margin: 26.92,
        stockQuantity: 340,
        status: 'ACTIVE',
        barcode: '8936012345011',
        description: 'Dòng sữa dinh dưỡng bổ sung Canxi và DHA cho trẻ nhỏ và người lớn tuổi',
      },
      {
        id: 'prod-002',
        sku: 'LH-NUT-180ML',
        name: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
        category: 'Sữa Dinh Dưỡng',
        baseUnit: 'Hộp',
        price: 18000,
        costPrice: 11500,
        margin: 36.11,
        stockQuantity: 1200,
        status: 'ACTIVE',
        barcode: '8936012345028',
        description: 'Sữa hạt thuần chay ít ngọt tốt cho tim mạch',
      },
      {
        id: 'prod-003',
        sku: 'LH-NEST-70ML',
        name: 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml',
        category: 'Yến Sào & Bổ Dưỡng',
        baseUnit: 'Hũ',
        price: 65000,
        costPrice: 42000,
        margin: 35.38,
        stockQuantity: 580,
        status: 'ACTIVE',
        barcode: '8936012345035',
        description: 'Tổ yến thiên nhiên chưng đường phèn thanh mát bồi bổ sức khỏe',
      },
      {
        id: 'prod-004',
        sku: 'LH-CEREAL-500G',
        name: 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g',
        category: 'Ngũ Cốc Thực Dưỡng',
        baseUnit: 'Túi',
        price: 145000,
        costPrice: 95000,
        margin: 34.48,
        stockQuantity: 410,
        status: 'ACTIVE',
        barcode: '8936012345042',
        description: 'Hỗn hợp 12 loại hạt mầm nướng chín nguyên chất',
      },
      {
        id: 'prod-005',
        sku: 'LH-COLLAGEN-50ML',
        name: 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml',
        category: 'Thực Phẩm Chức Năng',
        baseUnit: 'Chai',
        price: 85000,
        costPrice: 55000,
        margin: 35.29,
        stockQuantity: 260,
        status: 'ACTIVE',
        barcode: '8936012345059',
        description: 'Collagen thủy phân kết hợp chiết xuất đông trùng hạ thảo tự nhiên',
      },
    ];

    for (const item of initialList) {
      const entity = new ProductEntity(item);
      this.products.set(entity.id, entity);
    }
  }

  async findAll(): Promise<ProductEntity[]> {
    return Array.from(this.products.values());
  }

  async findById(id: string): Promise<ProductEntity> {
    const product =
      this.products.get(id) ||
      Array.from(this.products.values()).find(
        (p) => p.sku.toLowerCase() === id.toLowerCase(),
      );

    if (!product) {
      throw new NotFoundException(`Không tìm thấy sản phẩm có mã hoặc ID: ${id}`);
    }

    return product;
  }

  async create(dto: CreateProductDto): Promise<ProductEntity> {
    const existing = Array.from(this.products.values()).find(
      (p) => p.sku.toLowerCase() === dto.sku.trim().toLowerCase(),
    );

    if (existing) {
      throw new BadRequestException(`Mã SKU "${dto.sku}" đã tồn tại trong hệ thống`);
    }

    const margin =
      dto.price > 0
        ? Number((((dto.price - dto.costPrice) / dto.price) * 100).toFixed(2))
        : 0;

    const newProduct = new ProductEntity({
      id: `prod-${Date.now()}`,
      sku: dto.sku.trim().toUpperCase(),
      name: dto.name.trim(),
      category: dto.category.trim(),
      baseUnit: dto.baseUnit.trim(),
      price: dto.price,
      costPrice: dto.costPrice,
      margin,
      stockQuantity: dto.stockQuantity ?? 0,
      status: 'ACTIVE',
      barcode: dto.barcode,
      description: dto.description,
    });

    this.products.set(newProduct.id, newProduct);
    return newProduct;
  }

  async update(idOrSku: string, dto: Partial<CreateProductDto>): Promise<ProductEntity> {
    const product = await this.findById(idOrSku);
    if (dto.name !== undefined) product.name = dto.name.trim();
    if (dto.category !== undefined) product.category = dto.category.trim();
    if (dto.baseUnit !== undefined) product.baseUnit = dto.baseUnit.trim();
    if (dto.price !== undefined) product.price = Number(dto.price);
    if (dto.costPrice !== undefined) product.costPrice = Number(dto.costPrice);
    if (dto.barcode !== undefined) product.barcode = dto.barcode?.trim();
    if (dto.description !== undefined) product.description = dto.description?.trim();
    if (product.price > 0 && product.costPrice !== undefined) {
      product.margin = Number((((product.price - product.costPrice) / product.price) * 100).toFixed(2));
    }
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return product;
  }

  async updateStock(idOrSku: string, deltaQuantity: number): Promise<ProductEntity> {
    const product = await this.findById(idOrSku);
    product.stockQuantity += deltaQuantity;
    if (product.stockQuantity < 0) {
      product.stockQuantity = 0;
    }
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return product;
  }
}
