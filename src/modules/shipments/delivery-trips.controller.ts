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
 * Controller Quản lý Chuyến đi Giao hàng, Phân tuyến & Hàng trên đường (SN-194 / SN-197)
 * Cung cấp route /api/delivery-trips trực tiếp cho WMS
 */
@Controller('delivery-trips')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveryTripsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Get('stats/goods-in-transit')
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
  async getGoodsInTransitStats(@Query('warehouseId') warehouseId?: string) {
    return this.shipmentsService.getGoodsInTransitStats(warehouseId);
  }

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
    @Query('routeArea') routeArea?: string,
    @Query('status') status?: DeliveryTripStatus,
    @Query('search') search?: string,
  ): Promise<DeliveryTripEntity[]> {
    return this.shipmentsService.findAllTrips({ routeArea, status, search });
  }

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
  async findById(@Param('id') id: string): Promise<DeliveryTripEntity> {
    return this.shipmentsService.findTripById(id);
  }

  @Post()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async create(
    @Body() dto: any,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<DeliveryTripEntity> {
    return this.shipmentsService.createTrip(dto, currentUser);
  }

  @Patch(':id/start')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async start(@Param('id') id: string): Promise<DeliveryTripEntity> {
    return this.shipmentsService.dispatchTrip(id);
  }

  @Patch(':tripId/stops/:stopId')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async updateStop(
    @Param('tripId') tripId: string,
    @Param('stopId') stopId: string,
    @Body() payload: { status: 'DELIVERED' | 'FAILED'; failureReason?: string },
  ) {
    return this.shipmentsService.updateStopStatus(tripId, stopId, payload);
  }

  @Post(':id/return-checkin')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async checkinReturn(
    @Param('id') id: string,
    @Body() payload: any,
  ) {
    return this.shipmentsService.checkinTripReturn(id, payload);
  }

  @Patch(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryTripDto,
  ): Promise<DeliveryTripEntity> {
    return this.shipmentsService.updateTrip(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER)
  async delete(@Param('id') id: string) {
    return this.shipmentsService.deleteTrip(id);
  }
}
