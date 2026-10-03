import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { CreateProductUnitDto } from './dto/create-product-unit.dto';
import { UpdateProductUnitDto } from './dto/update-product-unit.dto';
import { ProductEntity } from './entities/product.entity';
import { ProductUnitEntity } from './entities/product-unit.entity';
import { ProductsService } from './products.service';

/**
 * Controller Quản lý Sản phẩm & Đa Đơn vị tính quy đổi (SN-10, EP-02 & SN-148):
 * - Áp dụng JwtAuthGuard & RolesGuard để kiểm soát truy cập phân quyền
 * - Áp dụng CostPriceSanitizerInterceptor để bảo vệ dữ liệu nhạy cảm
 * - Cung cấp API quản lý danh mục quy cách đóng gói (Lon, Lốc, Thùng)
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
   * Lấy danh sách toàn bộ đơn vị tính quy đổi của một sản phẩm
   * GET /products/:id/units
   * Quyền: Mọi vai trò đã đăng nhập (Thủ kho, Kinh doanh, Quản trị)
   */
  @Get(':id/units')
  async getUnits(@Param('id') id: string): Promise<ProductUnitEntity[]> {
    return this.productsService.getUnits(id);
  }

  /**
   * Khai báo thêm đơn vị tính quy đổi mới cho SKU (Lốc, Thùng...)
   * POST /products/:id/units
   * Quyền: ADMIN, SALES_MANAGER, WAREHOUSE_MANAGER
   */
  @Post(':id/units')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async addUnit(
    @Param('id') id: string,
    @Body() dto: CreateProductUnitDto,
  ): Promise<ProductUnitEntity> {
    return this.productsService.addUnit(id, dto);
  }

  /**
   * Cập nhật đơn vị tính hoặc hệ số quy đổi
   * PUT /products/:id/units/:unitId
   * Quyền: ADMIN, SALES_MANAGER, WAREHOUSE_MANAGER
   */
  @Put(':id/units/:unitId')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER)
  async updateUnit(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateProductUnitDto,
  ): Promise<ProductUnitEntity> {
    return this.productsService.updateUnit(id, unitId, dto);
  }

  /**
   * Xóa đơn vị tính quy đổi (Tuyệt đối không được xóa đơn vị cơ sở)
   * DELETE /products/:id/units/:unitId
   * Quyền: ADMIN, SALES_MANAGER, WAREHOUSE_MANAGER
   */
  @Delete(':id/units/:unitId')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER)
  async deleteUnit(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.productsService.deleteUnit(id, unitId);
  }
}
