import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService, PaginatedPaymentsResult } from './payments.service';
import { Payment } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryPaymentsDto } from './dto/query-payments.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/**
 * Controller Ghi nhận thanh toán và Đối trừ công nợ (Module 7 - SN-202)
 */
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * Danh sách các khoản thanh toán & đối trừ công nợ
   * GET /api/payments
   */
  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
    UserRole.SALES_REP,
    UserRole.CUSTOMER,
  )
  async findAll(
    @Query() query: QueryPaymentsDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<PaginatedPaymentsResult> {
    return this.paymentsService.findAll(query, currentUser);
  }

  /**
   * Chi tiết khoản thanh toán kèm phân bổ đối trừ từng hóa đơn
   * GET /api/payments/:id
   */
  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
    UserRole.CUSTOMER,
  )
  async findById(@Param('id') id: string): Promise<Payment> {
    return this.paymentsService.findById(id);
  }

  /**
   * Ghi nhận thanh toán và đối trừ vào công nợ (SN-202)
   * POST /api/payments
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
  )
  async create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ) {
    return this.paymentsService.createPayment(dto, currentUser);
  }

  /**
   * RÀNG BUỘC AC 5 (SN-202): Chặn tuyệt đối hành vi xóa phiếu thanh toán đã ghi nhận
   * DELETE /api/payments/:id
   */
  @Delete(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
  )
  async remove(): Promise<never> {
    return this.paymentsService.deletePayment();
  }
}
