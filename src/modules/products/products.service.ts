import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateProductUnitDto } from './dto/create-product-unit.dto';
import { UpdateProductUnitDto } from './dto/update-product-unit.dto';
import { ProductEntity } from './entities/product.entity';
import { ProductUnitEntity } from './entities/product-unit.entity';

/**
 * Service Quản lý Sản phẩm & Đa Đơn vị tính quy đổi (Epic: SN-21 / SN-23)
 * Quản lý danh mục SKU, giá vốn nhạy cảm và quy đổi đơn vị (Lon, Lốc, Thùng) về đơn vị cơ sở.
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
        units: [
          new ProductUnitEntity({
            id: 'unit-milk-lon',
            productId: 'prod-001',
            unitName: 'Lon',
            conversionFactor: 1,
            isBaseUnit: true,
            barcode: '8936012345011',
          }),
          new ProductUnitEntity({
            id: 'unit-milk-loc',
            productId: 'prod-001',
            unitName: 'Lốc',
            conversionFactor: 6,
            isBaseUnit: false,
            barcode: '8936012345012',
          }),
          new ProductUnitEntity({
            id: 'unit-milk-thung',
            productId: 'prod-001',
            unitName: 'Thùng',
            conversionFactor: 24,
            isBaseUnit: false,
            barcode: '8936012345013',
          }),
        ],
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
        units: [
          new ProductUnitEntity({
            id: 'unit-nut-hop',
            productId: 'prod-002',
            unitName: 'Hộp',
            conversionFactor: 1,
            isBaseUnit: true,
            barcode: '8936012345028',
          }),
          new ProductUnitEntity({
            id: 'unit-nut-loc',
            productId: 'prod-002',
            unitName: 'Lốc',
            conversionFactor: 4,
            isBaseUnit: false,
            barcode: '8936012345029',
          }),
          new ProductUnitEntity({
            id: 'unit-nut-thung',
            productId: 'prod-002',
            unitName: 'Thùng',
            conversionFactor: 48,
            isBaseUnit: false,
            barcode: '8936012345030',
          }),
        ],
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
        units: [
          new ProductUnitEntity({
            id: 'unit-nest-hu',
            productId: 'prod-003',
            unitName: 'Hũ',
            conversionFactor: 1,
            isBaseUnit: true,
            barcode: '8936012345035',
          }),
          new ProductUnitEntity({
            id: 'unit-nest-hop6',
            productId: 'prod-003',
            unitName: 'Hộp 6',
            conversionFactor: 6,
            isBaseUnit: false,
            barcode: '8936012345036',
          }),
          new ProductUnitEntity({
            id: 'unit-nest-thung',
            productId: 'prod-003',
            unitName: 'Thùng',
            conversionFactor: 30,
            isBaseUnit: false,
            barcode: '8936012345037',
          }),
        ],
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
        units: [
          new ProductUnitEntity({
            id: 'unit-cereal-tui',
            productId: 'prod-004',
            unitName: 'Túi',
            conversionFactor: 1,
            isBaseUnit: true,
            barcode: '8936012345042',
          }),
          new ProductUnitEntity({
            id: 'unit-cereal-thung',
            productId: 'prod-004',
            unitName: 'Thùng',
            conversionFactor: 20,
            isBaseUnit: false,
            barcode: '8936012345043',
          }),
        ],
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
        units: [
          new ProductUnitEntity({
            id: 'unit-collagen-chai',
            productId: 'prod-005',
            unitName: 'Chai',
            conversionFactor: 1,
            isBaseUnit: true,
            barcode: '8936012345059',
          }),
          new ProductUnitEntity({
            id: 'unit-collagen-hop10',
            productId: 'prod-005',
            unitName: 'Hộp 10',
            conversionFactor: 10,
            isBaseUnit: false,
            barcode: '8936012345060',
          }),
          new ProductUnitEntity({
            id: 'unit-collagen-thung',
            productId: 'prod-005',
            unitName: 'Thùng',
            conversionFactor: 60,
            isBaseUnit: false,
            barcode: '8936012345061',
          }),
        ],
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
      units: [],
    });

    this.products.set(newProduct.id, newProduct);
    return newProduct;
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

  // ───────────────────────────────────────────────────────────────────────────
  // QUẢN LÝ ĐA ĐƠN VỊ TÍNH QUY ĐỔI (SN-23 / Epic: SN-21)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Lấy danh sách các đơn vị tính của một sản phẩm
   */
  async getUnits(idOrSku: string): Promise<ProductUnitEntity[]> {
    const product = await this.findById(idOrSku);
    return product.units;
  }

  /**
   * Khai báo thêm đơn vị tính quy đổi mới cho SKU (Lon, Lốc, Thùng...)
   * Ràng buộc:
   * - Tên đơn vị không được trùng nhau trên cùng một sản phẩm.
   * - Hệ số quy đổi conversionFactor phải lớn hơn 0.
   */
  async addUnit(
    idOrSku: string,
    dto: CreateProductUnitDto,
  ): Promise<ProductUnitEntity> {
    const product = await this.findById(idOrSku);

    const normalizedName = dto.unitName.trim();
    const isDuplicate = product.units.some(
      (u) => u.unitName.toLowerCase() === normalizedName.toLowerCase(),
    );

    if (isDuplicate) {
      throw new BadRequestException(
        `Đơn vị tính "${normalizedName}" đã tồn tại cho sản phẩm này`,
      );
    }

    const newUnit = new ProductUnitEntity({
      productId: product.id,
      unitName: normalizedName,
      conversionFactor: dto.conversionFactor,
      isBaseUnit: dto.isBaseUnit ?? false,
      barcode: dto.barcode?.trim(),
    });

    // Nếu đơn vị mới được khai báo là đơn vị cơ sở, hủy cờ đơn vị cơ sở cũ
    if (newUnit.isBaseUnit) {
      product.units.forEach((u) => {
        u.isBaseUnit = false;
      });
      product.baseUnit = newUnit.unitName;
    }

    product.units.push(newUnit);
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return newUnit;
  }

  /**
   * Cập nhật đơn vị tính hoặc hệ số quy đổi
   * Ràng buộc: Thay đổi hệ số quy đổi tại đây không làm sai lệch các giao dịch lịch sử đã ghi.
   */
  async updateUnit(
    idOrSku: string,
    unitId: string,
    dto: UpdateProductUnitDto,
  ): Promise<ProductUnitEntity> {
    const product = await this.findById(idOrSku);
    const unit = product.units.find((u) => u.id === unitId);

    if (!unit) {
      throw new NotFoundException(
        `Không tìm thấy đơn vị tính có ID "${unitId}" của sản phẩm`,
      );
    }

    if (dto.unitName !== undefined && dto.unitName.trim() !== '') {
      const normalizedName = dto.unitName.trim();
      const isDuplicate = product.units.some(
        (u) =>
          u.id !== unitId &&
          u.unitName.toLowerCase() === normalizedName.toLowerCase(),
      );
      if (isDuplicate) {
        throw new BadRequestException(
          `Đơn vị tính "${normalizedName}" đã tồn tại cho sản phẩm này`,
        );
      }
      unit.unitName = normalizedName;
      if (unit.isBaseUnit) {
        product.baseUnit = normalizedName;
      }
    }

    if (dto.conversionFactor !== undefined) {
      if (unit.isBaseUnit && dto.conversionFactor !== 1) {
        throw new BadRequestException(
          'Đơn vị tính cơ sở luôn có hệ số quy đổi mặc định bằng 1',
        );
      }
      unit.conversionFactor = dto.conversionFactor;
    }

    if (dto.barcode !== undefined) {
      unit.barcode = dto.barcode.trim();
    }

    unit.updatedAt = new Date();
    product.updatedAt = new Date();
    this.products.set(product.id, product);
    return unit;
  }

  /**
   * Xóa một đơn vị tính quy đổi
   * Ràng buộc: Tuyệt đối không được phép xóa đơn vị tính cơ sở (isBaseUnit = true).
   */
  async deleteUnit(
    idOrSku: string,
    unitId: string,
  ): Promise<{ success: boolean; message: string }> {
    const product = await this.findById(idOrSku);
    const unitIndex = product.units.findIndex((u) => u.id === unitId);

    if (unitIndex === -1) {
      throw new NotFoundException(`Không tìm thấy đơn vị tính có ID "${unitId}"`);
    }

    const unit = product.units[unitIndex];
    if (unit.isBaseUnit) {
      throw new BadRequestException(
        'Không được phép xóa đơn vị tính cơ sở của sản phẩm',
      );
    }

    product.units.splice(unitIndex, 1);
    product.updatedAt = new Date();
    this.products.set(product.id, product);

    return {
      success: true,
      message: `Đã xóa đơn vị tính "${unit.unitName}" thành công`,
    };
  }
}
