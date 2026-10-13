import { forwardRef, Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { OrdersModule } from '../orders/orders.module';
import { CreditLimitModule } from '../credit-limit/credit-limit.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    forwardRef(() => OrdersModule),
    forwardRef(() => CreditLimitModule),
    forwardRef(() => UsersModule),
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
