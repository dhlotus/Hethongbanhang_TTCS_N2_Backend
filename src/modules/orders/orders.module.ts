import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

export class OrdersModule {
  controllers = [OrdersController];
  providers = [OrdersService];
  exports = [OrdersService];
}
