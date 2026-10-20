import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { QueryMultidimensionalSalesReportDto } from './dto/query-sales-report.dto';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /**
   * Báo cáo Doanh số Nhiều chiều (SN-218)
   * Nhóm theo: sales_rep, region, customer, category, product
   * So sánh cùng kỳ trước, tính biên LN gộp (chỉ Quản lý)
   * GET /api/reports/sales/multidimensional
   */
  @Get('sales/multidimensional')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async getMultidimensionalSalesReport(
    @Query() query: QueryMultidimensionalSalesReportDto,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.reportsService.getMultidimensionalSalesReport(query, currentUser);
  }

  /**
   * Xuất Báo cáo Doanh số ra Excel (.xlsx) chuẩn nghiệp vụ (SN-218)
   * GET /api/reports/sales/export-excel
   */
  @Get('sales/export-excel')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async exportMultidimensionalSalesExcel(
    @Query() query: QueryMultidimensionalSalesReportDto,
    @CurrentUser() currentUser: ICurrentUser,
    @Res() res: Response,
  ) {
    const buffer = await this.reportsService.exportMultidimensionalSalesExcel(query, currentUser);
    const fileName = `Bao_cao_doanh_so_${query.groupBy || 'sales_rep'}_${new Date().toISOString().split('T')[0]}.xlsx`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  /**
   * Báo cáo kho hàng & vận hành
   * GET /api/reports/inventory
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
   * Báo cáo doanh số bán hàng tổng quan
   * GET /api/reports/sales
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
