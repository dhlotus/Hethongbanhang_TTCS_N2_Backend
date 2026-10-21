import { Module, forwardRef } from '@nestjs/common';
import { SalesTargetsController } from './sales-targets.controller';
import { SalesTargetsService } from './sales-targets.service';
import { OrdersModule } from '../orders/orders.module';
import { CustomersModule } from '../customers/customers.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    forwardRef(() => OrdersModule),
    forwardRef(() => CustomersModule),
    DatabaseModule,
  ],
  controllers: [SalesTargetsController],
  providers: [SalesTargetsService],
  exports: [SalesTargetsService],
})
export class SalesTargetsModule {}
