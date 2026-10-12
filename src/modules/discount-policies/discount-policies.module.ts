import { Module } from '@nestjs/common';
import { DiscountPoliciesService } from './discount-policies.service';
import { DiscountPoliciesController } from './discount-policies.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [DiscountPoliciesController],
  providers: [DiscountPoliciesService],
  exports: [DiscountPoliciesService]
})
export class DiscountPoliciesModule {}
