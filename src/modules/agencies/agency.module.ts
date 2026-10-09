import { forwardRef, Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { AgencyController } from "./agency.controller";
import { AgencyService } from "./agency.service";

/**
 * Module Quản lý Hồ sơ Đại lý (JIRA SN-30)
 */
@Module({
  imports: [forwardRef(() => OrdersModule)],
  controllers: [AgencyController],
  providers: [AgencyService],
  exports: [AgencyService],
})
export class AgencyModule {}

export { AgencyModule as AgenciesModule };
