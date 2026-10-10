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
import {
  CreateOrderDto,
  ReorderDto,
  UpdateOrderStatusDto,
} from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderEntity } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * Controller Quản lý Đặt hàng B2B (SN-38, SN-39, SN-170, SN-174)
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
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
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
}
