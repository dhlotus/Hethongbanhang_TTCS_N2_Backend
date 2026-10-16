import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentEntity } from './entities/shipment.entity';
import { ConfirmShipmentDto } from './dto/confirm-shipment.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { QueryShipmentsDto } from './dto/query-shipments.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Phiếu xuất kho & Giao hàng (Module 6 & SN-195)
 * Quyền:
 * - Nhân viên kho (WAREHOUSE_KEEPER, WAREHOUSE), Quản lý kho (WAREHOUSE_MANAGER, WH_MANAGER), Admin: Quản lý & Xác nhận xuất kho
 * - Kinh doanh (SALES_REP, SALES_MANAGER): Xem theo tuyến phụ trách
 * - Khách hàng (CUSTOMER): Xem phiếu xuất của chính mình
 */
@Controller('shipments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  /**
   * Danh sách phiếu xuất kho / giao hàng
   * GET /api/shipments
   */
  @Get()
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.WAREHOUSE,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async findAll(
    @Query() query: QueryShipmentsDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ShipmentEntity[]> {
    return this.shipmentsService.findAll(query as any, currentUser);
  }

  /**
   * Danh sách các đơn / phiếu xuất còn nợ hàng (Backorders) - SN-195
   * GET /api/shipments/backorders
   */
  @Get('backorders')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.WAREHOUSE,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async getBackorders(@CurrentUser() currentUser: ICurrentUser): Promise<ShipmentEntity[]> {
    return this.shipmentsService.getBackorders(currentUser);
  }

  /**
   * Chi tiết phiếu xuất kho
   * GET /api/shipments/:id
   */
  @Get(':id')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.WAREHOUSE,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async findById(
    @Param('id') id: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ShipmentEntity> {
    return this.shipmentsService.findById(id, currentUser);
  }

  /**
   * Tạo phiếu xuất kho & giao hàng
   * POST /api/shipments
   */
  @Post()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async create(
    @Body() dto: CreateShipmentDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ShipmentEntity> {
    return this.shipmentsService.create(dto, currentUser);
  }

  /**
   * Cập nhật trạng thái giao hàng / mã vận đơn / POD
   * PATCH /api/shipments/:id/status
   */
  @Patch(':id/status')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: ShipmentEntity['status'],
    @Body() dto: Partial<ShipmentEntity>,
  ): Promise<ShipmentEntity> {
    return this.shipmentsService.updateStatus(id, status, dto);
  }

  /**
   * XÁC NHẬN XUẤT KHO VÀ XỬ LÝ GIAO THIẾU (SN-195)
   * POST /api/shipments/:id/confirm-export
   * Quyền: Nhân viên kho, Quản lý kho, Quản trị viên
   */
  @Post(':id/confirm-export')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async confirmExport(
    @Param('id') id: string,
    @Body() dto: ConfirmShipmentDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ShipmentEntity> {
    return this.shipmentsService.confirmExport(id, dto, currentUser);
  }

  /**
   * Xác nhận hoàn tất xuất kho (tương thích endpoint cũ)
   * POST /api/shipments/:id/confirm
   */
  @Post(':id/confirm')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async confirm(
    @Param('id') id: string,
    @Body() dto: ConfirmShipmentDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ShipmentEntity> {
    return this.shipmentsService.confirmExport(id, dto || {}, currentUser);
  }

  /**
   * Tạo phiếu xuất đợt sau (Backorder Shipment) cho phần hàng còn nợ (SN-195)
   * POST /api/shipments/create-backorder/:orderId
   */
  @Post('create-backorder/:orderId')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async createBackorder(
    @Param('orderId') orderId: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ShipmentEntity> {
    return this.shipmentsService.createBackorderShipment(orderId, currentUser);
  }

  /**
   * Hủy / xóa phiếu xuất kho (Chặn nếu đã xác nhận xuất kho)
   * DELETE /api/shipments/:id
   */
  @Delete(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.shipmentsService.remove(id);
  }
}
