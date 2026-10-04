import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ExcelImportService } from './excel-import.service';

@Module({
  imports: [MailModule],
  controllers: [UsersController],
  providers: [UsersService, ExcelImportService],
  exports: [UsersService, ExcelImportService],
})
export class UsersModule {}
