import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { InvoicesService, InvoiceItem, DealerDebtSummary } from './invoices.service';
import { DebtReminderSchedulerService } from './debt-reminder-scheduler.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Hoá đơn & Sổ Công nợ Đại lý (Module 7 - SN-207 & SN-208)
 */
@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly debtReminderSchedulerService: DebtReminderSchedulerService,
  ) {}

  /**
   * Tổng hợp công nợ và hạn mức còn lại của đại lý (SN-207 C)
   * GET /api/invoices/my-debt-summary
   */
  @Get('my-debt-summary')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async getMyDebtSummary(@CurrentUser() currentUser: ICurrentUser): Promise<DealerDebtSummary> {
    return this.invoicesService.getMyDebtSummary(currentUser);
  }

  /**
   * Kích hoạt thủ công tác vụ kiểm tra và gửi nhắc hạn thanh toán (SN-208 A, B, C, D)
   * POST /api/invoices/reminders/trigger
   */
  @Post('reminders/trigger')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.CUSTOMER,
  )
  async triggerReminders(@Query('force') force?: string, @Body() _body?: Record<string, any>) {
    return this.debtReminderSchedulerService.processDebtReminders({
      forceRetry: force === 'true',
    });
  }

  /**
   * Lấy lịch sử gửi nhắc nợ và cảnh báo quá hạn (SN-208 D)
   * GET /api/invoices/reminders/logs
   */
  @Get('reminders/logs')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.CUSTOMER,
  )
  async getReminderLogs() {
    return this.debtReminderSchedulerService.getReminderLogs();
  }

  /**
   * Lấy thông báo nhắc nợ trong ứng dụng của đại lý (SN-208 A, B)
   * GET /api/invoices/notifications
   */
  @Get('notifications')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async getDebtNotifications(@CurrentUser() currentUser: ICurrentUser) {
    const targetCustId = this.invoicesService.resolveTargetCustomerId(currentUser);
    return this.debtReminderSchedulerService.getInAppNotificationsForCustomer(targetCustId);
  }

  /**
   * Đánh dấu đã đọc thông báo trong ứng dụng
   * PATCH /api/invoices/notifications/:id/read
   */
  @Patch('notifications/:id/read')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async markNotificationRead(@Param('id') id: string) {
    const success = await this.debtReminderSchedulerService.markNotificationAsRead(id);
    return { success, id };
  }

  /**
   * Danh sách hoá đơn bán hàng (SN-207 A)
   * GET /api/invoices
   */
  @Get()
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async findAll(
    @Query() query: Record<string, string>,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<InvoiceItem[]> {
    return this.invoicesService.findAll(query as any, currentUser);
  }

  /**
   * Tải hóa đơn PDF / HTML chuẩn in ấn (SN-207 B)
   * GET /api/invoices/:id/pdf
   */
  @Get(':id/pdf')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async downloadInvoicePdf(
    @Param('id') id: string,
    @Query('format') format: string,
    @CurrentUser() currentUser: ICurrentUser,
    @Res() res: Response,
  ) {
    if (format === 'html') {
      const result = await this.invoicesService.generateInvoicePdfHtml(id, currentUser);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="Hoa_Don_${result.invoice.invoiceCode}.html"`,
      );
      return res.send(result.html);
    }

    const result = await this.invoicesService.generateInvoicePdfBuffer(id, currentUser);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Hoa_Don_${result.invoice.invoiceCode}.pdf"`,
    );
    return res.send(result.buffer);
  }

  /**
   * Chi tiết hoá đơn (SN-207 B)
   * GET /api/invoices/:id
   */
  @Get(':id')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async findById(
    @Param('id') id: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<InvoiceItem> {
    return this.invoicesService.findById(id, currentUser);
  }

  /**
   * Ghi nhận thanh toán hóa đơn công nợ (SN-207 C)
   * POST /api/invoices/:id/payments
   */
  @Post(':id/payments')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
  )
  async recordPayment(
    @Param('id') id: string,
    @Body() dto: { amount: number; paymentMethod?: string; note?: string },
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.invoicesService.recordPayment(id, dto, currentUser);
  }

  /**
   * Phát hành hoá đơn mới
   * POST /api/invoices
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.ACCOUNTANT_DEBT)
  async create(
    @Body() dto: Partial<InvoiceItem>,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<InvoiceItem> {
    return this.invoicesService.create(dto, currentUser);
  }

  /**
   * Cập nhật hoá đơn
   * PATCH /api/invoices/:id
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.ACCOUNTANT_DEBT)
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<InvoiceItem>,
  ): Promise<InvoiceItem> {
    return this.invoicesService.update(id, dto);
  }

  /**
   * Hủy / xóa hoá đơn
   * DELETE /api/invoices/:id
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.ACCOUNTANT_DEBT)
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.invoicesService.remove(id);
  }
}
