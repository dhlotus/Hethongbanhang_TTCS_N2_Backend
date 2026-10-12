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

/**
 * Controller Trả hàng & Điều chỉnh (Module 8)
 * Matrix: Customer W*, Sales Rep W*, Warehouse W, WH Manager F, Accountant W, Sales Manager F, Admin F
 */
@Controller('returns')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReturnsController {
  constructor(private readonly returnsService: ReturnsService) {}

  /**
   * Danh sách yêu cầu trả hàng
   * GET /api/returns
   * Matrix: Customer W*, Sales Rep W*, Warehouse W, WH Manager F, Accountant W, Sales Manager F, Admin F
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
    @Query() query: Record<string, string>,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ReturnRequestItem[]> {
    return this.returnsService.findAll(query, currentUser);
  }

  /**
   * Chi tiết yêu cầu trả hàng
   * GET /api/returns/:id
   * Matrix: Customer W*, Sales Rep W*, Warehouse W, WH Manager F, Accountant W, Sales Manager F, Admin F
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
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ReturnRequestItem> {
    return this.returnsService.findById(id, currentUser);
  }

  /**
   * Tạo yêu cầu trả hàng
   * POST /api/returns
   * Matrix: Customer W*, Sales Rep W*, Sales Manager F, Admin F
   */
  @Post()
  @Roles(
    UserRole.CUSTOMER,
    UserRole.SALES_REP,
    UserRole.SALES_MANAGER,
    UserRole.ADMIN,
  )
  async create(
    @Body() dto: Partial<ReturnRequestItem>,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ReturnRequestItem> {
    return this.returnsService.create(dto, currentUser);
  }

  /**
   * Duyệt yêu cầu trả hàng
   * POST /api/returns/:id/approve
   * Matrix: Sales Manager F, WH Manager F, Admin F
   */
  @Post(':id/approve')
  @Roles(
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  async approve(
    @Param('id') id: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<ReturnRequestItem> {
    return this.returnsService.approve(id, currentUser);
  }

  /**
   * Kho nhận hàng hoàn nhập kho
   * POST /api/returns/:id/receive
   * Matrix: Warehouse W, WH Manager F, Admin F
   */
  @Post(':id/receive')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async receiveStock(
    @Param('id') id: string,
    @Body('note') note?: string,
  ): Promise<ReturnRequestItem> {
    return this.returnsService.receiveStock(id, note);
  }

  /**
   * Kế toán lập phiếu điều chỉnh công nợ / hoàn tiền
   * POST /api/returns/:id/adjustment
   * Matrix: Accountant W, Sales Manager F, Admin F
   */
  @Post(':id/adjustment')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
  )
  async adjustDebt(
    @Param('id') id: string,
    @Body('refundAmount') refundAmount?: number,
    @Body('note') note?: string,
  ): Promise<ReturnRequestItem> {
    return this.returnsService.adjustDebt(id, refundAmount, note);
  }

  /**
   * Hủy / xóa yêu cầu trả hàng
   * DELETE /api/returns/:id
   * Matrix: Sales Manager F, Admin F
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async remove(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.returnsService.remove(id);
  }
}
