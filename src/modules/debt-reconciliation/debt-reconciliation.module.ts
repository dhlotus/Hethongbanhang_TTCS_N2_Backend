import { forwardRef, Module } from '@nestjs/common';
import { DebtReconciliationService } from './debt-reconciliation.service';
import { DebtReconciliationController } from './debt-reconciliation.controller';
import { CustomersModule } from '../customers/customers.module';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => OrdersModule),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [DebtReconciliationController],
  providers: [DebtReconciliationService],
  exports: [DebtReconciliationService],
})
export class DebtReconciliationModule {}
