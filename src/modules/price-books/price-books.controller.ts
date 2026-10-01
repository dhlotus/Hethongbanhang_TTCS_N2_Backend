import { Controller } from '@nestjs/common';
import { PriceBooksService } from './price-books.service';

@Controller('price-books')
export class PriceBooksController {
  constructor(private readonly priceBooksService: PriceBooksService) {}
}
