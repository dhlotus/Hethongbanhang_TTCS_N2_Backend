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
import { ShipmentsService, ShipmentItem } from './shipments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Phiếu xuất & Giao hàng (Module 6)
 * Matrix: Customer R*, Sales Rep R*, Warehouse W, WH Manager F, Accountant R, Sales Manager R, Admin F
 */
@Controller('shipments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  /**
   * Danh sách phiếu xuất kho / giao hàng
   * GET /api/shipments
   * Matrix: Customer R*, Sales Rep R*, Warehouse W, WH Manager F, Accountant R, Sales Manager R, Admin F
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
    @Query() query: Record<string, string>,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ShipmentItem[]> {
    return this.shipmentsService.findAll(query, currentUser);
  }

  /**
   * Chi tiết phiếu xuất kho
   * GET /api/shipments/:id
   * Matrix: Customer R*, Sales Rep R*, Warehouse W, WH Manager F, Accountant R, Sales Manager R, Admin F
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
  ): Promise<ShipmentItem> {
    return this.shipmentsService.findById(id, currentUser);
  }

  /**
   * Tạo phiếu xuất kho & giao hàng
   * POST /api/shipments
   * Matrix: Warehouse W, WH Manager F, Admin F
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
    @Body() dto: Partial<ShipmentItem>,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ShipmentItem> {
    return this.shipmentsService.create(dto, currentUser);
  }

  /**
   * Cập nhật trạng thái giao hàng / mã vận đơn / POD
   * PATCH /api/shipments/:id/status
   * Matrix: Warehouse W, WH Manager F, Admin F
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
    @Body('status') status: ShipmentItem['status'],
    @Body() dto: Partial<ShipmentItem>,
  ): Promise<ShipmentItem> {
    return this.shipmentsService.updateStatus(id, status, dto);
  }

  /**
   * Xác nhận hoàn tất xuất kho / giao hàng
   * POST /api/shipments/:id/confirm
   * Matrix: WH Manager F, Admin F
   */
  @Post(':id/confirm')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER)
  async confirm(@Param('id') id: string): Promise<ShipmentItem> {
    return this.shipmentsService.confirm(id);
  }

  /**
   * Hủy / xóa phiếu xuất kho
   * DELETE /api/shipments/:id
   * Matrix: WH Manager F, Admin F
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER)
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.shipmentsService.remove(id);
  }
}
