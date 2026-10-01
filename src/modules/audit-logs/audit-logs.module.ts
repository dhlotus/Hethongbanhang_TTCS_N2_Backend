import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';

export class AuditLogsModule {
  controllers = [AuditLogsController];
  providers = [AuditLogsService];
  exports = [AuditLogsService];
}
