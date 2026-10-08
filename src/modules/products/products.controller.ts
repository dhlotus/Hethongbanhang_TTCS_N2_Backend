import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CostPriceSanitizerInterceptor } from '../../common/interceptors/cost-price-sanitizer.interceptor';
import { CreateProductDto } from './dto/create-product.dto';
import { GetProductsFilterDto } from './dto/get-products-filter.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ConfirmImportDto } from './dto/import-product.dto';
import { ProductUnitDto } from './dto/product-unit.dto';
import { ProductEntity } from './entities/product.entity';
import { ProductUnitEntity } from './entities/product-unit.entity';
import { PaginatedProductsResponse } from './interfaces/paginated-products.interface';
import { ProductsService } from './products.service';

/**
 * Controller Quản lý Sản phẩm / SKU Hàng hóa (SN-138 & SN-20 / EP-02 / SN-21 / SN-23 / SN-24):
 * - Áp dụng JwtAuthGuard & RolesGuard để kiểm soát truy cập phân quyền
 * - Áp dụng CostPriceSanitizerInterceptor để bảo mật dữ liệu nhạy cảm:
 *   + ADMIN và SALES_MANAGER: nhìn thấy đầy đủ costPrice và margin
 *   + SALES_REP, WAREHOUSE_KEEPER, CUSTOMER, ACCOUNTANT: costPrice và margin bị tự động lọc sạch
 * - Endpoint POST, PATCH, DELETE: Giới hạn chỉ ADMIN và SALES_MANAGER mới có quyền thao tác
 * - Tích hợp đầy đủ:
 *   + SN-24: Import danh mục từ Excel (template, preview, confirm)
 *   + SN-21 / SN-23: Quản lý đa đơn vị tính quy đổi (:id/units)
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
   * Tải tệp mẫu Excel để nhập sản phẩm hàng loạt (SN-24)
   * GET /products/import-template
   */
  @Get('import-template')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async downloadTemplate(@Res() res: Response) {
    return this.productsService.generateImportTemplate(res);
  }

  /**
   * Xem trước tệp Excel tải lên (SN-24)
   * POST /products/import/preview
   */
  @Post('import/preview')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @UseInterceptors(FileInterceptor('file'))
  async previewImport(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Vui lòng tải lên tệp Excel');
    }
    return this.productsService.previewImport(file);
  }

  /**
   * Xác nhận nhập dữ liệu từ bản xem trước (SN-24)
   * POST /products/import/confirm
   */
  @Post('import/confirm')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.OK)
  async confirmImport(@Body() confirmDto: ConfirmImportDto) {
    if (!confirmDto.items || !Array.isArray(confirmDto.items)) {
      throw new BadRequestException('Dữ liệu không hợp lệ');
    }
    return this.productsService.confirmImport(confirmDto.items);
  }

  /**
   * Lấy danh sách đơn vị quy đổi của SKU (SN-21 / SN-23)
   * GET /api/products/:id/units
   */
  @Get(':id/units')
  async getUnits(@Param('id') id: string): Promise<ProductUnitEntity[]> {
    return this.productsService.getUnitsByProductId(id);
  }

  /**
   * Thêm đơn vị quy đổi mới cho SKU (SN-21 / SN-23)
   * POST /api/products/:id/units
   * Quyền: ADMIN, SALES_MANAGER, WAREHOUSE_MANAGER
   */
  @Post(':id/units')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  @HttpCode(HttpStatus.CREATED)
  async addUnit(
    @Param('id') id: string,
    @Body() dto: ProductUnitDto,
  ): Promise<ProductUnitEntity> {
    return this.productsService.addUnit(id, dto);
  }

  /**
   * Cập nhật đơn vị quy đổi của SKU (SN-21 / SN-23)
   * PUT /api/products/:id/units/:unitId
   * Quyền: ADMIN, SALES_MANAGER, WAREHOUSE_MANAGER
   */
  @Put(':id/units/:unitId')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  @HttpCode(HttpStatus.OK)
  async updateUnit(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
    @Body() dto: Partial<ProductUnitDto>,
  ): Promise<ProductUnitEntity> {
    return this.productsService.updateUnit(id, unitId, dto);
  }

  /**
   * Xóa đơn vị quy đổi của SKU (SN-21 / SN-23)
   * DELETE /api/products/:id/units/:unitId
   * Quyền: ADMIN, SALES_MANAGER, WAREHOUSE_MANAGER
   */
  @Delete(':id/units/:unitId')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  @HttpCode(HttpStatus.OK)
  async deleteUnit(
    @Param('id') id: string,
    @Param('unitId') unitId: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.productsService.deleteUnit(id, unitId);
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
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateDto: UpdateProductDto,
  ): Promise<ProductEntity> {
    const userName = req.user?.fullName || req.user?.username || 'Hệ thống';
    return this.productsService.update(id, updateDto, userName);
  }

  /**
   * Cập nhật thông tin sản phẩm (Hỗ trợ PUT /products/:id)
   */
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.OK)
  async updatePut(
    @Req() req: any,
    @Param('id') id: string,
    @Body() updateDto: UpdateProductDto,
  ): Promise<ProductEntity> {
    const userName = req.user?.fullName || req.user?.username || 'Hệ thống';
    return this.productsService.update(id, updateDto, userName);
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
