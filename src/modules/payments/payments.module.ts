import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { CustomersModule } from '../customers/customers.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Module Ghi nhận thanh toán và Đối trừ công nợ (Module 7 - SN-202)
 */
@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => InvoicesModule),
    forwardRef(() => ReceiptsModule),
    forwardRef(() => CustomersModule),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
