import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

export class InventoryModule {
  controllers = [InventoryController];
  providers = [InventoryService];
  exports = [InventoryService];
}
