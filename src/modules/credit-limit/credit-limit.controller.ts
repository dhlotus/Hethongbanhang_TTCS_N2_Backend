import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
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
import { CreditEvaluationService } from './credit-evaluation.service';
import {
  CreditConfigDto,
  UpdateCreditConfigDto,
  AgencyCreditEvaluationResult,
} from './dto/credit-config.dto';
import { QueryCreditLimitDto } from './dto/query-credit-limit.dto';
import { UpdateCreditLimitDto } from './dto/update-credit-limit.dto';
import { UpdateCreditStatusDto } from './dto/update-credit-status.dto';
import { CreditLimitStatsDto } from './dto/credit-limit-stats.dto';
import { AgencyCreditLimit } from './entities/agency-credit-limit.entity';
import { CreditLimitLog } from './entities/credit-limit-log.entity';

/**
 * Controller Quản lý và Khai báo Hạn mức Công nợ Đại lý (SN-34 & SN-204)
 * Áp dụng Guard kiểm tra quyền: Chỉ cho phép role ACCOUNTANT_DEBT và BUSINESS_MANAGER cập nhật
 */
@Controller('credit-limit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CreditLimitController {
  constructor(
    private readonly creditLimitService: CreditLimitService,
    private readonly creditEvaluationService: CreditEvaluationService,
  ) {}

  /**
   * Lấy cấu hình kiểm soát công nợ toàn hệ thống (SN-204)
   * GET /api/credit-limit/config
   */
  @Get('config')
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  getCreditConfig(): CreditConfigDto {
    return this.creditEvaluationService.getConfig();
  }

  /**
   * Cập nhật cấu hình kiểm soát công nợ toàn hệ thống (SN-204)
   * PUT /api/credit-limit/config
   */
  @Put('config')
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.ADMIN)
  async updateCreditConfig(
    @Body() dto: UpdateCreditConfigDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<CreditConfigDto> {
    return this.creditEvaluationService.updateConfig(dto, currentUser);
  }

  /**
   * Đánh giá chi tiết trạng thái cờ công nợ của một đại lý (SN-204)
   * GET /api/credit-limit/evaluation/:agencyId
   */
  @Get('evaluation/:agencyId')
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  async getAgencyCreditEvaluation(
    @Param('agencyId') agencyId: string,
  ): Promise<AgencyCreditEvaluationResult> {
    return this.creditEvaluationService.evaluateAgencyCredit(agencyId);
  }

  /**
   * Kích hoạt quét và đánh giá lại toàn bộ đại lý (SN-204)
   * POST /api/credit-limit/evaluation/trigger-all
   */
  @Post('evaluation/trigger-all')
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.ADMIN)
  async triggerEvaluateAll(): Promise<AgencyCreditEvaluationResult[]> {
    return this.creditEvaluationService.evaluateAllAgencies();
  }

  /**
   * Thống kê tổng quan hạn mức công nợ toàn hệ thống (SN-34)
   * GET /api/credit-limit/stats
   */
  @Get('stats')
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  async getCreditLimitStats(): Promise<CreditLimitStatsDto> {
    return this.creditLimitService.getCreditLimitStats();
  }

  /**
   * Lấy danh sách hạn mức công nợ của các đại lý (SN-34)
   * GET /api/credit-limit
   */
  @Get()
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
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
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
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
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
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
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER, Role.SALES_REP, Role.ADMIN)
  async getCreditLimitHistory(
    @Param('agencyId') agencyId: string,
  ): Promise<CreditLimitLog[]> {
    return this.creditLimitService.getCreditLimitLogs(agencyId);
  }

  /**
   * Cập nhật hạn mức công nợ cho đại lý (SN-34)
   * Phân quyền: CHỈ ACCOUNTANT (Kế toán công nợ) và SALES_MANAGER (Quản lý kinh doanh)
   * PUT /api/credit-limit/:agencyId
   */
  @Put(':agencyId')
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER)
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
   * Alias cập nhật hạn mức công nợ (hỗ trợ PATCH) (SN-34)
   * PATCH /api/credit-limit/:agencyId
   */
  @Patch(':agencyId')
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER)
  @HttpCode(HttpStatus.OK)
  async patchCreditLimit(
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
   * Phân quyền: CHỈ ACCOUNTANT và SALES_MANAGER
   * PATCH /api/credit-limit/:agencyId/status
   */
  @Patch(':agencyId/status')
  @Roles(Role.ACCOUNTANT, Role.ACCOUNTANT_DEBT, Role.SALES_MANAGER, Role.BUSINESS_MANAGER)
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
