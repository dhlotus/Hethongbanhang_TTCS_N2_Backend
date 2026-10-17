import {
  Body,
  Controller,
  Delete,
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
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryTransactionEntity } from './entities/inventory-transaction.entity';
import type { LowStockAlert, StockBalance } from './entities/stock-balance.entity';
import { InventoryService, StockAdjustmentResult, StockOverviewItem } from './inventory.service';
import { InventoryAuditEntity } from './entities/inventory-audit.entity';
import {
  CreateInventoryAuditDto,
  UpdateAuditItemsDto,
  CompleteAuditDto,
  QueryAuditsDto,
  QueryBatchesDto,
  CheckBatchDispatchDto,
} from './dto';

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
   * Xem tổng quan sổ tồn kho minh bạch 3 cột (thực tế, tạm giữ, khả thi) theo SKU và từng kho (SN-10, SN-180)
   * GET /inventory/stock?warehouse=...&category=...&status=...&search=...
   * Quyền: Mọi vai trò đã đăng nhập (Admin, Sales, Warehouse, Accountant)
   */
  @Get('stock')
  async getStockOverview(
    @CurrentUser() currentUser?: ICurrentUser,
    @Query('warehouse') warehouse?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ): Promise<StockOverviewItem[]> {
    return this.inventoryService.getStockOverview(
      {
        warehouse: warehouse || warehouseId,
        warehouseId: warehouseId || warehouse,
        category,
        status,
        search,
      },
      currentUser,
    );
  }

  /**
   * Xóa sản phẩm khỏi kho (SN-23 & Yêu cầu mới):
   * - Chỉ Quản trị viên (ADMIN) và Quản lý kho (WAREHOUSE_MANAGER, WH_MANAGER)
   * - Ràng buộc: Tất cả các loại tồn (thực tế, tạm giữ, khả dụng) phải bằng 0
   */
  @Delete('stock')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER)
  async removeProductFromWarehouse(
    @Query('warehouseId') warehouseId: string,
    @Query('sku') sku?: string,
    @Query('productSku') productSku?: string,
    @Query('productId') productId?: string,
  ): Promise<{ success: boolean; message: string }> {
    const finalSku = (sku || productSku || '').trim();
    return this.inventoryService.removeProductFromWarehouse(warehouseId, finalSku, productId);
  }

  /**
   * Khai báo tồn tối thiểu theo SKU tại kho (SN-183)
   * PATCH /inventory/stock-balances/warehouses/:warehouseId/sku/:sku/min-stock
   */
  @Patch('stock-balances/warehouses/:warehouseId/sku/:sku/min-stock')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
  )
  async setMinStockLevel(
    @Param('warehouseId') warehouseId: string,
    @Param('sku') sku: string,
    @Body() body: { minStock: number },
  ): Promise<StockBalance> {
    return this.inventoryService.setMinStockLevel(warehouseId, sku, Number(body?.minStock));
  }

  /**
   * Danh sách SKU dưới mức tồn tối thiểu (SN-183)
   * GET /inventory/alerts/low-stock?warehouseId=...
   */
  @Get('alerts/low-stock')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async getLowStockAlerts(
    @Query('warehouseId') warehouseId?: string,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<LowStockAlert[]> {
    return this.inventoryService.getLowStockAlerts(warehouseId, currentUser);
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
      warehouseId?: string;
      minStockLevel?: number;
      isBelowMinStock?: boolean;
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
    const list = await this.inventoryService.getStockOverview();
    return list.map((item) => ({
      sku: item.sku,
      productId: item.productId || item.sku,
      name: item.name,
      productName: item.productName || item.name,
      stockQuantity: item.stockQuantity,
      physicalStockQuantity: item.physicalStockQuantity,
      physicalQuantity: item.physicalQuantity ?? item.physicalStockQuantity,
      reservedQuantity: item.reservedQuantity,
      availableQuantity: item.availableQuantity ?? item.stockQuantity,
      baseUnit: item.baseUnit,
      units: item.units,
      warehouse: item.warehouse,
      warehouseId: item.warehouseId,
      minStockLevel: item.minStockLevel ?? 0,
      isBelowMinStock: Boolean(item.isBelowMinStock),
      activeReservations: item.activeReservations || [],
    }));
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
    @Query('warehouse') warehouse?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: number,
  ): Promise<InventoryTransactionEntity[]> {
    return this.inventoryService.getTransactions({
      sku,
      warehouse: warehouse || warehouseId,
      startDate,
      endDate,
      type,
      search,
      limit,
    });
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
    return this.inventoryService.adjustStock(dto, user);
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
    return this.inventoryService.adjustStock(dto, user);
  }

  // =========================================================================
  // KIỂM KÊ KHO HÀNG (SN-182 / EP-SN-229)
  // =========================================================================

  /**
   * Tạo phiếu kiểm kê theo kho hoặc nhóm hàng (SN-182)
   * POST /inventory/audits
   */
  @Post('audits')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
  )
  async createAudit(
    @Body() dto: CreateInventoryAuditDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    return this.inventoryService.createAudit(dto, user);
  }

  /**
   * Danh sách phiếu kiểm kê có lọc (SN-182)
   * GET /inventory/audits
   */
  @Get('audits')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async getAudits(
    @Query() query: QueryAuditsDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<InventoryAuditEntity[]> {
    return this.inventoryService.getAudits(query, currentUser);
  }

  /**
   * Chi tiết phiếu kiểm kê (SN-182)
   * GET /inventory/audits/:id
   */
  @Get('audits/:id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async getAuditById(@Param('id') id: string): Promise<InventoryAuditEntity> {
    return this.inventoryService.getAuditById(id);
  }

  /**
   * Nhập số đếm thực tế (SN-182)
   * PUT /inventory/audits/:id/items
   */
  @Put('audits/:id/items')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
  )
  async updateAuditItems(
    @Param('id') id: string,
    @Body() dto: UpdateAuditItemsDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    return this.inventoryService.updateAuditItems(id, dto, user);
  }

  /**
   * Chốt kiểm kê điều chỉnh tồn về số thực đếm (SN-182)
   * POST /inventory/audits/:id/complete
   * Chỉ Quản lý kho (WAREHOUSE_MANAGER, WH_MANAGER, ADMIN) mới có quyền chốt
   */
  @Post('audits/:id/complete')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  async completeAudit(
    @Param('id') id: string,
    @Body() dto: CompleteAuditDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    return this.inventoryService.completeAudit(id, dto, user);
  }

  /**
   * Hủy phiếu kiểm kê (SN-182)
   * POST /inventory/audits/:id/cancel
   */
  @Post('audits/:id/cancel')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  async cancelAuditPost(
    @Param('id') id: string,
    @Body('reason') reason?: string,
    @CurrentUser() user?: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    return this.inventoryService.cancelAudit(id, reason, user);
  }

  /**
   * Hủy phiếu kiểm kê (Hỗ trợ cả DELETE)
   * DELETE /inventory/audits/:id
   */
  @Delete('audits/:id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
  )
  async cancelAuditDelete(
    @Param('id') id: string,
    @CurrentUser() user?: ICurrentUser,
  ): Promise<InventoryAuditEntity> {
    return this.inventoryService.cancelAudit(id, undefined, user);
  }

  // =========================================================================
  // THEO DÕI LÔ HÀNG & HẠN SỬ DỤNG (SN-184 / EP-SN-229)
  // =========================================================================

  /**
   * Truy vấn danh sách lô hàng kèm cảnh báo cận hạn (SN-184 AC-2 & AC-3)
   * GET /inventory/batches?warehouseId=...&status=...&expiryThresholdDays=30
   * Quyền: WAREHOUSE_KEEPER, WAREHOUSE_MANAGER, ADMIN, SALES_MANAGER, ACCOUNTANT
   */
  @Get('batches')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async getBatches(
    @Query() query: QueryBatchesDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ) {
    return this.inventoryService.getBatches(query, currentUser);
  }

  /**
   * Thống kê tổng quan lô hàng và cảnh báo cận hạn / quá hạn (SN-184 AC-3)
   * GET /inventory/batches/stats?warehouseId=...&expiryThresholdDays=30
   */
  @Get('batches/stats')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async getBatchStats(
    @Query('warehouseId') warehouseId?: string,
    @Query('expiryThresholdDays') thresholdDays?: number,
    @CurrentUser() currentUser?: ICurrentUser,
  ) {
    return this.inventoryService.getBatchStats(
      warehouseId,
      thresholdDays ? Number(thresholdDays) : 30,
      currentUser,
    );
  }

  /**
   * Kiểm tra điều kiện xuất kho của lô hàng và ghi đè của Quản lý kho (SN-184 AC-4)
   * POST /inventory/batches/check-dispatch
   * Chặn xuất lô đã quá hạn trừ khi Quản lý kho xác nhận ghi đè kèm lý do
   */
  @Post('batches/check-dispatch')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WAREHOUSE,
    UserRole.WH_MANAGER,
  )
  @HttpCode(HttpStatus.OK)
  async checkBatchDispatch(
    @Body() dto: CheckBatchDispatchDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ) {
    return this.inventoryService.checkBatchDispatch(dto, currentUser);
  }
}

