import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

export class ReportsModule {
  controllers = [ReportsController];
  providers = [ReportsService];
  exports = [ReportsService];
}
