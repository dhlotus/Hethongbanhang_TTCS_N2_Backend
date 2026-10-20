import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SalesTargetsService } from './sales-targets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import {
  CreateSalesTargetDto,
  QuerySalesTargetDto,
  UpdateSalesTargetDto,
} from './dto/sales-target.dto';

@Controller('sales-targets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalesTargetsController {
  constructor(private readonly salesTargetsService: SalesTargetsService) {}

  /**
   * Danh sách chỉ tiêu và tiến độ thực tế (SN-215)
   * Phân quyền:
   * - Quản lý / Admin: Xem toàn bộ nhân viên & khu vực
   * - Nhân viên kinh doanh (SALES_REP): Tự động chỉ xem tiến độ của chính mình
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP)
  async findAll(
    @Query() query: QuerySalesTargetDto,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.salesTargetsService.findAll(query, currentUser);
  }

  /**
   * Tiến độ chỉ tiêu cá nhân của nhân viên đang đăng nhập
   * Endpoint tối ưu cho ứng dụng di động / màn hình nhỏ
   */
  @Get('my-progress')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP)
  async getMyProgress(
    @Query('period') period: string | undefined,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.salesTargetsService.getMyProgress(period, currentUser);
  }

  /**
   * Lấy lịch sử nhật ký điều chỉnh của một chỉ tiêu
   */
  @Get(':id/logs')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async getAdjustmentLogs(
    @Param('id') id: string,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.salesTargetsService.getAdjustmentLogs(id, currentUser);
  }

  /**
   * Đặt chỉ tiêu mới theo tháng (Chỉ Quản lý kinh doanh & Admin)
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async create(
    @Body() dto: CreateSalesTargetDto,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.salesTargetsService.create(dto, currentUser);
  }

  /**
   * Cập nhật chỉ tiêu (Kỳ đã khóa bắt buộc nhập lý do và ghi nhật ký)
   */
  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSalesTargetDto,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.salesTargetsService.update(id, dto, currentUser);
  }
}
