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
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { GetSuppliersFilterDto } from './dto/get-suppliers-filter.dto';
import { UpdateSupplierStatusDto } from './dto/update-supplier-status.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierEntity } from './entities/supplier.entity';
import { PaginatedSuppliersResponse } from './interfaces/paginated-suppliers.interface';
import { SuppliersService } from './suppliers.service';

/**
 * Controller Quản lý Nhà Cung Cấp (SN-25 / EP-02, EP-05):
 * Cung cấp đầy đủ RESTful APIs quản lý nhà cung cấp, kiểm tra ràng buộc phiếu nhập kho
 */
@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  /**
   * Lấy danh sách nhà cung cấp phân trang, tìm kiếm và lọc trạng thái
   * GET /api/suppliers
   */
  @Get()
  async findAll(
    @Query() filterDto: GetSuppliersFilterDto,
  ): Promise<PaginatedSuppliersResponse> {
    return this.suppliersService.findAllPaginated(filterDto);
  }

  /**
   * Lấy chi tiết nhà cung cấp theo ID hoặc Mã
   * GET /api/suppliers/:id
   */
  @Get(':id')
  async findById(@Param('id') id: string): Promise<SupplierEntity> {
    return this.suppliersService.findById(id);
  }

  /**
   * Thêm mới nhà cung cấp
   * POST /api/suppliers
   */
  @Post()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
  )
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createDto: CreateSupplierDto): Promise<SupplierEntity> {
    return this.suppliersService.create(createDto);
  }

  /**
   * Cập nhật thông tin nhà cung cấp
   * PUT /api/suppliers/:id
   */
  @Put(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
  )
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateSupplierDto,
  ): Promise<SupplierEntity> {
    return this.suppliersService.update(id, updateDto);
  }

  /**
   * Chuyển đổi trạng thái hoạt động (Active / Inactive)
   * PATCH /api/suppliers/:id/status
   */
  @Patch(':id/status')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
  )
  async updateStatus(
    @Param('id') id: string,
    @Body() statusDto?: UpdateSupplierStatusDto,
  ): Promise<SupplierEntity> {
    return this.suppliersService.updateStatus(id, statusDto?.status);
  }

  /**
   * Xóa nhà cung cấp - Ràng buộc kiểm tra Phiếu nhập kho (Import Receipt Constraint)
   * DELETE /api/suppliers/:id
   */
  @Delete(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.SALES_MANAGER,
  )
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.suppliersService.remove(id);
  }
}
