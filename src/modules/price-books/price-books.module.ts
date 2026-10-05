import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PriceBooksController } from './price-books.controller';
import { PriceBooksService } from './price-books.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PriceBooksController],
  providers: [PriceBooksService],
  exports: [PriceBooksService],
})
export class PriceBooksModule {}
