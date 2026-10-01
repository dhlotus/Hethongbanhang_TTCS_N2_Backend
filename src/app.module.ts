// Module gốc liên kết toàn bộ 12 Feature-Modules và cấu hình hệ thống
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProductsModule } from './modules/products/products.module';
import { PriceBooksModule } from './modules/price-books/price-books.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';

export class AppModule {
  imports = [
    AuthModule,
    UsersModule,
    ProductsModule,
    PriceBooksModule,
    CustomersModule,
    OrdersModule,
    InventoryModule,
    ShipmentsModule,
    InvoicesModule,
    ReturnsModule,
    ReportsModule,
    AuditLogsModule,
  ];
}
