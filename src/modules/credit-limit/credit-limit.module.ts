import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { CustomersModule } from '../customers/customers.module';
import { CreditLimitController } from './credit-limit.controller';
import { CreditLimitService } from './credit-limit.service';

/**
 * Module Khai báo & Quản lý Hạn mức Công nợ Đại lý (SN-34)
 */
@Module({
  imports: [CustomersModule, AuditLogsModule],
  controllers: [CreditLimitController],
  providers: [CreditLimitService],
  exports: [CreditLimitService],
})
export class CreditLimitModule {}
