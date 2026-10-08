import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { DiscountPolicyStatus, DiscountTargetType, DiscountType } from '../enums/discount.enum';

export class CreateDiscountTierDto {
  @IsNumber()
  @Min(1)
  minQuantity: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxQuantity: number | null;

  @IsNumber()
  @Min(0)
  discountValue: number;
}

export class CreateDiscountPolicyDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(DiscountTargetType)
  targetType: DiscountTargetType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetIds?: string[];

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  appliedCategoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  appliedProductSkus?: string[];

  @IsEnum(DiscountType)
  discountType: DiscountType;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsEnum(DiscountPolicyStatus)
  status: DiscountPolicyStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateDiscountTierDto)
  tiers: CreateDiscountTierDto[];
}
