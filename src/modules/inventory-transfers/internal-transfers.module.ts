import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductsModule } from '../products/products.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { InternalTransfersController } from './internal-transfers.controller';
import { InternalTransfersService } from './internal-transfers.service';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => InventoryModule),
    forwardRef(() => ProductsModule),
    WarehousesModule,
  ],
  controllers: [InternalTransfersController],
  providers: [InternalTransfersService],
  exports: [InternalTransfersService],
})
export class InternalTransfersModule {}
