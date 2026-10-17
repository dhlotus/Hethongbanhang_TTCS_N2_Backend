import { forwardRef, Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { OrdersModule } from '../orders/orders.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryReservationSchedulerService } from './inventory-reservation-scheduler.service';
import { InventoryFefoService } from './inventory-fefo.service';

@Module({
  imports: [
    forwardRef(() => ProductsModule),
    forwardRef(() => OrdersModule),
    forwardRef(() => ShipmentsModule),
  ],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    InventoryReservationSchedulerService,
    InventoryFefoService,
  ],
  exports: [
    InventoryService,
    InventoryReservationSchedulerService,
    InventoryFefoService,
  ],
})
export class InventoryModule {}

