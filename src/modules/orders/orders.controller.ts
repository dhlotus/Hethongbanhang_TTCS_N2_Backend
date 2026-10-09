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
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderEntity } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

/**
 * Controller Quản lý Đặt hàng B2B (SN-38, SN-39 & SN-46)
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Lấy danh sách đơn hàng phân trang và bộ lọc (SN-38 & SN-46)
   * - Hỗ trợ lọc trạng thái, đại lý, nhân viên, khu vực, khoảng thời gian
   * - Trả về tổng tiền của tập kết quả đang lọc (totalAmount)
   * - Phân quyền: Nhân viên kinh doanh chỉ thấy đơn của đại lý mình phụ trách
   * GET /api/orders
   */
  @Get()
  @Public()
  async getOrders(
    @Query() query: QueryOrdersDto,
    @Req() req?: any,
  ): Promise<{
    data: OrderEntity[];
    total: number;
    totalAmount: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const user = req?.user;
    return this.ordersService.findAllOrders(query, user);
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
   * Sao chép một đơn cũ thành đơn mới ở trạng thái Nháp (SN-48)
   * POST /api/orders/:id/clone
   */
  @Post(':id/clone')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async cloneOrder(@Param('id') id: string): Promise<OrderEntity> {
    return this.ordersService.cloneOrder(id);
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
