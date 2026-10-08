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
} from '@nestjs/common';
import { CreateOrderDto, UpdateOrderStatusDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderEntity } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Controller Quản lý Đặt hàng B2B (SN-38 & SN-39)
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
  @Public()
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
