import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CostPriceSanitizerInterceptor } from '../../common/interceptors/cost-price-sanitizer.interceptor';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductEntity } from './entities/product.entity';
import { ProductsService } from './products.service';

/**
 * Controller Quản lý Sản phẩm (SN-10 & EP-02):
 * - Áp dụng JwtAuthGuard & RolesGuard để kiểm soát truy cập phân quyền
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
   * Lấy danh sách toàn bộ sản phẩm
   * GET /products
   * Quyền: Tất cả người dùng đã đăng nhập (Dữ liệu giá vốn được lọc tự động)
   */
  @Get()
  async findAll(): Promise<ProductEntity[]> {
    return this.productsService.findAll();
  }

  /**
   * Lấy chi tiết sản phẩm theo ID hoặc SKU
   * GET /products/:id
   * Quyền: Tất cả người dùng đã đăng nhập (Dữ liệu giá vốn được lọc tự động)
   */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<ProductEntity> {
    return this.productsService.findById(id);
  }

  /**
   * Thêm mới sản phẩm vào danh mục
   * POST /products
   * Quyền: Chỉ ADMIN và SALES_MANAGER
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateProductDto): Promise<ProductEntity> {
    return this.productsService.create(createDto);
  }

  /**
   * Cập nhật thông tin sản phẩm (PATCH /products/:id)
   * Quyền: Chỉ ADMIN và SALES_MANAGER
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async update(
    @Param('id') id: string,
    @Body() updateDto: Partial<CreateProductDto>,
  ): Promise<ProductEntity> {
    return this.productsService.update(id, updateDto);
  }

  /**
   * Cập nhật thông tin sản phẩm (PUT /products/:id)
   */
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async updatePut(
    @Param('id') id: string,
    @Body() updateDto: Partial<CreateProductDto>,
  ): Promise<ProductEntity> {
    return this.productsService.update(id, updateDto);
  }
}
