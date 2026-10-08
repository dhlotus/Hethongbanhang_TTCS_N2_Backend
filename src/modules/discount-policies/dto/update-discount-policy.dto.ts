import { PartialType } from '@nestjs/mapped-types';
import { CreateDiscountPolicyDto } from './create-discount-policy.dto';

export class UpdateDiscountPolicyDto extends PartialType(CreateDiscountPolicyDto) {}
