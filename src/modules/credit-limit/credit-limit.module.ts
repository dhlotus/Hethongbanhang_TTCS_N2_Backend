import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CustomersModule } from '../customers/customers.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { CreditLimitController } from './credit-limit.controller';
import { CreditLimitService } from './credit-limit.service';
import { CreditEvaluationService } from './credit-evaluation.service';

/**
 * Module Khai báo & Quản lý Hạn mức Công nợ & Đánh giá Cảnh báo Đại lý (SN-34 & SN-204)
 */
@Module({
  imports: [
    forwardRef(() => CustomersModule),
    forwardRef(() => InvoicesModule),
    AuditLogsModule,
  ],
  controllers: [CreditLimitController],
  providers: [CreditLimitService, CreditEvaluationService],
  exports: [CreditLimitService, CreditEvaluationService],
})
export class CreditLimitModule {}

