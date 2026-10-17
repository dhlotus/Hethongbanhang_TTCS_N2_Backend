import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { PriceBooksModule } from './modules/price-books/price-books.module';
import { PriceListsModule } from './modules/price-lists/price-lists.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { DiscountPoliciesModule } from './modules/discount-policies/discount-policies.module';
import { CreditLimitModule } from './modules/credit-limit/credit-limit.module';
import { DatabaseModule } from './database/database.module';
import { MailModule } from './modules/mail/mail.module';
import { AgencyModule } from './modules/agencies/agency.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { GoodsReceiptsModule } from './modules/inventory-receipts/goods-receipts.module';
import { WarehousesModule } from './modules/warehouses/warehouses.module';
import { InternalTransfersModule } from './modules/inventory-transfers/internal-transfers.module';
import { ReceiptsModule } from './modules/receipts/receipts.module';
import { DeliveryTripsModule } from './modules/delivery-trips/delivery-trips.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    MailModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    ProductsModule,
    PriceBooksModule,
    PriceListsModule,
    CustomersModule,
    CreditLimitModule,
    OrdersModule,
    InventoryModule,
    GoodsReceiptsModule,
    InternalTransfersModule,
    SuppliersModule,
    DiscountPoliciesModule,
    ShipmentsModule,
    InvoicesModule,
    ReturnsModule,
    ReportsModule,
    AuditLogsModule,
    AgencyModule,
    DashboardModule,
    WarehousesModule,
    ReceiptsModule,
    DeliveryTripsModule,
  ],
})
export class AppModule { }

