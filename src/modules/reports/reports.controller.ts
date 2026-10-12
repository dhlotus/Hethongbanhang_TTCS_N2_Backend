import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Báo cáo & Dashboard (Module 9)
 * Matrix: Customer —, Sales Rep R*, Warehouse —, WH Manager R, Accountant R, Sales Manager F, Admin F
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * Báo cáo kho hàng & vận hành
   * GET /api/reports/inventory
   * Matrix: WH Manager R, Sales Manager F, Admin F
   */
  @Get('inventory')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  async getInventoryReport(
    @Query() query: Record<string, string>,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.reportsService.getInventoryReport(query, currentUser);
  }

  /**
   * Báo cáo doanh số bán hàng
   * GET /api/reports/sales
   * Matrix: Sales Rep R*, Sales Manager F, Admin F
   */
  @Get('sales')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async getSalesReport(
    @Query() query: Record<string, string>,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.reportsService.getSalesReport(query, currentUser);
  }

  /**
   * Báo cáo tài chính & công nợ
   * GET /api/reports/finance
   * Matrix: Accountant R, Sales Manager F, Admin F
   */
  @Get('finance')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
  )
  async getFinanceReport(
    @Query() query: Record<string, string>,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.reportsService.getFinanceReport(query, currentUser);
  }
}
