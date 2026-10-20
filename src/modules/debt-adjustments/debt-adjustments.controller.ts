import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DebtAdjustmentsService } from './debt-adjustments.service';
import { CreateDebtAdjustmentDto, QueryDebtAdjustmentsDto } from './dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Chứng từ điều chỉnh giảm trừ công nợ khi trả hàng (TASK SN-212)
 * Hỗ trợ các route /api/debt-adjustments và /api/v1/debt-adjustments
 */
@Controller(['debt-adjustments', 'v1/debt-adjustments'])
@UseGuards(JwtAuthGuard, RolesGuard)
export class DebtAdjustmentsController {
  constructor(private readonly debtAdjustmentsService: DebtAdjustmentsService) {}

  /**
   * Lập chứng từ điều chỉnh giảm trừ công nợ
   * POST /api/debt-adjustments hoặc POST /api/v1/debt-adjustments
   */
  @Post()
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  async create(
    @Body() dto: CreateDebtAdjustmentDto,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    return this.debtAdjustmentsService.create(dto, currentUser);
  }

  /**
   * Lấy danh sách các phiếu trả hàng đã duyệt (APPROVED) chưa lập chứng từ
   * GET /api/debt-adjustments/pending-returns hoặc GET /api/v1/debt-adjustments/pending-returns
   */
  @Get('pending-returns')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
  )
  async getPendingReturns() {
    return this.debtAdjustmentsService.getPendingReturns();
  }

  /**
   * Lấy danh sách chứng từ điều chỉnh giảm trừ công nợ có phân trang và lọc
   * GET /api/debt-adjustments hoặc GET /api/v1/debt-adjustments
   */
  @Get()
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async findAll(@Query() query: QueryDebtAdjustmentsDto) {
    return this.debtAdjustmentsService.findAll(query);
  }

  /**
   * Xem chi tiết chứng từ điều chỉnh giảm trừ công nợ & bút toán hạch toán
   * GET /api/debt-adjustments/:id hoặc GET /api/v1/debt-adjustments/:id
   */
  @Get(':id')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.SALES_REP,
  )
  async findOne(@Param('id') id: string) {
    return this.debtAdjustmentsService.findOne(id);
  }
}
