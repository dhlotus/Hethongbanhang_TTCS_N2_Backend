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
import { CreditLimitEntity } from './entities/credit-limit.entity';
import { CreditLimitHistoryEntity } from './entities/credit-limit-history.entity';

/**
 * Controller Quản lý và Khai báo Hạn mức Công nợ Đại lý (SN-34)
 */
@Controller('credit-limit')
export class CreditLimitController {
  constructor(private readonly creditLimitService: CreditLimitService) {}

  /**
   * Thống kê tổng quan hạn mức công nợ toàn hệ thống (SN-34)
   * GET /api/credit-limit/stats
   */
  @Get('stats')
  async getCreditLimitStats(): Promise<CreditLimitStatsDto> {
    return this.creditLimitService.getCreditLimitStats();
  }

  /**
   * Lấy danh sách hạn mức công nợ của các đại lý (SN-34)
   * GET /api/credit-limit
   */
  @Get()
  async getCreditLimits(
    @Query() query: QueryCreditLimitDto,
  ): Promise<PaginatedCreditLimitResult> {
    return this.creditLimitService.getCreditLimits(query);
  }

  /**
   * Lấy chi tiết hạn mức công nợ của một đại lý (SN-34)
   * GET /api/credit-limit/:customerId
   */
  @Get(':customerId')
  async getCreditLimitById(
    @Param('customerId') customerId: string,
  ): Promise<CreditLimitEntity> {
    return this.creditLimitService.getCreditLimitById(customerId);
  }

  /**
   * Lấy lịch sử các lần điều chỉnh hạn mức công nợ của đại lý (SN-34)
   * GET /api/credit-limit/:customerId/history
   */
  @Get(':customerId/history')
  async getCreditLimitHistory(
    @Param('customerId') customerId: string,
  ): Promise<CreditLimitHistoryEntity[]> {
    return this.creditLimitService.getCreditLimitHistory(customerId);
  }

  /**
   * Khai báo / Cập nhật hạn mức công nợ cho đại lý (SN-34)
   * PUT /api/credit-limit/:customerId
   */
  @Put(':customerId')
  @HttpCode(HttpStatus.OK)
  async updateCreditLimit(
    @Param('customerId') customerId: string,
    @Body() dto: UpdateCreditLimitDto,
    @CurrentUser() user?: ICurrentUser,
  ): Promise<CreditLimitEntity> {
    return this.creditLimitService.updateCreditLimit(
      customerId,
      dto,
      user,
    );
  }

  /**
   * Khóa / Mở khóa hạn mức công nợ của đại lý (SN-34)
   * PATCH /api/credit-limit/:customerId/status
   */
  @Patch(':customerId/status')
  @HttpCode(HttpStatus.OK)
  async updateCreditStatus(
    @Param('customerId') customerId: string,
    @Body() dto: UpdateCreditStatusDto,
    @CurrentUser() user?: ICurrentUser,
  ): Promise<CreditLimitEntity> {
    return this.creditLimitService.updateCreditStatus(
      customerId,
      dto,
      user,
    );
  }
}
