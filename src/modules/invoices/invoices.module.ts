import { forwardRef, Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { DebtReminderSchedulerService } from './debt-reminder-scheduler.service';
import { MailModule } from '../mail/mail.module';
import { CustomersModule } from '../customers/customers.module';
import { CreditLimitModule } from '../credit-limit/credit-limit.module';

@Module({
  imports: [
    MailModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => CreditLimitModule),
  ],
  controllers: [InvoicesController],
  providers: [InvoicesService, DebtReminderSchedulerService],
  exports: [InvoicesService, DebtReminderSchedulerService],
})
export class InvoicesModule {}
