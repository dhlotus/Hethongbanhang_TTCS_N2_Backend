import { forwardRef, Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [forwardRef(() => CategoriesModule)],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}

