import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { InternalTransfersService } from './internal-transfers.service';
import {
  ConfirmTransferReceiptDto,
  CreateInternalTransferDto,
  QueryTransfersDto,
} from './dto';
import { InternalTransferEntity } from './entities/internal-transfer.entity';

/**
 * Controller quản lý Phiếu Chuyển kho Nội bộ (SN-181)
 */
@Controller('internal-transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InternalTransfersController {
  constructor(private readonly internalTransfersService: InternalTransfersService) {}

  /**
   * Tạo phiếu chuyển kho nội bộ mới
   * POST /api/internal-transfers
   */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  create(
    @Body() dto: CreateInternalTransferDto,
    @Req() req: { user: ICurrentUser },
  ): Promise<InternalTransferEntity> {
    return this.internalTransfersService.create(dto, req.user);
  }

  /**
   * Lấy danh sách phiếu chuyển kho
   * GET /api/internal-transfers
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  findAll(@Query() query: QueryTransfersDto): Promise<InternalTransferEntity[]> {
    return this.internalTransfersService.findAll(query);
  }

  /**
   * Lấy chi tiết một phiếu chuyển kho
   * GET /api/internal-transfers/:id
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  findOne(@Param('id') id: string): Promise<InternalTransferEntity> {
    return this.internalTransfersService.findOne(id);
  }

  /**
   * Kho đến xác nhận nhận hàng (kiểm đếm & xử lý chênh lệch)
   * PATCH /api/internal-transfers/:id/confirm
   */
  @Patch(':id/confirm')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  confirmReceipt(
    @Param('id') id: string,
    @Body() dto: ConfirmTransferReceiptDto,
    @Req() req: { user: ICurrentUser },
  ): Promise<InternalTransferEntity> {
    return this.internalTransfersService.confirmReceipt(id, dto, req.user);
  }

  /**
   * Hủy phiếu chuyển kho
   * PATCH /api/internal-transfers/:id/cancel
   */
  @Patch(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  cancel(
    @Param('id') id: string,
    @Req() req: { user: ICurrentUser },
  ): Promise<InternalTransferEntity> {
    return this.internalTransfersService.cancel(id, req.user);
  }
}
