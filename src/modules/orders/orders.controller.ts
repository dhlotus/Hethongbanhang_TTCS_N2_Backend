import { Controller, Post, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Public()
  createOrder(@Body() createOrderDto: any) {
    return this.ordersService.createOrder(createOrderDto);
  }
}
