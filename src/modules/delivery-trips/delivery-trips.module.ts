import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { OrdersModule } from '../orders/orders.module';
import { DeliveryTripsController } from './delivery-trips.controller';
import { DeliveryTripsService } from './delivery-trips.service';

@Module({
  imports: [DatabaseModule, forwardRef(() => OrdersModule)],
  controllers: [DeliveryTripsController],
  providers: [DeliveryTripsService],
  exports: [DeliveryTripsService],
})
export class DeliveryTripsModule {}
