import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

export class ProductsModule {
  controllers = [ProductsController];
  providers = [ProductsService];
  exports = [ProductsService];
}
