import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CategoryStatus } from '../../common/enums/category-status.enum';
import { DatabaseService } from '../../database/database.service';
import { ProductsService } from '../products/products.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { MoveProductsDto } from './dto/move-products.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryEntity } from './entities/category.entity';
import { CategoryTreeNode } from './interfaces/category-tree.interface';

/**
 * Service Quản lý Nhóm Hàng Đa Cấp (Tree Structure) - SN-150 / SN-22 (Sprint 2):
 * - Quản lý cấu trúc cây đệ quy tối thiểu 3 cấp (Ngành hàng cha -> Nhóm phụ -> Phân loại con)
 * - Ràng buộc toàn vẹn: Chặn xóa nhóm còn nhóm con hoặc còn sản phẩm
 * - Di chuyển sản phẩm an toàn giữa các nhóm hàng
 * - Ngăn chặn vòng lặp vô tận (circular dependency) khi thay đổi nhóm cha
 */
@Injectable()
export class CategoriesService implements OnModuleInit {
  private categories = new Map<string, CategoryEntity>();

  constructor(
    @Optional() private readonly dbService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService?: ProductsService,
  ) {
    this.seedInitialCategories();
  }

  async onModuleInit(): Promise<void> {
    if (this.categories.size === 0) {
      this.seedInitialCategories();
    }
    if (this.dbService?.isConnected()) {
      await this.loadCategoriesFromDatabase();
    }
  }

  /**
   * Lấy toàn bộ cây danh mục nhóm hàng phân cấp (Tree Structure)
   * GET /api/categories/tree
   */
  async getCategoryTree(): Promise<CategoryTreeNode[]> {
    const all = Array.from(this.categories.values());

    // Tìm các node gốc (parentId là null hoặc rỗng hoặc không trỏ tới node hợp lệ)
    const categoryIds = new Set(all.map((c) => c.id));
    const roots = all.filter(
      (c) => !c.parentId || !categoryIds.has(c.parentId),
    );

    const buildNode = (cat: CategoryEntity): CategoryTreeNode => {
      const children = all
        .filter((c) => c.parentId === cat.id)
        .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
        .map(buildNode);

      const directCount = this.productsService
        ? this.productsService.countDirectProductsByCategoryId(
            cat.id,
            cat.code,
            cat.name,
            children.length > 0,
          )
        : (cat.productCount ?? 0);

      const childrenCount = children.reduce(
        (sum, child) => sum + (child.productCount || 0),
        0,
      );

      const productCount = directCount + childrenCount;

      return {
        id: cat.id,
        code: cat.code,
        name: cat.name,
        parentId: cat.parentId,
        parent_id: cat.parentId,
        level: cat.level,
        description: cat.description,
        status: cat.status,
        productCount,
        product_count: productCount,
        children,
        createdAt: cat.createdAt,
        created_at: cat.createdAt,
        updatedAt: cat.updatedAt,
        updated_at: cat.updatedAt,
      };
    };

    return roots
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
      .map(buildNode);
  }

  /**
   * Lấy danh sách nhóm hàng dạng mảng phẳng
   * GET /api/categories
   */
  async findAll(): Promise<CategoryEntity[]> {
    const list = Array.from(this.categories.values());
    for (const cat of list) {
      if (this.productsService) {
        const descendantIds = this.getDescendantIds(cat.id);
        const targetIds = [cat.id, ...descendantIds];
        cat.productCount = this.productsService.findProductsByBranch(
          targetIds,
          cat.code,
          cat.name,
        ).length;
      }
    }
    return list.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  }

  /**
   * Lấy chi tiết nhóm hàng theo ID hoặc Code
   * GET /api/categories/:id
   */
  async findById(idOrCode: string): Promise<CategoryEntity> {
    const category = this.findCategoryInternal(idOrCode);
    if (!category) {
      throw new NotFoundException(
        `Không tìm thấy nhóm hàng có mã hoặc ID: ${idOrCode}`,
      );
    }

    if (this.productsService) {
      const descendantIds = this.getDescendantIds(category.id);
      const targetIds = [category.id, ...descendantIds];
      category.productCount = this.productsService.findProductsByBranch(
        targetIds,
        category.code,
        category.name,
      ).length;
    }

    // Gán danh sách nhóm con trực tiếp
    category.children = Array.from(this.categories.values()).filter(
      (c) => c.parentId === category.id,
    );

    return category;
  }

