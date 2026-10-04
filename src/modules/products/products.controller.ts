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
import { ProductEntity } from './entities/product.entity';
import { PaginatedProductsResponse } from './interfaces/paginated-products.interface';
import { ProductsService } from './products.service';

/**
 * Controller Quản lý Sản phẩm / SKU Hàng hóa (SN-138 & SN-20 / EP-02, SN-24):
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
  async confirmImport(@Body('items') items: any[]) {
    if (!items || !Array.isArray(items)) {
      throw new BadRequestException('Dữ liệu không hợp lệ');
    }
    return this.productsService.confirmImport(items);
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
   * Cập nhật thông tin sản phẩm (Hỗ trợ PUT /products/:id)
   */
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.OK)
  async updatePut(
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
