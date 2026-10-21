import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  DebtReconciliationService,
  PaginatedReconciliationsResult,
  DebtReconciliationSummary,
} from './debt-reconciliation.service';
import {
  CreateDebtReconciliationDto,
  QueryDebtReconciliationDto,
  RespondDebtReconciliationDto,
} from './dto';
import { DebtReconciliationReportEntity } from './entities/debt-reconciliation-report.entity';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Lập biên bản đối chiếu công nợ định kỳ (SN-206)
 */
@Controller('debt-reconciliations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DebtReconciliationController {
  constructor(
    private readonly debtReconciliationService: DebtReconciliationService,
  ) {}

  /**
   * Danh sách biên bản đối chiếu công nợ (hỗ trợ phân trang, tìm kiếm, lọc kỳ/trạng thái)
   * GET /api/debt-reconciliations
   */
  @Get()
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.CUSTOMER,
  )
  async findAll(
    @Query() query: QueryDebtReconciliationDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<PaginatedReconciliationsResult> {
    return this.debtReconciliationService.findAll(query, currentUser);
  }

  /**
   * Thống kê KPI tổng hợp biên bản
   * GET /api/debt-reconciliations/summary
   */
  @Get('summary')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.CUSTOMER,
  )
  async getSummary(
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<DebtReconciliationSummary> {
    return this.debtReconciliationService.getSummary(currentUser);
  }

  /**
   * Tính toán bóc tách trước số liệu biên bản cho đại lý & kỳ đối chiếu
   * GET /api/debt-reconciliations/calculate?agency_id=...&period=...
   */
  @Get('calculate')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
  )
  async calculatePreview(
    @Query('agency_id') agencyId: string,
    @Query('period') period: string,
  ) {
    return this.debtReconciliationService.calculatePreview(agencyId, period);
  }

  /**
   * Đồng bộ dư nợ hiện tại theo số dư cuối kỳ thực tế cho tất cả đại lý
   * POST /api/debt-reconciliations/sync-debts
   */
  @Post('sync-debts')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
  )
  async syncAllDebts(@Query('period') period?: string) {
    return this.debtReconciliationService.syncAllCustomersDebt(period || '2026-10');
  }

  /**
   * Tạo biên bản đối chiếu mới
   * POST /api/debt-reconciliations
   */
  @Post()
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
  )
  async create(
    @Body() dto: CreateDebtReconciliationDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<DebtReconciliationReportEntity> {
    return this.debtReconciliationService.create(dto, currentUser);
  }

  /**
   * Lấy chi tiết biên bản đối chiếu công nợ
   * GET /api/debt-reconciliations/:id
   */
  @Get(':id')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.CUSTOMER,
  )
  async findById(@Param('id') id: string): Promise<DebtReconciliationReportEntity> {
    return this.debtReconciliationService.findById(id);
  }

  /**
   * Xuất và tải file PDF biên bản đối chiếu công nợ
   * GET /api/debt-reconciliations/:id/pdf
   */
  @Get(':id/pdf')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.CUSTOMER,
  )
  async getPdf(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.debtReconciliationService.generatePdf(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  }

  /**
   * Đại lý xác nhận hoặc phản hồi lệch biên bản từ cổng Portal
   * PATCH /api/debt-reconciliations/:id/response
   */
  @Patch(':id/response')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
  )
  async respond(
    @Param('id') id: string,
    @Body() dto: RespondDebtReconciliationDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<DebtReconciliationReportEntity> {
    return this.debtReconciliationService.respond(id, dto, currentUser);
  }

  /**
   * Xóa biên bản đối chiếu (chỉ cho phép xóa khi PENDING)
   * DELETE /api/debt-reconciliations/:id
   */
  @Delete(':id')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
  )
  async delete(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.debtReconciliationService.delete(id);
  }
}
