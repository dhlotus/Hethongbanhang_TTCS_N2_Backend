import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvoicesService, InvoiceItem } from './invoices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Hoá đơn & Công nợ (Module 7)
 * Matrix: Customer R*, Sales Rep R*, Warehouse —, WH Manager —, Accountant F, Sales Manager R, Admin F
 */
@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  /**
   * Danh sách hoá đơn bán hàng
   * GET /api/invoices
   * Matrix: Customer R*, Sales Rep R*, Warehouse —, WH Manager —, Accountant F, Sales Manager R, Admin F
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
    return this.invoicesService.findAll(query, currentUser);
  }

  /**
   * Chi tiết hoá đơn
   * GET /api/invoices/:id
   * Matrix: Customer R*, Sales Rep R*, Warehouse —, WH Manager —, Accountant F, Sales Manager R, Admin F
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
   * Phát hành hoá đơn mới
   * POST /api/invoices
   * Matrix: Accountant F, Admin F
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
   * Cập nhật hoá đơn (Ghi nhận thanh toán / điều chỉnh)
   * PATCH /api/invoices/:id
   * Matrix: Accountant F, Admin F
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
   * Matrix: Accountant F, Admin F
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.ACCOUNTANT_DEBT)
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.invoicesService.remove(id);
  }
}
