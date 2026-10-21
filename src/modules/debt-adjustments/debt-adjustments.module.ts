import { Module, forwardRef } from '@nestjs/common';
import { DebtAdjustmentsController } from './debt-adjustments.controller';
import { DebtAdjustmentsService } from './debt-adjustments.service';
import { DatabaseModule } from '../../database/database.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => CustomersModule),
  ],
  controllers: [DebtAdjustmentsController],
  providers: [DebtAdjustmentsService],
  exports: [DebtAdjustmentsService],
})
export class DebtAdjustmentsModule {}
