import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { DeliveryTripsService, IGoodsInTransitStats } from './delivery-trips.service';
import {
  CreateDeliveryTripDto,
  QueryDeliveryTripsDto,
  TripCheckinReturnDto,
  UpdateStopStatusDto,
} from './dto';
import { DeliveryTripEntity } from './entities/delivery-trip.entity';

/**
 * Controller quản lý Chuyến đi Giao hàng & Theo dõi Hàng trên đường (SN-194 / SN-197)
 */
@Controller('delivery-trips')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveryTripsController {
  constructor(private readonly deliveryTripsService: DeliveryTripsService) {}

  /**
   * Thống kê tiền hàng đang nằm trên đường & cảnh báo điều hành kho
   * GET /api/delivery-trips/stats/goods-in-transit
   */
  @Get('stats/goods-in-transit')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
  )
  getGoodsInTransitStats(
    @Query('warehouseId') warehouseId?: string,
  ): Promise<IGoodsInTransitStats> {
    return this.deliveryTripsService.getGoodsInTransitStats(warehouseId);
  }

  /**
   * Lấy danh sách chuyến đi giao hàng (lọc theo kho, trạng thái, quá hạn)
   * GET /api/delivery-trips
   */
  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
  )
  getTrips(@Query() query: QueryDeliveryTripsDto): Promise<DeliveryTripEntity[]> {
    return this.deliveryTripsService.getTrips(query);
  }

  /**
   * Lấy chi tiết một chuyến đi kèm danh sách điểm giao
   * GET /api/delivery-trips/:id
   */
  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
  )
  getTripById(@Param('id') id: string): Promise<DeliveryTripEntity> {
    return this.deliveryTripsService.getTripById(id);
  }

  /**
   * Tạo chuyến đi giao hàng mới
   * POST /api/delivery-trips
   */
  @Post()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  createTrip(
    @Body() dto: CreateDeliveryTripDto,
    @Req() req: { user: ICurrentUser },
  ): Promise<DeliveryTripEntity> {
    return this.deliveryTripsService.createTrip(dto, req.user);
  }

  /**
   * Bắt đầu chuyến đi giao hàng (DRAFT -> IN_TRANSIT)
   * PATCH /api/delivery-trips/:id/start
   */
  @Patch(':id/start')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  startTrip(
    @Param('id') id: string,
    @Req() req: { user: ICurrentUser },
  ): Promise<DeliveryTripEntity> {
    return this.deliveryTripsService.startTrip(id, req.user);
  }

  /**
   * Cập nhật kết quả giao hàng tại một điểm dừng (Giao thành công / Giao thất bại kèm lý do)
   * PATCH /api/delivery-trips/:id/stops/:stopId
   */
  @Patch(':id/stops/:stopId')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  updateStopStatus(
    @Param('id') id: string,
    @Param('stopId') stopId: string,
    @Body() dto: UpdateStopStatusDto,
    @Req() req: { user: ICurrentUser },
  ): Promise<DeliveryTripEntity> {
    return this.deliveryTripsService.updateStopStatus(id, stopId, dto, req.user);
  }

  /**
   * Quản lý kho xác nhận xe về kho & kiểm đếm đối soát hàng trả về nhập lại kho
   * POST /api/delivery-trips/:id/return-checkin
   */
  @Post(':id/return-checkin')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
  )
  checkinTripReturn(
    @Param('id') id: string,
    @Body() dto: TripCheckinReturnDto,
    @Req() req: { user: ICurrentUser },
  ): Promise<DeliveryTripEntity> {
    return this.deliveryTripsService.checkinTripReturn(id, dto, req.user);
  }
}
