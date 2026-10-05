import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { MoveProductsDto } from './dto/move-products.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryEntity } from './entities/category.entity';
import { CategoryTreeNode } from './interfaces/category-tree.interface';

/**
 * Controller Quản lý Nhóm Hàng Đa Cấp (Tree Structure) - SN-150 / SN-22:
 * - Bảo vệ bởi JwtAuthGuard và RolesGuard (RBAC)
 * - Mọi vai trò đã đăng nhập được xem cây danh mục và chi tiết nhóm hàng
 * - Quyền thêm, sửa, xóa, di chuyển sản phẩm: Giới hạn ADMIN và SALES_MANAGER
 */
@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * Lấy toàn bộ cây danh mục nhóm hàng phân cấp đa cấp (Tree Structure)
   * GET /api/categories/tree
   * Quyền: Mọi vai trò đã xác thực
   */
  @Get('tree')
  async getCategoryTree(): Promise<CategoryTreeNode[]> {
    return this.categoriesService.getCategoryTree();
  }

  /**
   * Lấy danh sách nhóm hàng dạng mảng phẳng
   * GET /api/categories
   * Quyền: Mọi vai trò đã xác thực
   */
  @Get()
  async findAll(): Promise<CategoryEntity[]> {
    return this.categoriesService.findAll();
  }

  /**
   * Lấy chi tiết nhóm hàng theo ID hoặc Code
   * GET /api/categories/:id
   * Quyền: Mọi vai trò đã xác thực
   */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<CategoryEntity> {
    return this.categoriesService.findById(id);
  }

  /**
   * Lấy danh sách sản phẩm thuộc một nhóm hàng (và toàn bộ các phân loại con của nhóm đó)
   * GET /api/categories/:id/products
   * Quyền: Mọi vai trò đã xác thực
   */
  @Get(':id/products')
  async getProductsByCategory(@Param('id') id: string) {
    return this.categoriesService.getProductsByCategoryId(id);
  }

  /**
   * Tạo nhóm hàng mới
   * POST /api/categories
   * Quyền: ADMIN, SALES_MANAGER
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryEntity> {
    return this.categoriesService.create(dto);
  }

  /**
   * Di chuyển sản phẩm giữa các nhóm hàng
   * POST /api/categories/move-products
   * Quyền: ADMIN, SALES_MANAGER
   */
  @Post('move-products')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.OK)
  async moveProducts(
    @Body() dto: MoveProductsDto,
  ): Promise<{
    success: boolean;
    message: string;
    sourceCategoryId: string;
    targetCategoryId: string;
    movedCount: number;
  }> {
    return this.categoriesService.moveProducts(dto);
  }

  /**
   * Cập nhật thông tin nhóm hàng (kiểm soát chống vòng lặp vô tận)
   * PATCH /api/categories/:id
   * Quyền: ADMIN, SALES_MANAGER
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryEntity> {
    return this.categoriesService.update(id, dto);
  }

  /**
   * Xóa nhóm hàng (Ràng buộc cứng: Chặn xóa nếu còn nhóm con hoặc còn sản phẩm)
   * DELETE /api/categories/:id
   * Quyền: ADMIN, SALES_MANAGER
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async delete(
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.categoriesService.delete(id);
  }
}
