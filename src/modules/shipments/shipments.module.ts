import { forwardRef, Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { DeliveryTripsController } from './delivery-trips.controller';
import { ShipmentsService } from './shipments.service';
import { OrdersModule } from '../orders/orders.module';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    DatabaseModule,
    NotificationsModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => InventoryModule),
    forwardRef(() => ProductsModule),
  ],
  controllers: [ShipmentsController, DeliveryTripsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
