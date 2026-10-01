import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

export class CustomersModule {
  controllers = [CustomersController];
  providers = [CustomersService];
  exports = [CustomersService];
}
