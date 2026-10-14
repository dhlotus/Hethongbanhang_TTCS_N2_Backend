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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { ClonePriceListDto } from './dto/clone-price-list.dto';
import { GetPriceListsFilterDto } from './dto/get-price-lists-filter.dto';
import { UpdatePriceListStatusDto } from './dto/update-price-list-status.dto';
import { PriceListEntity } from './entities/price-list.entity';
import { PaginatedPriceListsResponse } from './interfaces/paginated-price-lists.interface';
import { PriceBooksService } from './price-books.service';

/**
 * Controller Quản lý Bảng giá & Chiết khấu B2B (Task SN-27 / EP-02):
 * Cung cấp đầy đủ RESTful APIs quản lý bảng giá, hỗ trợ cả 2 endpoint aliases:
 * - /api/price-lists
 * - /api/price-books
 */
@Controller('price-books')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PriceBooksController {
  constructor(private readonly priceBooksService: PriceBooksService) {}

  /**
   * Lấy danh sách bảng giá phân trang, tìm kiếm và lọc nhóm khách hàng / trạng thái
   * GET /api/price-lists
   */
  @Get()
  async findAll(
    @Query() filterDto: GetPriceListsFilterDto,
  ): Promise<PaginatedPriceListsResponse> {
    return this.priceBooksService.findAllPaginated(filterDto);
  }

  /**
   * Lấy chi tiết bảng giá theo ID hoặc Code
   * GET /api/price-lists/:id
   */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<PriceListEntity> {
    return this.priceBooksService.findById(id);
  }

  /**
   * Tạo mới bảng giá & ràng buộc giá sàn
   * POST /api/price-lists
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreatePriceListDto): Promise<PriceListEntity> {
    return this.priceBooksService.create(createDto);
  }

  /**
   * Chỉnh sửa bảng giá (Chặn khi hasOrders == true)
   * PUT /api/price-lists/:id
   */
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdatePriceListDto,
  ): Promise<PriceListEntity> {
    return this.priceBooksService.update(id, updateDto);
  }

  /**
   * Cập nhật trạng thái bảng giá
   * PATCH /api/price-lists/:id/status
   */
  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async updateStatus(
    @Param('id') id: string,
    @Body() statusDto: UpdatePriceListStatusDto,
  ): Promise<PriceListEntity> {
    return this.priceBooksService.updateStatus(id, statusDto.status);
  }

  /**
   * Tạo phiên bản mới (Clone Version) từ bảng giá nguồn
   * POST /api/price-lists/:id/clone
   */
  @Post(':id/clone')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async clone(
    @Param('id') id: string,
    @Body() cloneDto: ClonePriceListDto,
  ): Promise<PriceListEntity> {
    return this.priceBooksService.clone(id, cloneDto);
  }

  /**
   * Xóa bảng giá (Chặn khi hasOrders == true)
   * DELETE /api/price-lists/:id
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async delete(
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.priceBooksService.delete(id);
  }
}
