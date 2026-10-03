import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ProductsModule } from '../products/products.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * Module Quản lý Nhóm Hàng Đa Cấp (SN-150 / SN-22 - Sprint 2):
 * - Đăng ký CategoriesController và CategoriesService
 * - Tích hợp chặt chẽ với ProductsModule để quản lý ràng buộc sản phẩm
 */
@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => ProductsModule),
  ],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
