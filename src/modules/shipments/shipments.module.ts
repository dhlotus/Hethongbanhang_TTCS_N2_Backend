import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

export class ShipmentsModule {
  controllers = [ShipmentsController];
  providers = [ShipmentsService];
  exports = [ShipmentsService];
}
