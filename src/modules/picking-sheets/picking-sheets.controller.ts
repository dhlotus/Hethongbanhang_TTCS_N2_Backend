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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { PickingSheetsService } from './picking-sheets.service';
import { CreatePickingSheetDto } from './dto/create-picking-sheet.dto';
import { UpdatePickingItemDto } from './dto/update-picking-item.dto';
import { PickingSheetEntity } from './entities/picking-sheet.entity';

@Controller('picking-sheets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PickingSheetsController {
  constructor(private readonly pickingSheetsService: PickingSheetsService) {}

  /**
   * Lấy danh sách đơn hàng đủ điều kiện soạn hàng (SN-186)
   * GET /api/picking-sheets/eligible-orders
   */
  @Get('eligible-orders')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
  )
  async getEligibleOrders(@CurrentUser() currentUser: ICurrentUser): Promise<any[]> {
    return this.pickingSheetsService.getEligibleOrders(currentUser);
  }

  /**
   * Danh sách phiếu soạn hàng (lọc theo kho, trạng thái, từ khóa)
   * GET /api/picking-sheets
   */
  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async findAll(
    @CurrentUser() currentUser: ICurrentUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ): Promise<PickingSheetEntity[]> {
    return this.pickingSheetsService.findAll({ warehouseId, status, search }, currentUser);
  }

  /**
   * Chi tiết 1 phiếu soạn hàng theo ID hoặc Mã phiếu
   * GET /api/picking-sheets/:id
   */
  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
  )
  async findOne(
    @Param('id') id: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<PickingSheetEntity> {
    return this.pickingSheetsService.findOne(id, currentUser);
  }

  /**
   * Tạo phiếu soạn hàng mới (Wave Picking / Gộp nhiều đơn) (SN-186)
   * POST /api/picking-sheets
   */
  @Post()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async create(
    @Body() dto: CreatePickingSheetDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<PickingSheetEntity> {
    return this.pickingSheetsService.create(dto, currentUser);
  }

  /**
   * Cập nhật số lượng thực soạn & lý do soạn thiếu của một dòng hàng
   * PATCH /api/picking-sheets/:id/items/:itemId
   */
  @Patch(':id/items/:itemId')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async updateLineItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdatePickingItemDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<PickingSheetEntity> {
    return this.pickingSheetsService.updateLineItem(id, itemId, dto, currentUser);
  }

  /**
   * Thao tác nhanh 1 chạm: Soạn đủ 100% dòng hàng
   * POST /api/picking-sheets/:id/quick-pick-all/:itemId
   */
  @Post(':id/quick-pick-all/:itemId')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async quickPickAll(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<PickingSheetEntity> {
    return this.pickingSheetsService.quickPickAllItem(id, itemId, currentUser);
  }

  /**
   * Hoàn tất phiếu soạn hàng (kiểm tra đầy đủ lý do thiếu)
   * POST /api/picking-sheets/:id/complete
   */
  @Post(':id/complete')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async complete(
    @Param('id') id: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<PickingSheetEntity> {
    return this.pickingSheetsService.completeSheet(id, currentUser);
  }

  /**
   * Xóa / Hủy phiếu soạn hàng
   * DELETE /api/picking-sheets/:id
   */
  @Delete(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_MANAGER,
    UserRole.WH_MANAGER,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
  )
  async remove(
    @Param('id') id: string,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<{ success: boolean; message: string }> {
    return this.pickingSheetsService.deleteSheet(id, currentUser);
  }
}