  /**
   * Lấy danh sách sản phẩm thuộc một nhóm hàng và toàn bộ nhóm con/cháu bên dưới
   * GET /api/categories/:id/products
   */
  async getProductsByCategoryId(idOrCode: string): Promise<any[]> {
    const category = await this.findById(idOrCode);
    if (!this.productsService) return [];
    const descendantIds = this.getDescendantIds(category.id);
    const targetIds = [category.id, ...descendantIds];
    return this.productsService.findProductsByBranch(
      targetIds,
      category.code,
      category.name,
    );
  }

  /**
   * Lấy danh sách ID của tất cả nhóm hàng con và cháu phân cấp đệ quy
   */
  public getDescendantIds(categoryId: string): string[] {
    const results: string[] = [];
    const directChildren = Array.from(this.categories.values()).filter(
      (c) => c.parentId === categoryId,
    );
    for (const child of directChildren) {
      results.push(child.id);
      results.push(...this.getDescendantIds(child.id));
    }
    return results;
  }

  /**
   * Tạo nhóm hàng mới
   * POST /api/categories
   * Quyền: ADMIN, SALES_MANAGER
   */
  async create(dto: CreateCategoryDto): Promise<CategoryEntity> {
    const cleanCode = dto.code.trim().toUpperCase();

    if (this.findCategoryInternal(cleanCode)) {
      throw new BadRequestException('Mã nhóm hàng đã tồn tại trên hệ thống');
    }

    let level = 1;
    let parentId: string | null = null;

    if (dto.parentId) {
      const parent = this.findCategoryInternal(dto.parentId);
      if (!parent) {
        throw new NotFoundException('Nhóm hàng cha không tồn tại');
      }
      parentId = parent.id;
      level = parent.level + 1;
    }

    const id = `cat-${randomUUID()}`;
    const newCategory = new CategoryEntity({
      id,
      code: cleanCode,
      name: dto.name.trim(),
      parentId,
      level,
      description: dto.description?.trim() || null,
      status: dto.status ?? CategoryStatus.ACTIVE,
      productCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.categories.set(newCategory.id, newCategory);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `INSERT INTO categories (code, name, parent_id, level, status)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (code) DO NOTHING;`,
          [
            newCategory.code,
            newCategory.name,
            newCategory.parentId,
            newCategory.level,
            newCategory.status,
          ],
        );
      } catch {
        // Fallback an toàn
      }
    }

