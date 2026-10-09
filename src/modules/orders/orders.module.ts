import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module';
import { DiscountPoliciesModule } from '../discount-policies/discount-policies.module';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { ProductsModule } from '../products/products.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [CustomersModule, PriceListsModule, DiscountPoliciesModule, ProductsModule, InventoryModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
