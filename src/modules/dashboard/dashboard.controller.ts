import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Báo cáo & Dashboard (Module 9):
 * Matrix: Customer —, Sales Rep R*, Warehouse —, WH Manager R, Accountant R, Sales Manager F, Admin F
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  UserRole.ADMIN,
  UserRole.SALES_MANAGER,
  UserRole.ACCOUNTANT,
  UserRole.ACCOUNTANT_DEBT,
  UserRole.WH_MANAGER,
  UserRole.WAREHOUSE_MANAGER,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.WAREHOUSE,
  UserRole.SALES_REP,
)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  async getOverview(
    @CurrentUser() user: ICurrentUser,
    @Query('timeRange') timeRange?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getOverview(user, timeRange, startDate, endDate);
  }
}
