import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ReceiptsService, PaginatedReceiptsResult } from './receipts.service';
import { Receipt } from './entities/receipt.entity';
import { ReceiptPrintDto } from './dto/receipt-print.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Phiếu thu tiền (Subtask: SN-209 - Parent Story: SN-201 / Sprint 7)
 * Cung cấp API truy vấn dữ liệu in ấn và tải file PDF phiếu thu
 */
@Controller('receipts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  /**
   * Danh sách phiếu thu tiền (Hỗ trợ phân trang, tìm kiếm và lọc hình thức chuẩn Backend)
   * GET /api/receipts
   */
  @Get()
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
  )
  async findAll(
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<Receipt[] | PaginatedReceiptsResult> {
    return this.receiptsService.findAll(
      { search, customerId, paymentMethod, page, limit },
      currentUser,
    );
  }

  /**
   * Chi tiết phiếu thu tiền
   * GET /api/receipts/:id
   */
  @Get(':id')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
  )
  async findById(@Param('id') id: string): Promise<Receipt> {
    return this.receiptsService.findById(id);
  }

  /**
   * Dữ liệu in ấn phiếu thu tiền chuẩn hóa (SN-209)
   * GET /api/receipts/:id/print
   * Đảm bảo chứa đầy đủ 5 trường: Mã, Đại lý, Số tiền, Hình thức, Người thu
   */
  @Get(':id/print')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
  )
  async getPrintData(@Param('id') id: string): Promise<ReceiptPrintDto> {
    return this.receiptsService.getPrintData(id);
  }

  /**
   * Tải trực tiếp file PDF phiếu thu tiền (SN-209)
   * GET /api/receipts/:id/pdf
   */
  @Get(':id/pdf')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
  )
  async downloadPdf(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.receiptsService.generatePdfBuffer(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });

    res.end(buffer);
  }
}
