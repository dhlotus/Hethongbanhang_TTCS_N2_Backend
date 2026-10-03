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
import { GetProductsFilterDto } from './dto/get-products-filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductEntity } from './entities/product.entity';
import { PaginatedProductsResponse } from './interfaces/paginated-products.interface';
import { ProductsService } from './products.service';

/**
 * Controller Quản lý Sản phẩm / SKU Hàng hóa (SN-138 & SN-20 / EP-02):
 * - Áp dụng JwtAuthGuard & RolesGuard để kiểm soát truy cập phân quyền
 * - Áp dụng CostPriceSanitizerInterceptor để bảo mật dữ liệu nhạy cảm:
 *   + ADMIN và SALES_MANAGER: nhìn thấy đầy đủ costPrice và margin
 *   + SALES_REP, WAREHOUSE_KEEPER, CUSTOMER, ACCOUNTANT: costPrice và margin bị tự động lọc sạch
 * - Endpoint POST, PATCH, DELETE: Giới hạn chỉ ADMIN và SALES_MANAGER mới có quyền thao tác
 */
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(CostPriceSanitizerInterceptor)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * Lấy danh sách sản phẩm phân trang, tìm kiếm và lọc danh mục / trạng thái
   * GET /api/products
   * Quyền: Mọi vai trò đã đăng nhập (Giá vốn và biên LN được lọc theo vai trò)
   */
  @Get()
  async findAll(
    @Query() filterDto: GetProductsFilterDto,
  ): Promise<PaginatedProductsResponse> {
    return this.productsService.findAllPaginated(filterDto);
  }

  /**
   * Lấy chi tiết sản phẩm theo ID hoặc SKU
   * GET /api/products/:id
   * Quyền: Mọi vai trò đã đăng nhập (Giá vốn và biên LN được lọc theo vai trò)
   */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<ProductEntity> {
    return this.productsService.findById(id);
  }

  /**
   * Thêm mới SKU sản phẩm
   * POST /api/products
   * Quyền: Chỉ ADMIN và SALES_MANAGER
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateProductDto): Promise<ProductEntity> {
    return this.productsService.create(createDto);
  }

  /**
   * Cập nhật thông tin sản phẩm / SKU
   * PATCH /api/products/:id
   * Quyền: Chỉ ADMIN và SALES_MANAGER
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateProductDto,
  ): Promise<ProductEntity> {
    return this.productsService.update(id, updateDto);
  }

  /**
   * Xóa sản phẩm khỏi danh mục
   * DELETE /api/products/:id
   * Quyền: Chỉ ADMIN và SALES_MANAGER
   * Ràng buộc: Chặn xóa nếu sản phẩm đã phát sinh giao dịch đơn hàng hoặc kho
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.productsService.delete(id);
  }
}
