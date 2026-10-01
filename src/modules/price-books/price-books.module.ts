import { PriceBooksController } from './price-books.controller';
import { PriceBooksService } from './price-books.service';

export class PriceBooksModule {
  controllers = [PriceBooksController];
  providers = [PriceBooksService];
  exports = [PriceBooksService];
}
