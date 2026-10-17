import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { DebtReportService } from './debt-report.service';
import { QueryDebtReportDto } from './dto/query-debt-report.dto';
import { DebtReportResponseDto } from './dto/debt-report-response.dto';
import { AgencyInvoiceDto } from './dto/agency-invoice.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';

/**
 * Controller Quản lý Sổ công nợ và Phân tích tuổi nợ đại lý (SN-203)
 * Endpoint: /api/debt-report
 */
@Controller('debt-report')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(new HttpExceptionFilter())
export class DebtReportController {
  constructor(private readonly debtReportService: DebtReportService) {}

  /**
   * Lấy danh sách sổ công nợ theo đại lý kèm phân tích tuổi nợ & dòng tổng cộng
   * GET /api/debt-report
   */
  @Get()
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async getAgentDebtReport(
    @Query() query: QueryDebtReportDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<DebtReportResponseDto> {
    return this.debtReportService.getAgentDebtReport(query, currentUser);
  }

  /**
   * Xuất danh sách sổ công nợ & tuổi nợ ra file Excel (.xlsx)
   * GET /api/debt-report/export
   */
  @Get('export')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async exportDebtToExcel(
    @Query() query: QueryDebtReportDto,
    @CurrentUser() currentUser: ICurrentUser,
    @Res() res: Response,
  ): Promise<void> {
    const fileBuffer = await this.debtReportService.exportDebtToExcel(query, currentUser);
    const fileName = `So_Cong_No_Va_Tuoi_No_${Date.now()}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(fileBuffer);
  }

  /**
   * Lấy danh sách hóa đơn thực tế phát sinh của một đại lý (phân nhóm tuổi nợ chi tiết)
   * GET /api/debt-report/:agencyId/invoices
   */
  @Get(':agencyId/invoices')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async getAgencyInvoices(
    @Param('agencyId') agencyId: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<AgencyInvoiceDto[]> {
    return this.debtReportService.getAgencyInvoices(agencyId, currentUser);
  }
}
