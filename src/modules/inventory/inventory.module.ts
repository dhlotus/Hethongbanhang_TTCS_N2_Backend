import { forwardRef, Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryReservationSchedulerService } from './inventory-reservation-scheduler.service';

@Module({
  imports: [
    forwardRef(() => ProductsModule),
    forwardRef(() => OrdersModule),
  ],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryReservationSchedulerService],
  exports: [InventoryService, InventoryReservationSchedulerService],
})
export class InventoryModule {}

