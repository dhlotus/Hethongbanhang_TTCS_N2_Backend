import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import { InventoryService, StockAdjustmentResult } from './inventory.service';

/**
 * Controller Quản lý Tồn kho & Sổ kho (SN-10, EP-04 & SN-23):
 * - Áp dụng JwtAuthGuard & RolesGuard để kiểm soát quyền
 * - Đảm bảo Nhân viên kinh doanh (SALES_REP) và Khách hàng (CUSTOMER) KHÔNG THỂ sửa/điều chỉnh tồn kho
 * - Chỉ Quản trị viên (ADMIN) và Thủ kho / Quản lý kho (WAREHOUSE_KEEPER, WAREHOUSE_MANAGER) mới có quyền điều chỉnh tồn kho
 * - Cung cấp sổ kho bất biến lưu vết các giao dịch quy đổi (SN-23)
 */
@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /**
   * Xem danh sách và số lượng tồn kho khả dụng kèm 3 cột tồn kho (SN-180)
   * GET /inventory/stock và GET /inventory/stocks
   * Quyền: Mọi vai trò đã đăng nhập (Admin, Sales, Warehouse, Accountant)
   */
  @Get('stock')
  async getStockOverview(): Promise<
    Array<{
      sku: string;
      productId: string;
      name: string;
      productName: string;
      stockQuantity: number;
      physicalStockQuantity: number;
      physicalQuantity: number;
      reservedQuantity: number;
      availableQuantity: number;
      baseUnit: string;
      units: Array<{ unitName: string; conversionRate: number; isBaseUnit: boolean }>;
      warehouse: string;
      activeReservations: Array<{
        id: string;
        orderId: string;
        orderCode?: string;
        quantity: number;
        expiredAt: string;
        createdAt: string;
      }>;
    }>
  > {
    return this.inventoryService.getStockOverview();
  }

  @Get('stocks')
  async getStocks(): Promise<
    Array<{
      sku: string;
      productId: string;
      name: string;
      productName: string;
      stockQuantity: number;
      physicalStockQuantity: number;
      physicalQuantity: number;
      reservedQuantity: number;
      availableQuantity: number;
      baseUnit: string;
      units: Array<{ unitName: string; conversionRate: number; isBaseUnit: boolean }>;
      warehouse: string;
      activeReservations: Array<{
        id: string;
        orderId: string;
        orderCode?: string;
        quantity: number;
        expiredAt: string;
        createdAt: string;
      }>;
    }>
  > {
    return this.inventoryService.getStockOverview();
  }

  /**
   * Lấy danh sách phiếu giữ chỗ kho đang hoạt động (SN-180)
   * GET /inventory/reservations
   */
  @Get('reservations')
  async getReservations(
    @Query('sku') sku?: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.inventoryService.getActiveReservations(sku, orderId);
  }

  /**
   * Truy vấn sổ kho và lịch sử quy đổi giao dịch nhập/xuất (SN-23)
   * GET /inventory/transactions?sku=...&limit=...
   * Quyền: ADMIN, WAREHOUSE_KEEPER, WAREHOUSE_MANAGER, SALES_REP, ACCOUNTANT
   */
  @Get('transactions')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
    UserRole.SALES_REP,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async getTransactions(
    @Query('sku') sku?: string,
    @Query('limit') limit?: number,
  ): Promise<InventoryTransactionEntity[]> {
    return this.inventoryService.getTransactions(sku, limit);
  }

  /**
   * Điều chỉnh tồn kho hàng hóa kèm quy đổi đơn vị (SN-23)
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
