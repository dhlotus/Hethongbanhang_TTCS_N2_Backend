import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
import { ProductEntity } from './entities/product.entity';
import { ProductsService } from './products.service';

/**
 * Controller Quản lý Sản phẩm (SN-10, EP-02, SN-24):
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
