import { Module } from '@nestjs/common';
import { DiscountPoliciesService } from './discount-policies.service';
import { DiscountPoliciesController } from './discount-policies.controller';

@Module({
  controllers: [DiscountPoliciesController],
  providers: [DiscountPoliciesService],
  exports: [DiscountPoliciesService]
})
export class DiscountPoliciesModule {}