    return newCategory;
  }

  /**
   * Cập nhật thông tin nhóm hàng và kiểm soát chống vòng lặp đệ quy
   * PATCH /api/categories/:id
   * Quyền: ADMIN, SALES_MANAGER
   */
  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryEntity> {
    const category = await this.findById(id);

    // 1. Kiểm tra tính duy nhất nếu đổi code
    if (dto.code !== undefined) {
      const cleanCode = dto.code.trim().toUpperCase();
      const existing = this.findCategoryInternal(cleanCode);
      if (existing && existing.id !== category.id) {
        throw new BadRequestException('Mã nhóm hàng đã tồn tại trên hệ thống');
      }
      category.code = cleanCode;
    }

    if (dto.name !== undefined) {
      category.name = dto.name.trim();
    }

    if (dto.description !== undefined) {
      category.description = dto.description?.trim() || null;
    }

    if (dto.status !== undefined) {
      category.status = dto.status;
    }

    // 2. Kiểm tra thay đổi parentId và chống Circular Dependency
    if (dto.parentId !== undefined) {
      if (dto.parentId === category.id) {
        throw new BadRequestException(
          'Không thể chọn chính nhóm hàng làm nhóm cha (vòng lặp vô tận)',
        );
      }

      if (dto.parentId) {
        const newParent = this.findCategoryInternal(dto.parentId);
        if (!newParent) {
          throw new NotFoundException('Nhóm hàng cha không tồn tại');
        }

        // Chặn chọn nhóm con hoặc cháu làm nhóm cha
        if (this.isDescendant(category.id, newParent.id)) {
          throw new BadRequestException(
            'Không thể chọn nhóm con/cháu làm nhóm cha (vòng lặp vô tận)',
          );
        }

        category.parentId = newParent.id;
        category.level = newParent.level + 1;
      } else {
        category.parentId = null;
        category.level = 1;
      }

      // Cập nhật lại level của toàn bộ cây con bên dưới
      this.updateDescendantLevels(category);
    }

    category.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE categories
           SET code = $1, name = $2, parent_id = $3, level = $4, status = $5, updated_at = CURRENT_TIMESTAMP
           WHERE id::text = $6 OR code = $6;`,
          [
            category.code,
            category.name,
            category.parentId,
            category.level,
            category.status,
            category.id,
          ],
        );
      } catch {
        // Fallback
      }
    }

    return category;
  }

  /**
   * Di chuyển sản phẩm giữa các nhóm hàng
   * POST /api/categories/move-products
   * Quyền: ADMIN, SALES_MANAGER
   */
  async moveProducts(
    dto: MoveProductsDto,
  ): Promise<{
    success: boolean;
    message: string;
    sourceCategoryId: string;
    targetCategoryId: string;
    movedCount: number;
  }> {
    if (dto.sourceCategoryId === dto.targetCategoryId) {
      throw new BadRequestException(
        'Nhóm hàng đích phải khác nhóm hàng nguồn',
      );
    }

    const sourceCat = await this.findById(dto.sourceCategoryId);
    const targetCat = await this.findById(dto.targetCategoryId);

    let movedCount = 0;
    if (this.productsService) {
      movedCount = await this.productsService.moveProductsBetweenCategories(
        sourceCat.id,
        targetCat.id,
        targetCat.name,
        dto.productIds,
        sourceCat.code,
        sourceCat.name,
      );
    }

    return {
      success: true,
      message: `Đã chuyển thành công ${movedCount} sản phẩm từ nhóm [${sourceCat.name}] sang nhóm [${targetCat.name}]`,
      sourceCategoryId: sourceCat.id,
      targetCategoryId: targetCat.id,
      movedCount,
    };
  }

  /**
   * Xóa nhóm hàng với ràng buộc toàn vẹn cứng
   * DELETE /api/categories/:id
   * Quyền: ADMIN, SALES_MANAGER
   * Ràng buộc:
   * 1. Không có nhóm con
   * 2. Không có sản phẩm
   */
  async delete(id: string): Promise<{ success: boolean; message: string }> {
    const category = await this.findById(id);

    // 1. Kiểm tra nhóm con
    const hasChildren = Array.from(this.categories.values()).some(
      (c) => c.parentId === category.id,
    );
    if (hasChildren) {
      throw new BadRequestException(
        'Nhóm hàng đang chứa nhóm hàng con. Vui lòng chuyển hoặc xóa nhóm con trước.',
      );
    }

    // 2. Kiểm tra sản phẩm trong nhóm
    const productCount = this.productsService
      ? this.productsService.countProductsByCategoryId(
          category.id,
          category.code,
          category.name,
        )
      : (category.productCount ?? 0);

    if (productCount > 0) {
      throw new BadRequestException(
        'Nhóm còn sản phẩm thì không xoá được. Vui lòng chuyển sản phẩm sang nhóm khác trước khi xoá.',
      );
    }

    // 3. Thực hiện xóa khi nhóm hoàn toàn rỗng
    this.categories.delete(category.id);

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `DELETE FROM categories WHERE id::text = $1 OR code = $1;`,
          [category.id],
        );
      } catch {
        // Fallback
      }
    }

    return {
      success: true,
      message: `Đã xóa thành công nhóm hàng [${category.name}].`,
    };
  }

  /**
   * Kiểm tra xem targetId có phải là hậu duệ (con/cháu) của ancestorId không
   */
  private isDescendant(ancestorId: string, targetId: string): boolean {
    let current = this.categories.get(targetId);
    const visited = new Set<string>();

    while (current && current.parentId) {
      if (current.parentId === ancestorId) {
        return true;
      }
      if (visited.has(current.parentId)) {
        break;
      }
      visited.add(current.parentId);
      current = this.categories.get(current.parentId);
    }

    return false;
  }

  /**
   * Cập nhật đệ quy cấp bậc (level) cho tất cả các nhóm con bên dưới
   */
  private updateDescendantLevels(parent: CategoryEntity): void {
    const directChildren = Array.from(this.categories.values()).filter(
      (c) => c.parentId === parent.id,
    );

    for (const child of directChildren) {
      child.level = parent.level + 1;
      child.updatedAt = new Date();
      this.updateDescendantLevels(child);
    }
  }

  /**
   * Tìm kiếm nhóm hàng nội bộ theo id hoặc code (không ném lỗi nếu không thấy)
   */
  private findCategoryInternal(idOrCode: string): CategoryEntity | undefined {
    if (!idOrCode) return undefined;
    const direct = this.categories.get(idOrCode);
    if (direct) return direct;

    const lower = idOrCode.toLowerCase().trim();
    return Array.from(this.categories.values()).find(
      (c) =>
        c.id.toLowerCase() === lower || c.code.toLowerCase() === lower,
    );
  }

  /**
   * Tải danh mục nhóm hàng từ PostgreSQL (nếu có bảng categories)
   */
  private async loadCategoriesFromDatabase(): Promise<void> {
    try {
      const rows = await this.dbService!.query<{
        id: string | number;
        code: string;
        name: string;
        parent_id?: string | number | null;
        level?: number;
        status?: string;
        description?: string;
        created_at?: Date;
        updated_at?: Date;
      }>(
        `SELECT id, code, name, parent_id, level, status, created_at, updated_at
         FROM categories
         ORDER BY level ASC, id ASC;`,
      );

      for (const row of rows) {
        const idStr = String(row.id);
        const parentIdStr =
          row.parent_id !== null && row.parent_id !== undefined
            ? String(row.parent_id)
            : null;

        const existing = this.findCategoryInternal(row.code);
        if (!existing) {
          const entity = new CategoryEntity({
            id: idStr,
            code: row.code,
            name: row.name,
            parentId: parentIdStr,
            level: Number(row.level) || 1,
            status:
              (row.status as CategoryStatus) || CategoryStatus.ACTIVE,
            createdAt: row.created_at ? new Date(row.created_at) : new Date(),
            updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
          });
          this.categories.set(entity.id, entity);
        }
      }
    } catch {
      // Fallback
    }
  }

  /**
   * Khởi tạo cây danh mục mẫu 3 cấp chuẩn hóa ngành FMCG & Thực phẩm Đồ uống
   */
  private seedInitialCategories(): void {
    const seeds: Partial<CategoryEntity>[] = [
      // 1. Sữa & Chế phẩm sữa (Cấp 1)
      {
        id: 'cat-milk',
        code: 'MILK',
        name: 'Sữa & Chế phẩm sữa',
        parentId: null,
        level: 1,
        description: 'Các sản phẩm sữa bột, sữa hạt, sữa tươi thanh trùng',
        status: CategoryStatus.ACTIVE,
      },
      // 1.1 Sữa bột công thức (Cấp 2)
      {
        id: 'cat-milk-powder',
        code: 'MILK_POWDER',
        name: 'Sữa bột công thức',
        parentId: 'cat-milk',
        level: 2,
        description: 'Sữa bột dinh dưỡng cho trẻ nhỏ và người cao tuổi',
        status: CategoryStatus.ACTIVE,
      },
      // 1.1.1 Sữa bột trẻ em (Cấp 3)
      {
        id: 'cat-milk-powder-baby',
        code: 'MILK_POWDER_BABY',
        name: 'Sữa bột cho trẻ em',
        parentId: 'cat-milk-powder',
        level: 3,
        description: 'Sữa bột phát triển chiều cao và trí não cho trẻ',
        status: CategoryStatus.ACTIVE,
      },
      // 1.1.2 Sữa bột người lớn (Cấp 3)
      {
        id: 'cat-milk-powder-adult',
        code: 'MILK_POWDER_ADULT',
        name: 'Sữa bột người lớn & cao tuổi',
        parentId: 'cat-milk-powder',
        level: 3,
        description: 'Sữa canxi ngừa loãng xương cho người lớn',
        status: CategoryStatus.ACTIVE,
      },
      // 1.2 Sữa hạt organic (Cấp 2)
      {
        id: 'cat-milk-nut',
        code: 'MILK_NUT',
        name: 'Sữa hạt organic',
        parentId: 'cat-milk',
        level: 2,
        description: 'Sữa hạt óc chó, hạnh nhân, mắc ca nguyên chất',
        status: CategoryStatus.ACTIVE,
      },
      // 1.3 Sữa tươi & Tiệt trùng (Cấp 2)
      {
        id: 'cat-milk-ready',
        code: 'MILK_READY',
        name: 'Sữa tươi & Tiệt trùng',
        parentId: 'cat-milk',
        level: 2,
        description: 'Sữa bò tươi thanh trùng và tiệt trùng đóng chai',
        status: CategoryStatus.ACTIVE,
      },

      // 2. Nước yến & Bổ dưỡng (Cấp 1)
      {
        id: 'cat-nest',
        code: 'NEST',
        name: 'Nước yến & Bổ dưỡng',
        parentId: null,
        level: 1,
        description: 'Nước yến chưng sẵn và tổ yến sào tự nhiên',
        status: CategoryStatus.ACTIVE,
      },
      // 2.1 Nước yến chưng sẵn (Cấp 2)
      {
        id: 'cat-nest-ready',
        code: 'NEST_READY',
        name: 'Nước yến chưng sẵn',
        parentId: 'cat-nest',
        level: 2,
        description: 'Nước yến đóng hũ tiện dụng bồi bổ sức khỏe',
        status: CategoryStatus.ACTIVE,
      },
      // 2.1.1 Nước yến chưng đường phèn (Cấp 3)
      {
        id: 'cat-nest-ready-sugar',
        code: 'NEST_READY_SUGAR',
        name: 'Nước yến chưng đường phèn',
        parentId: 'cat-nest-ready',
        level: 3,
        description: 'Yến hũ chưng đường phèn thanh mát',
        status: CategoryStatus.ACTIVE,
      },
      // 2.2 Tổ yến sào tinh chế (Cấp 2)
      {
        id: 'cat-nest-pure',
        code: 'NEST_PURE',
        name: 'Tổ yến sào tinh chế',
        parentId: 'cat-nest',
        level: 2,
        description: 'Tổ yến sào làm sạch lông cao cấp hộp quà',
        status: CategoryStatus.ACTIVE,
      },

      // 3. Ngũ cốc & Hạt dinh dưỡng (Cấp 1)
      {
        id: 'cat-cereal',
        code: 'CEREAL',
        name: 'Ngũ cốc & Hạt dinh dưỡng',
        parentId: null,
        level: 1,
        description: 'Ngũ cốc hạt mầm và hạt sấy giòn nguyên chất',
        status: CategoryStatus.ACTIVE,
      },
      // 3.1 Ngũ cốc hạt mầm (Cấp 2)
      {
        id: 'cat-cereal-sprout',
        code: 'CEREAL_SPROUT',
        name: 'Ngũ cốc hạt mầm',
        parentId: 'cat-cereal',
        level: 2,
        description: 'Bột ngũ cốc hạt mầm dinh dưỡng bữa ăn lành mạnh',
        status: CategoryStatus.ACTIVE,
      },
      // 3.2 Hạt dinh dưỡng sấy giòn (Cấp 2)
      {
        id: 'cat-cereal-nuts',
        code: 'CEREAL_NUTS',
        name: 'Hạt dinh dưỡng sấy giòn',
        parentId: 'cat-cereal',
        level: 2,
        description: 'Macca, óc chó, hạnh nhân nhập khẩu sấy giòn',
        status: CategoryStatus.ACTIVE,
      },
      // 3.2.1 Hạt Macca sấy (Cấp 3)
      {
        id: 'cat-cereal-nuts-macca',
        code: 'CEREAL_NUTS_MACCA',
        name: 'Hạt Macca sấy nứt vỏ',
        parentId: 'cat-cereal-nuts',
        level: 3,
        description: 'Macca Tây Nguyên sấy giòn tự nhiên',
        status: CategoryStatus.ACTIVE,
      },

      // 4. Thực phẩm chức năng (Cấp 1)
      {
        id: 'cat-supp',
        code: 'SUPP',
        name: 'Thực phẩm chức năng',
        parentId: null,
        level: 1,
        description: 'Collagen và các sản phẩm đông trùng hạ thảo',
        status: CategoryStatus.ACTIVE,
      },
      // 4.1 Collagen & Chống lão hóa (Cấp 2)
      {
        id: 'cat-supp-collagen',
        code: 'SUPP_COLLAGEN',
        name: 'Collagen & Chống lão hóa',
        parentId: 'cat-supp',
        level: 2,
        description: 'Nước uống collagen thủy phân làm đẹp da',
        status: CategoryStatus.ACTIVE,
      },
      // 4.2 Đông trùng & Thảo dược (Cấp 2)
      {
        id: 'cat-supp-herb',
        code: 'SUPP_HERB',
        name: 'Đông trùng & Thảo dược',
        parentId: 'cat-supp',
        level: 2,
        description: 'Chiết xuất nấm đông trùng hạ thảo tự nhiên',
        status: CategoryStatus.ACTIVE,
      },

      // 5. Nước giải khát & Trà (Cấp 1)
      {
        id: 'cat-bev',
        code: 'BEV',
        name: 'Nước giải khát & Trà',
        parentId: null,
        level: 1,
        description: 'Trà thảo mộc và nước khoáng đóng chai',
        status: CategoryStatus.ACTIVE,
      },
      // 5.1 Trà thảo mộc thanh nhiệt (Cấp 2)
      {
        id: 'cat-bev-tea',
        code: 'BEV_TEA',
        name: 'Trà thảo mộc thanh nhiệt',
        parentId: 'cat-bev',
        level: 2,
        description: 'Trà hoa cúc, la hán quả mát lành thanh nhiệt',
        status: CategoryStatus.ACTIVE,
      },
      // 5.2 Nước khoáng thiên nhiên (Cấp 2)
      {
        id: 'cat-bev-water',
        code: 'BEV_WATER',
        name: 'Nước khoáng thiên nhiên',
        parentId: 'cat-bev',
        level: 2,
        description: 'Nước khoáng kiềm tự nhiên đóng chai PET',
        status: CategoryStatus.ACTIVE,
      },

      // 6. Nhóm hàng thử nghiệm (Trống - không có sản phẩm hay nhóm con, phục vụ test xóa)
      {
        id: 'cat-empty-sample',
        code: 'SAMPLE_EMPTY',
        name: 'Nhóm hàng thử nghiệm (Trống)',
        parentId: null,
        level: 1,
        description: 'Nhóm trống mẫu phục vụ kiểm thử nghiệp vụ xóa',
        status: CategoryStatus.ACTIVE,
      },
    ];

    for (const seed of seeds) {
      const entity = new CategoryEntity(seed as Partial<CategoryEntity>);
      this.categories.set(entity.id, entity);
    }
  }
}
