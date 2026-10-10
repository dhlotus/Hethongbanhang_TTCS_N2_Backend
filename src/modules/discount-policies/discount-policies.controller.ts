import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { DiscountPoliciesService } from './discount-policies.service';
import { CreateDiscountPolicyDto } from './dto/create-discount-policy.dto';
import { UpdateDiscountPolicyDto } from './dto/update-discount-policy.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/v1/discount-policies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DiscountPoliciesController {
  constructor(private readonly discountPoliciesService: DiscountPoliciesService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  create(@Body() createDiscountPolicyDto: CreateDiscountPolicyDto) {
    return this.discountPoliciesService.create(createDiscountPolicyDto);
  }

  @Get()
  @Public()
  findAll() {
    return this.discountPoliciesService.findAll();
  }

  @Get(':id')
  @Public()
  findOne(@Param('id') id: string) {
    return this.discountPoliciesService.findById(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  update(@Param('id') id: string, @Body() updateDiscountPolicyDto: UpdateDiscountPolicyDto) {
    return this.discountPoliciesService.update(id, updateDiscountPolicyDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER)
  remove(@Param('id') id: string) {
    this.discountPoliciesService.remove(id);
    return { success: true };
  }

  @Post('calculate')
  @Public()
  calculateDiscount(@Body() body: { productId: string; productSku?: string; categoryId: string; quantity: number }) {
    const discount = this.discountPoliciesService.calculateBestDiscount(
      body.productId,
      body.categoryId,
      body.quantity,
      body.productSku,
    );
    return { discount };
  }
}
