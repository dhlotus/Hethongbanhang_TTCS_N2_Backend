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
import { ReturnsService, ReturnRequestItem } from './returns.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { CreateReturnReceiptDto } from './dto/create-return-receipt.dto';
import { ApproveReturnReceiptDto, ReturnApprovalAction } from './dto/approve-return-receipt.dto';
import { ReturnReceiptEntity } from './entities/return-receipt.entity';

/**
 * Controller Quản lý Phiếu trả hàng từ đại lý & nhập lại kho (TASK SN-210)
 * Hỗ trợ các route /api/return-receipts (chuẩn tài liệu) và /api/returns (tương thích)
 */
@Controller(['return-receipts', 'returns'])
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  /**
   * Lấy danh sách hóa đơn khả dụng để lập phiếu trả hàng
   * GET /api/return-receipts/eligible-invoices
   */
  @Get('eligible-invoices')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
  )
  async getEligibleInvoices(
    @Query('agencyId') agencyId: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<any[]> {
    return this.returnsService.getEligibleInvoices(agencyId, currentUser);
  }

  /**
   * Lấy chi tiết dòng sản phẩm và số lượng tối đa còn được trả của hóa đơn
   * GET /api/return-receipts/invoice-lines/:invoiceId
   */
  @Get('invoice-lines/:invoiceId')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.ACCOUNTANT,
    UserRole.ADMIN,
  )
  async getInvoiceLines(
    @Param('invoiceId') invoiceId: string,
  ): Promise<any> {
    return this.returnsService.getOriginalInvoiceDetails(invoiceId);
  }

  /**
   * Danh sách phiếu trả hàng
   * GET /api/return-receipts
   */
  @Get()
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.WAREHOUSE,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async findAll(
    @Query() query: { status?: string; search?: string; agencyId?: string },
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ReturnReceiptEntity[]> {
    return this.returnsService.findAllReturnReceipts(query, currentUser);
  }

  /**
   * Chi tiết phiếu trả hàng
   * GET /api/return-receipts/:id
   */
  @Get(':id')
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.WAREHOUSE,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async findById(
    @Param('id') id: string,
  ): Promise<ReturnReceiptEntity> {
    const item = await this.returnsService.findReturnReceiptById(id);
    if (!item) {
      throw new Error(`Không tìm thấy phiếu trả hàng ${id}`);
    }
    return item;
  }

  /**
   * API 1: Tạo mới phiếu trả hàng (Dành cho Nhân viên kinh doanh / Đại lý)
   * POST /api/return-receipts
   */
  @Post()
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async create(
    @Body() dto: CreateReturnReceiptDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ReturnReceiptEntity> {
    return this.returnsService.createReturnReceipt(dto, currentUser);
  }

  /**
   * API 2: Quản lý kho xác nhận nhận hàng
   * PATCH /api/return-receipts/:id/approve
   */
  @Patch(':id/approve')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async approvePatch(
    @Param('id') id: string,
    @Body() dto: ApproveReturnReceiptDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ReturnReceiptEntity> {
    return this.returnsService.approveReturnReceipt(id, dto, currentUser);
  }

  /**
   * Tương thích POST /api/return-receipts/:id/approve
   */
  @Post(':id/approve')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async approvePost(
    @Param('id') id: string,
    @Body() dto: ApproveReturnReceiptDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ReturnReceiptEntity> {
    const actionDto: ApproveReturnReceiptDto = dto?.action
      ? dto
      : { action: ReturnApprovalAction.APPROVE, note: (dto as any)?.note };
    return this.returnsService.approveReturnReceipt(id, actionDto, currentUser);
  }

  /**
   * Xóa phiếu trả hàng
   * DELETE /api/return-receipts/:id
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.returnsService.remove(id);
  }
}
