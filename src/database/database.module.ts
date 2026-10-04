import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Module toàn cục (Global) cung cấp DatabaseService cho toàn bộ hệ thống
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
