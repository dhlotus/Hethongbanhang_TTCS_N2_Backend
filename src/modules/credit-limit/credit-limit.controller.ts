import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import {
  CreditLimitService,
  PaginatedCreditLimitResult,
} from './credit-limit.service';
import { QueryCreditLimitDto } from './dto/query-credit-limit.dto';
import { UpdateCreditLimitDto } from './dto/update-credit-limit.dto';
import { UpdateCreditStatusDto } from './dto/update-credit-status.dto';
import { CreditLimitStatsDto } from './dto/credit-limit-stats.dto';
import { AgencyCreditLimit } from './entities/agency-credit-limit.entity';
import { CreditLimitLog } from './entities/credit-limit-log.entity';

/**
 * Controller Quản lý và Khai báo Hạn mức Công nợ Đại lý (SN-34)
 * Áp dụng Guard kiểm tra quyền: Chỉ cho phép role ACCOUNTANT_DEBT và BUSINESS_MANAGER cập nhật
 */
@Controller('credit-limit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreditLimitController {
  constructor(private readonly creditLimitService: CreditLimitService) {}

  /**
   * Thống kê tổng quan hạn mức công nợ toàn hệ thống (SN-34)
   * GET /api/credit-limit/stats
   */
  @Get('stats')
  @Roles(Role.ACCOUNTANT_DEBT, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  async getCreditLimitStats(): Promise<CreditLimitStatsDto> {
    return this.creditLimitService.getCreditLimitStats();
  }

  /**
   * Lấy danh sách hạn mức công nợ của các đại lý (SN-34)
   * GET /api/credit-limit
   */
  @Get()
  @Roles(Role.ACCOUNTANT_DEBT, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  async getCreditLimits(
    @Query() query: QueryCreditLimitDto,
  ): Promise<PaginatedCreditLimitResult> {
    return this.creditLimitService.getCreditLimits(query);
  }

  /**
   * Lấy chi tiết hạn mức công nợ của một đại lý (SN-34)
   * GET /api/credit-limit/:agencyId
   */
  @Get(':agencyId')
  @Roles(Role.ACCOUNTANT_DEBT, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  async getAgencyCreditLimitById(
    @Param('agencyId') agencyId: string,
  ): Promise<AgencyCreditLimit> {
    return this.creditLimitService.getAgencyCreditLimitById(agencyId);
  }

  /**
   * Lấy lịch sử thay đổi hạn mức công nợ của đại lý (CreditLimitLog) (SN-34)
   * GET /api/credit-limit/:agencyId/logs
   */
  @Get(':agencyId/logs')
  @Roles(Role.ACCOUNTANT_DEBT, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  async getCreditLimitLogs(
    @Param('agencyId') agencyId: string,
  ): Promise<CreditLimitLog[]> {
    return this.creditLimitService.getCreditLimitLogs(agencyId);
  }

  /**
   * Lấy lịch sử thay đổi (hỗ trợ alias endpoint history)
   * GET /api/credit-limit/:agencyId/history
   */
  @Get(':agencyId/history')
  @Roles(Role.ACCOUNTANT_DEBT, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  async getCreditLimitHistory(
    @Param('agencyId') agencyId: string,
  ): Promise<CreditLimitLog[]> {
    return this.creditLimitService.getCreditLimitLogs(agencyId);
  }

  /**
   * Cập nhật hạn mức công nợ cho đại lý (SN-34)
   * Phân quyền: CHỈ ACCOUNTANT_DEBT (Kế toán công nợ) và BUSINESS_MANAGER (Quản lý kinh doanh)
   * PUT /api/credit-limit/:agencyId
   */
  @Put(':agencyId')
  @Roles(Role.ACCOUNTANT_DEBT, Role.BUSINESS_MANAGER)
  @HttpCode(HttpStatus.OK)
  async updateCreditLimit(
    @Param('agencyId') agencyId: string,
    @Body() dto: UpdateCreditLimitDto,
    @CurrentUser() user?: ICurrentUser,
  ): Promise<AgencyCreditLimit> {
    return this.creditLimitService.updateCreditLimit(
      agencyId,
      dto,
      user,
    );
  }

  /**
   * Khóa / Mở khóa hạn mức công nợ của đại lý (SN-34)
   * Phân quyền: CHỈ ACCOUNTANT_DEBT và BUSINESS_MANAGER
   * PATCH /api/credit-limit/:agencyId/status
   */
  @Patch(':agencyId/status')
  @Roles(Role.ACCOUNTANT_DEBT, Role.BUSINESS_MANAGER)
  @HttpCode(HttpStatus.OK)
  async updateCreditStatus(
    @Param('agencyId') agencyId: string,
    @Body() dto: UpdateCreditStatusDto,
    @CurrentUser() user?: ICurrentUser,
  ): Promise<AgencyCreditLimit> {
    return this.creditLimitService.updateCreditStatus(
      agencyId,
      dto,
      user,
    );
  }
}
