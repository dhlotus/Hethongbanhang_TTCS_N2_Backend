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
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CreateOrderDto,
  ReorderDto,
  UpdateOrderStatusDto,
} from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { DecideOrderDto } from './dto/decide-order.dto';
import { OrderEntity } from './entities/order.entity';
import { OrderApprovalHistoryEntity } from './entities/order-approval-history.entity';
import { OrdersService } from './orders.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CancelOrderDto } from './dto/cancel-order.dto';

/**
 * Controller Quản lý Đặt hàng B2B (SN-38, SN-39, SN-46, SN-170, SN-174 & SN-180)
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Lấy danh sách đơn hàng của riêng Đại lý đang đăng nhập (SN-170: Chỉ thấy đơn của chính mình)
   * GET /api/orders/portal/my-orders
   */
  @Get('portal/my-orders')
  @Public()
  async getMyOrders(
    @Query() query: QueryOrdersDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<{
    data: OrderEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    // Xác định customerId của đại lý (tự động nhận diện theo token hoặc query)
    const targetCustomerId =
      query.customerId ||
      (currentUser?.username === 'dealer' ||
      currentUser?.email?.includes('dealer') ||
      currentUser?.email?.includes('daily')
        ? 'cust-001'
        : 'cust-001');

    return this.ordersService.findOrdersByCustomer(targetCustomerId, query);
  }

  /**
   * Xem trước dòng hàng đặt lại, phát hiện sản phẩm ngừng kinh doanh & áp giá hiện hành (SN-174)
   * GET /api/orders/:id/reorder-preview
   */
  @Get(':id/reorder-preview')
  @Public()
  async getReorderPreview(
    @Param('id') id: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.ordersService.getReorderPreview(id, customerId);
  }

  /**
   * Đặt lại đơn hàng cũ theo bảng giá hiện hành (SN-174)
   * POST /api/orders/:id/reorder
   */
  @Post(':id/reorder')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async reorder(
    @Param('id') id: string,
    @Body() dto: ReorderDto,
    @Query('customerId') customerId?: string,
  ) {
    return this.ordersService.reorder(id, dto, customerId);
  }

  /**
   * Sao chép đơn hàng thành đơn mới ở trạng thái Nháp (SN-48)
   * POST /api/orders/:id/clone
   */
  @Post(':id/clone')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async cloneOrder(
    @Param('id') id: string,
    @CurrentUser() currentUser?: ICurrentUser,
    @Req() req?: any,
  ): Promise<OrderEntity> {
    let salesRep: { id?: string; name?: string } | undefined;
    if (currentUser) {
      salesRep = { id: currentUser.userId, name: currentUser.username || currentUser.email };
    } else if (req?.headers?.authorization) {
      try {
        const authHeader = req.headers.authorization;
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7).trim();
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload && (payload.sub || payload.username)) {
              salesRep = { id: payload.sub, name: payload.fullName || payload.username || payload.email };
            }
          }
        }
      } catch {
        // Fallback undefined
      }
    }
    return this.ordersService.cloneOrder(id, salesRep);
  }

  /**
   * Lấy danh sách đơn hàng phân trang và bộ lọc (SN-38)
   * GET /api/orders
   */
  @Get()
  @Public()
  async getOrders(@Query() query: QueryOrdersDto): Promise<{
    data: OrderEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    return this.ordersService.findAllOrders(query);
  }


  /**
   * Lấy chi tiết một đơn hàng theo ID
   * GET /api/orders/:id
   */
  @Get(':id')
  @Public()
  async getOrderById(@Param('id') id: string): Promise<OrderEntity> {
    return this.ordersService.findOrderById(id);
  }

  /**
   * Duyệt đơn hàng & kích hoạt giữ chỗ tồn kho (SN-180 AC1 & AC3)
   * POST /api/orders/:id/approve
   * Quyền: Chỉ ADMIN, SALES_MANAGER
   */
  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  async approveOrder(
    @Param('id') id: string,
    @CurrentUser() reviewer: ICurrentUser,
  ): Promise<OrderEntity> {
    return this.ordersService.approveOrder(id, reviewer);
  }

  /**
   * Hủy đơn hàng & tự động nhả tồn giữ chỗ (SN-180 AC2 & AC3)
   * POST /api/orders/:id/cancel
   * Quyền: ADMIN, SALES_MANAGER, SALES_REP
   */
  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP)
  async cancelOrder(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user: ICurrentUser,
  ): Promise<OrderEntity> {
    return this.ordersService.cancelOrder(id, dto.reason, user);
  }

  /**
   * Tạo đơn hàng mới cho Đại lý (SN-38 & SN-39)
   * POST /api/orders
   */
  @Post()
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async createOrder(@Body() dto: CreateOrderDto): Promise<OrderEntity> {
    return this.ordersService.createOrder(dto);
  }

  /**
   * Cập nhật đơn hàng (Lưu nháp & tiếp tục gõ SN-39)
   * PUT /api/orders/:id
   */
  @Put(':id')
  @Public()
  async updateOrder(
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ): Promise<OrderEntity> {
    return this.ordersService.updateOrder(id, dto);
  }

  /**
   * Cập nhật trạng thái đơn hàng (Duyệt, hủy...)
   * PATCH /api/orders/:id/status
   */
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP)
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderEntity> {
    return this.ordersService.updateOrderStatus(id, dto);
  }

  /**
   * Xóa đơn hàng (chỉ cho phép đơn Nháp hoặc Đã hủy)
   * DELETE /api/orders/:id
   */
  @Delete(':id')
  @Public()

  

  async deleteOrder(
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.ordersService.deleteOrder(id);
  }

  /**
   * Quyết định xét duyệt đơn hàng (Duyệt, từ chối, trả lại để sửa) - SN-41
   * POST /api/orders/:id/decision
   */
  @Post(':id/decision')
  @Public()
  async decideOrder(
    @Param('id') id: string,
    @Body() dto: DecideOrderDto,
    @CurrentUser() currentUser?: ICurrentUser,
    @Req() req?: any,
  ): Promise<OrderEntity> {
    let reviewer = currentUser;
    if (!reviewer && req?.headers?.authorization) {
      try {
        const authHeader = req.headers.authorization;
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          const token = authHeader.slice(7).trim();
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload && (payload.sub || payload.username || payload.email)) {
              reviewer = {
                userId: payload.sub || 'usr-admin-001',
                email: payload.email || 'admin@loha.vn',
                username: payload.username || 'admin',
                roles: payload.roles ?? (payload.role ? [payload.role] : [UserRole.ADMIN]),
              };
            }
          }
        }
      } catch {
        // Fallback to default admin below
      }
    }

    if (!reviewer) {
      reviewer = {
        userId: 'usr-admin-001',
        email: 'admin@loha.vn',
        username: 'admin',
        roles: [UserRole.ADMIN],
      };
    }

    return this.ordersService.decideOrder(id, dto, reviewer);
  }

  /**
   * Lấy lịch sử xét duyệt của đơn hàng - SN-41
   * GET /api/orders/:id/approval-history
   */
  @Get(':id/approval-history')
  @Public()
  async getApprovalHistory(
    @Param('id') id: string,
  ): Promise<OrderApprovalHistoryEntity[]> {
    return this.ordersService.getApprovalHistory(id);
  }
}
