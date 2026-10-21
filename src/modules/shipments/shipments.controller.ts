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
import { ShipmentEntity } from './entities/shipment.entity';
import { ConfirmShipmentDto } from './dto/confirm-shipment.dto';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { QueryShipmentsDto } from './dto/query-shipments.dto';
import { ConfirmDeliveryDto, ReportFailedDeliveryDto } from './dto/delivery.dto';
import {
  CreateDeliveryTripDto,
  UpdateDeliveryTripDto,
  AssignDriverDto,
} from './dto/delivery-trip.dto';
import { DeliveryTripEntity, DeliveryTripStatus } from './entities/delivery-trip.entity';
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
  ): Promise<any> {
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
  async getBackorders(@CurrentUser() currentUser: ICurrentUser): Promise<any[]> {
    return this.shipmentsService.getBackorders(currentUser);
  }

  // =========================================================================
  // SN-196: ENDPOINTS CHUYẾN GIAO HÀNG & PHÂN TUYẾN (TRIPS)
  // =========================================================================

  /**
   * Danh sách chuyến giao hàng (SN-196 AC 1)
   * GET /api/shipments/trips
   */
  @Get('trips')
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
  async findAllTrips(
    @Query('routeArea') routeArea?: string,
    @Query('status') status?: DeliveryTripStatus,
    @Query('search') search?: string,
  ): Promise<DeliveryTripEntity[]> {
    return this.shipmentsService.findAllTrips({ routeArea, status, search });
  }

  /**
   * Dữ liệu in ấn danh sách điểm giao của chuyến (SN-196 AC 3)
   * GET /api/shipments/trips/:id/manifest
   */
  @Get('trips/:id/manifest')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
    UserRole.ACCOUNTANT,
  )
  async getTripManifest(@Param('id') id: string) {
    return this.shipmentsService.getTripManifest(id);
  }

  /**
   * Chi tiết chuyến giao hàng
   * GET /api/shipments/trips/:id
   */
  @Get('trips/:id')
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
  async findTripById(@Param('id') id: string): Promise<DeliveryTripEntity> {
    return this.shipmentsService.findTripById(id);
  }

  /**
   * Tạo chuyến giao hàng mới gom nhiều phiếu xuất (SN-196 AC 1 & 2)
   * POST /api/shipments/trips
   */
  @Post('trips')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async createTrip(
    @Body() dto: CreateDeliveryTripDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<DeliveryTripEntity> {
    return this.shipmentsService.createTrip(dto, currentUser);
  }

  /**
   * Cập nhật chuyến giao hàng
   * PATCH /api/shipments/trips/:id
   */
  @Patch('trips/:id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async updateTrip(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryTripDto,
  ): Promise<DeliveryTripEntity> {
    return this.shipmentsService.updateTrip(id, dto);
  }

  /**
   * Gán tài xế và phương tiện cho chuyến (SN-196 AC 2)
   * POST /api/shipments/trips/:id/assign-driver
   */
  @Post('trips/:id/assign-driver')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async assignDriver(
    @Param('id') id: string,
    @Body() dto: AssignDriverDto,
  ): Promise<DeliveryTripEntity> {
    return this.shipmentsService.assignDriver(id, dto);
  }

  /**
   * Xuất phát chuyến giao hàng (Đổi trạng thái sang IN_TRANSIT và chuyển các phiếu sang SHIPPED)
   * POST /api/shipments/trips/:id/dispatch
   */
  @Post('trips/:id/dispatch')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async dispatchTrip(@Param('id') id: string): Promise<DeliveryTripEntity> {
    return this.shipmentsService.dispatchTrip(id);
  }

  /**
   * Hoàn thành chuyến giao hàng
   * POST /api/shipments/trips/:id/complete
   */
  @Post('trips/:id/complete')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async completeTrip(@Param('id') id: string): Promise<DeliveryTripEntity> {
    return this.shipmentsService.completeTrip(id);
  }

  /**
   * Hủy chuyến giao hàng
   * POST /api/shipments/trips/:id/cancel
   */
  @Post('trips/:id/cancel')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  async cancelTrip(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ): Promise<DeliveryTripEntity> {
    return this.shipmentsService.cancelTrip(id, reason);
  }

  /**
   * Xóa chuyến giao hàng
   * DELETE /api/shipments/trips/:id
   */
  @Delete('trips/:id')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER)
  async deleteTrip(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.shipmentsService.deleteTrip(id);
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
  ): Promise<any> {
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
  ): Promise<any> {
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
  ): Promise<any> {
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
  ): Promise<any> {
    return this.shipmentsService.confirmExport(id, dto || {}, currentUser);
  }

  /**
   * Xác nhận giao hàng thành công kèm ảnh chứng từ (SN-198)
   * POST /api/shipments/:id/confirm-delivery
   * Matrix: Warehouse W, WH Manager F, Admin F
   */
  @Post(':id/confirm-delivery')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async confirmDelivery(
    @Param('id') id: string,
    @Body() payload: ConfirmDeliveryDto,
  ): Promise<any> {
    return this.shipmentsService.confirmDelivery(id, payload);
  }

  /**
   * Báo giao hàng không thành công, hàng quay về kho (SN-198)
   * POST /api/shipments/:id/failed-delivery
   * Matrix: Warehouse W, WH Manager F, Admin F
   */
  @Post(':id/failed-delivery')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async reportFailedDelivery(
    @Param('id') id: string,
    @Body() payload: ReportFailedDeliveryDto,
  ): Promise<any> {
    return this.shipmentsService.reportFailedDelivery(id, payload);
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
  ): Promise<any> {
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
