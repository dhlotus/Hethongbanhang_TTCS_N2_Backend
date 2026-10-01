import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryService, StockAdjustmentResult } from './inventory.service';

/**
 * Controller Quản lý Tồn kho (SN-10 & EP-04):
 * - Áp dụng JwtAuthGuard & RolesGuard để kiểm soát quyền
 * - Đảm bảo Nhân viên kinh doanh (SALES_REP) và Khách hàng (CUSTOMER) KHÔNG THỂ sửa/điều chỉnh tồn kho
 * - Chỉ Quản trị viên (ADMIN) và Thủ kho / Quản lý kho (WAREHOUSE_KEEPER, WAREHOUSE_MANAGER) mới có quyền điều chỉnh tồn kho
 */
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /**
   * Xem danh sách và số lượng tồn kho khả dụng
   * GET /inventory/stock
   * Quyền: Mọi vai trò đã đăng nhập (Admin, Sales, Warehouse, Accountant)
   */
  @Get('stock')
  async getStockOverview(): Promise<
    Array<{
      sku: string;
      name: string;
      stockQuantity: number;
      baseUnit: string;
      warehouse: string;
    }>
  > {
    return this.inventoryService.getStockOverview();
  }

  /**
   * Điều chỉnh tồn kho hàng hóa
   * PUT /inventory/adjust
   * Quyền: CHỈ ADMIN, WAREHOUSE_KEEPER, WAREHOUSE_MANAGER
   * TỪ CHỐI BẮT BUỘC: SALES_REP, CUSTOMER
   */
  @Put('adjust')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
  )
  @HttpCode(HttpStatus.OK)
  async adjustStockPut(
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<StockAdjustmentResult> {
    return this.inventoryService.adjustStock(dto, user?.userId || 'unknown');
  }

  /**
   * Điều chỉnh tồn kho hàng hóa (Hỗ trợ cả POST)
   * POST /inventory/adjust
   * Quyền: CHỈ ADMIN, WAREHOUSE_KEEPER, WAREHOUSE_MANAGER
   */
  @Post('adjust')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
  )
  @HttpCode(HttpStatus.OK)
  async adjustStockPost(
    @Body() dto: AdjustStockDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<StockAdjustmentResult> {
    return this.inventoryService.adjustStock(dto, user?.userId || 'unknown');
  }
}
