import { forwardRef, Module } from '@nestjs/common';
import { DebtReportController } from './debt-report.controller';
import { DebtReportService } from './debt-report.service';
import { CustomersModule } from '../customers/customers.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { ReceiptsModule } from '../receipts/receipts.module';
import { ReturnsModule } from '../returns/returns.module';
import { DatabaseModule } from '../../database/database.module';

/**
 * Module Báo cáo Công nợ quá hạn theo tuổi nợ (SN-230) & Sổ chi tiết công nợ đại lý (SN-231)
 */
@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => InvoicesModule),
    forwardRef(() => ReceiptsModule),
    forwardRef(() => ReturnsModule),
  ],
  controllers: [DebtReportController],
  providers: [DebtReportService],
  exports: [DebtReportService],
})
export class DebtReportModule {}
