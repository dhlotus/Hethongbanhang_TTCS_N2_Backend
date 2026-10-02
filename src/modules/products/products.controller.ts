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
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CostPriceSanitizerInterceptor } from '../../common/interceptors/cost-price-sanitizer.interceptor';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity } from './entities/product.entity';
import {
  DeleteProductResult,
  PaginatedProductsResult,
} from './interfaces/product.interface';
import { ProductsService } from './products.service';

/**
 * Controller Quản lý Sản phẩm & SKU Hàng hóa (SN-138 / SN-139 / SN-20 / EP-02):
 * - Áp dụng JwtAuthGuard & RolesGuard để kiểm soát truy cập và phân quyền RBAC
 * - Áp dụng CostPriceSanitizerInterceptor để bảo vệ dữ liệu nhạy cảm:
 *   + ADMIN và SALES_MANAGER: nhìn thấy đầy đủ costPrice và margin
 *   + WAREHOUSE_KEEPER, SALES_REP, CUSTOMER, ACCOUNTANT: costPrice và margin bị loại bỏ tự động
 */
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(CostPriceSanitizerInterceptor)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * 1.1. Lấy danh sách sản phẩm (Hỗ trợ tìm kiếm đa tiêu chí & phân trang)
   * GET /api/products
   * Quyền hạn: Mọi vai trò đã đăng nhập (JwtAuthGuard)
   */
  @Get()
  async findAll(
    @Query() query: QueryProductsDto,
  ): Promise<PaginatedProductsResult> {
    return this.productsService.findAll(query);
  }

  /**
   * Lấy chi tiết một sản phẩm theo ID hoặc SKU
   * GET /api/products/:id
   * Quyền hạn: Mọi vai trò đã đăng nhập
   */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<ProductEntity> {
    return this.productsService.findById(id);
  }

  /**
   * 1.2. Thêm mới SKU sản phẩm
   * POST /api/products
   * Quyền hạn: Chỉ ADMIN và SALES_MANAGER
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateProductDto): Promise<ProductEntity> {
    return this.productsService.create(createDto);
  }

  /**
   * 1.3. Cập nhật thông tin sản phẩm
   * PATCH /api/products/:id
   * Quyền hạn: Chỉ ADMIN và SALES_MANAGER
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateProductDto,
  ): Promise<ProductEntity> {
    return this.productsService.update(id, updateDto);
  }

  /**
   * 1.4. Xóa sản phẩm (Ràng buộc nghiệp vụ toàn vẹn dữ liệu)
   * DELETE /api/products/:id
   * Quyền hạn: Chỉ ADMIN và SALES_MANAGER
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async delete(@Param('id') id: string): Promise<DeleteProductResult> {
    return this.productsService.delete(id);
  }
}
