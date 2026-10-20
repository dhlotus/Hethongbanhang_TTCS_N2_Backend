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
import { QueryDebtLedgerDto } from './dto/query-debt-ledger.dto';
import { DebtLedgerStatement } from './entities/debt-ledger.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';

/**
 * Controller Quản lý Sổ công nợ, Tuổi nợ (SN-230) & Sổ chi tiết công nợ đại lý (SN-231)
 * Endpoint: /api/debt-report
 */
@Controller('debt-report')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(new HttpExceptionFilter())
export class DebtReportController {
  constructor(private readonly debtReportService: DebtReportService) {}

  /**
   * SN-230: Lấy danh sách sổ công nợ theo tuổi nợ, ngày chốt báo cáo & nhân viên phụ trách
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
   * SN-230: Xuất danh sách báo cáo tuổi nợ ra file Excel (.xlsx) đúng điều kiện lọc
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
    const asOfStr = query.asOfDate ? `_${query.asOfDate}` : '';
    const fileName = `Bao_Cao_Tuoi_No_Cong_No${asOfStr}_${Date.now()}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(fileBuffer);
  }

  /**
   * SN-230: Xuất danh sách báo cáo tuổi nợ ra file PDF (.pdf) đúng điều kiện lọc
   * GET /api/debt-report/export-pdf
   */
  @Get('export-pdf')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async exportDebtToPdf(
    @Query() query: QueryDebtReportDto,
    @CurrentUser() currentUser: ICurrentUser,
    @Res() res: Response,
  ): Promise<void> {
    const fileBuffer = await this.debtReportService.exportDebtToPdf(query, currentUser);
    const asOfStr = query.asOfDate ? `_${query.asOfDate}` : '';
    const fileName = `Bao_Cao_Tuoi_No_Cong_No${asOfStr}_${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(fileBuffer);
  }

  /**
   * SN-230: Xuất danh sách báo cáo tuổi nợ ra file Word (.docx) đúng điều kiện lọc
   * GET /api/debt-report/export-word
   */
  @Get('export-word')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async exportDebtToWord(
    @Query() query: QueryDebtReportDto,
    @CurrentUser() currentUser: ICurrentUser,
    @Res() res: Response,
  ): Promise<void> {
    const fileBuffer = await this.debtReportService.exportDebtToWord(query, currentUser);
    const asOfStr = query.asOfDate ? `_${query.asOfDate}` : '';
    const fileName = `Bao_Cao_Tuoi_No_Cong_No${asOfStr}_${Date.now()}.docx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(fileBuffer);
  }

  /**
   * Danh sách nhân viên kinh doanh phụ trách để đổ vào dropdown bộ lọc
   * GET /api/debt-report/sales-reps
   */
  @Get('sales-reps')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async getSalesReps(@CurrentUser() currentUser: ICurrentUser) {
    return this.debtReportService.getSalesReps(currentUser);
  }

  /**
   * Danh sách đại lý phục vụ tìm kiếm & chọn lựa trong combobox
   * GET /api/debt-report/agencies
   */
  @Get('agencies')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
    UserRole.CUSTOMER,
  )
  async getAgencies(@CurrentUser() currentUser: ICurrentUser) {
    return this.debtReportService.getAgencies(currentUser);
  }

  /**
   * SN-231: Lấy dữ liệu Sổ chi tiết công nợ của 1 đại lý theo khoảng thời gian đối chiếu
   * GET /api/debt-report/ledger
   */
  @Get('ledger')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
    UserRole.CUSTOMER,
  )
  async getDebtLedger(
    @Query() query: QueryDebtLedgerDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<DebtLedgerStatement> {
    return this.debtReportService.getDebtLedger(query, currentUser);
  }

  /**
   * SN-231: Xuất file Excel (.xlsx) Sổ chi tiết công nợ đại lý gửi đối chiếu
   * GET /api/debt-report/ledger/export-excel
   */
  @Get('ledger/export-excel')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
    UserRole.CUSTOMER,
  )
  async exportLedgerToExcel(
    @Query() query: QueryDebtLedgerDto,
    @CurrentUser() currentUser: ICurrentUser,
    @Res() res: Response,
  ): Promise<void> {
    const fileBuffer = await this.debtReportService.exportLedgerToExcel(query, currentUser);
    const fileName = `So_Chi_Tiet_Cong_No_${query.agencyId}_${Date.now()}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(fileBuffer);
  }

  /**
   * SN-231: Xuất file PDF (.pdf) Sổ chi tiết công nợ đại lý gửi đối chiếu
   * GET /api/debt-report/ledger/export-pdf
   */
  @Get('ledger/export-pdf')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
    UserRole.CUSTOMER,
  )
  async exportLedgerToPdf(
    @Query() query: QueryDebtLedgerDto,
    @CurrentUser() currentUser: ICurrentUser,
    @Res() res: Response,
  ): Promise<void> {
    const fileBuffer = await this.debtReportService.exportLedgerToPdf(query, currentUser);
    const fileName = `So_Chi_Tiet_Cong_No_${query.agencyId}_${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(fileBuffer);
  }

  /**
   * SN-231: Xuất file Word (.docx) Sổ chi tiết công nợ đại lý gửi đối chiếu
   * GET /api/debt-report/ledger/export-word
   */
  @Get('ledger/export-word')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
    UserRole.CUSTOMER,
  )
  async exportLedgerToWord(
    @Query() query: QueryDebtLedgerDto,
    @CurrentUser() currentUser: ICurrentUser,
    @Res() res: Response,
  ): Promise<void> {
    const fileBuffer = await this.debtReportService.exportLedgerToWord(query, currentUser);
    const fileName = `So_Chi_Tiet_Cong_No_${query.agencyId}_${Date.now()}.docx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.end(fileBuffer);
  }

  /**
   * Lấy danh sách hóa đơn thực tế phát sinh của một đại lý
   * GET /api/debt-report/:agencyId/invoices
   */
  @Get(':agencyId/invoices')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
    UserRole.CUSTOMER,
  )
  async getAgencyInvoices(
    @Param('agencyId') agencyId: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<AgencyInvoiceDto[]> {
    return this.debtReportService.getAgencyInvoices(agencyId, currentUser);
  }
}
