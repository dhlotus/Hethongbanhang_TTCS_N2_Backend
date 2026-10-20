import { Module, forwardRef } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { CustomersModule } from '../customers/customers.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    forwardRef(() => OrdersModule),
    forwardRef(() => ProductsModule),
    forwardRef(() => CustomersModule),
    DatabaseModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
