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
import { Public } from '../../common/decorators/public.decorator';
import { ClonePriceListDto } from './dto/clone-price-list.dto';
import { CreatePriceListDto } from './dto/create-price-list.dto';
import { GetPriceListsFilterDto } from './dto/get-price-lists-filter.dto';
import { UpdatePriceListStatusDto } from './dto/update-price-list-status.dto';
import { UpdatePriceListDto } from './dto/update-price-list.dto';
import { PriceListEntity } from './entities/price-list.entity';
import { PaginatedPriceListsResponse } from './interfaces/paginated-price-lists.interface';
import { PriceListsService } from './price-lists.service';

/**
 * Controller Quản lý Bảng giá & Chiết khấu B2B (SN-27 / EP-02):
 * Cung cấp đầy đủ RESTful APIs quản lý bảng giá, phân trang, clone phiên bản, và bảo vệ dữ liệu
 */
@Controller('price-lists')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PriceListsController {
  constructor(private readonly priceListsService: PriceListsService) {}

  /**
   * Lấy danh sách bảng giá phân trang, tìm kiếm và lọc nhóm khách hàng / trạng thái
   * GET /api/price-lists
   */
  @Get()
  @Public()
  async findAll(
    @Query() filterDto: GetPriceListsFilterDto,
  ): Promise<PaginatedPriceListsResponse> {
    return this.priceListsService.findAllPaginated(filterDto);
  }

  /**
   * Lấy chi tiết bảng giá theo ID hoặc Mã
   * GET /api/price-lists/:id
   */
  @Get(':id')
  @Public()
  async findById(@Param('id') id: string): Promise<PriceListEntity> {
    return this.priceListsService.findById(id);
  }

  /**
   * Tạo mới bảng giá B2B
   * POST /api/price-lists
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createDto: CreatePriceListDto,
  ): Promise<PriceListEntity> {
    return this.priceListsService.create(createDto);
  }

  /**
   * Cập nhật thông tin bảng giá
   * PUT /api/price-lists/:id
   */
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdatePriceListDto,
  ): Promise<PriceListEntity> {
    return this.priceListsService.update(id, updateDto);
  }

  /**
   * Bật/Tắt cập nhật nhanh trạng thái bảng giá
   * PATCH /api/price-lists/:id/status
   */
  @Patch(':id/status')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async updateStatus(
    @Param('id') id: string,
    @Body() statusDto: UpdatePriceListStatusDto,
  ): Promise<PriceListEntity> {
    return this.priceListsService.updateStatus(id, statusDto.status);
  }

  /**
   * Nhân bản phiên bản mới từ bảng giá hiện tại (Clone Version)
   * POST /api/price-lists/:id/clone
   */
  @Post(':id/clone')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async clone(
    @Param('id') id: string,
    @Body() cloneDto?: ClonePriceListDto,
  ): Promise<PriceListEntity> {
    return this.priceListsService.clone(id, cloneDto);
  }

  /**
   * Xóa bảng giá khỏi hệ thống (Chặn khi đã có đơn hàng)
   * DELETE /api/price-lists/:id
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.priceListsService.remove(id);
  }
}
