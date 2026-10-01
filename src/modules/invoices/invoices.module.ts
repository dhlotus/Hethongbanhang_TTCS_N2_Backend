import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

export class InvoicesModule {
  controllers = [InvoicesController];
  providers = [InvoicesService];
  exports = [InvoicesService];
}
