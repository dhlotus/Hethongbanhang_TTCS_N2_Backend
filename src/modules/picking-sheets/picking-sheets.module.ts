import { Module, forwardRef } from '@nestjs/common';
import { PickingSheetsController } from './picking-sheets.controller';
import { PickingSheetsService } from './picking-sheets.service';
import { OrdersModule } from '../orders/orders.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [forwardRef(() => OrdersModule), DatabaseModule],
  controllers: [PickingSheetsController],
  providers: [PickingSheetsService],
  exports: [PickingSheetsService],
})
export class PickingSheetsModule {}
