import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

@Module({ imports: [CustomersModule], controllers: [WarehousesController], providers: [WarehousesService], exports: [WarehousesService] })
export class WarehousesModule {}
