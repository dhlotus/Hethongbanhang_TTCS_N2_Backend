import { Module } from '@nestjs/common';
import { DebtReportController } from './debt-report.controller';
import { DebtReportService } from './debt-report.service';
import { CustomersModule } from '../customers/customers.module';
import { DatabaseModule } from '../../database/database.module';

/**
 * Module Báo cáo Sổ công nợ và Phân tích tuổi nợ đại lý (SN-203)
 */
@Module({
  imports: [CustomersModule, DatabaseModule],
  controllers: [DebtReportController],
  providers: [DebtReportService],
  exports: [DebtReportService],
})
export class DebtReportModule {}
