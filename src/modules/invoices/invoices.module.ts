import { forwardRef, Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { DebtReminderSchedulerService } from './debt-reminder-scheduler.service';
import { MailModule } from '../mail/mail.module';
import { CustomersModule } from '../customers/customers.module';
import { CreditLimitModule } from '../credit-limit/credit-limit.module';
import { ShipmentsModule } from '../shipments/shipments.module';
import { OrdersModule } from '../orders/orders.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    DatabaseModule,
    MailModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => CreditLimitModule),
    forwardRef(() => ShipmentsModule),
    forwardRef(() => OrdersModule),
    forwardRef(() => ReceiptsModule),
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, DebtReminderSchedulerService],
  exports: [InvoicesService, DebtReminderSchedulerService],
})
export class InvoicesModule {}
