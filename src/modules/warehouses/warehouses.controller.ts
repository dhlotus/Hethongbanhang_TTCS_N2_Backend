import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import {
  AgencyWarehouseAssignmentEntity,
  AgencyWarehouseDetailEntity,
  AgencyWarehouseUpdateEntity,
  WarehouseEntity,
  WarehouseLocationEntity,
  WarehouseManagerEntity,
} from './entities/warehouse.entity';
import { WarehousesService } from './warehouses.service';

const WAREHOUSE_MANAGER_ROLES = [UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER];

@Controller('warehouses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  @Roles(
    ...WAREHOUSE_MANAGER_ROLES,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.WAREHOUSE,
    UserRole.SALES_MANAGER,
    UserRole.ACCOUNTANT,
    UserRole.SALES_REP,
  )
  findAll(
    @CurrentUser() currentUser?: ICurrentUser,
    @Query() query?: Record<string, string>,
  ): Promise<any> {
    return this.warehousesService.findAll(currentUser, query);
  }

  @Get('managers')
  @Roles(...WAREHOUSE_MANAGER_ROLES, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  listManagers(): Promise<WarehouseManagerEntity[]> {
    return this.warehousesService.listManagers();
  }

  @Post()
  @Roles(...WAREHOUSE_MANAGER_ROLES)
  create(@Body() dto: CreateWarehouseDto): Promise<WarehouseEntity> {
    return this.warehousesService.create(dto);
  }

  @Patch(':id')
  @Roles(...WAREHOUSE_MANAGER_ROLES)
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto): Promise<WarehouseEntity> {
    return this.warehousesService.update(id, dto);
  }

  @Get(':id/locations')
  @Roles(...WAREHOUSE_MANAGER_ROLES, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  listLocations(@Param('id') id: string): Promise<WarehouseLocationEntity[]> {
    return this.warehousesService.listLocations(id);
  }

  @Post(':id/locations')
  @Roles(...WAREHOUSE_MANAGER_ROLES, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  createLocation(
    @Param('id') id: string,
    @Body() dto: CreateLocationDto,
  ): Promise<WarehouseLocationEntity> {
    return this.warehousesService.createLocation(id, dto);
  }

  @Get('agencies/defaults')
  @Roles(...WAREHOUSE_MANAGER_ROLES, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  listAgencyDefaults(): Promise<AgencyWarehouseAssignmentEntity[]> {
    return this.warehousesService.listAgencyDefaults();
  }

  @Get('agencies/:agencyId/default')
  @Public()
  getAgencyDefault(@Param('agencyId') agencyId: string): Promise<AgencyWarehouseDetailEntity> {
    return this.warehousesService.getAgencyDefault(agencyId);
  }

  @Put('agencies/:agencyId/default')
  @Roles(...WAREHOUSE_MANAGER_ROLES)
  setAgencyDefault(
    @Param('agencyId') agencyId: string,
    @Body() body: { warehouseId: string | null },
  ): Promise<AgencyWarehouseUpdateEntity> {
    return this.warehousesService.setAgencyDefaultWarehouse(agencyId, body.warehouseId);
  }

  @Post(':id/agencies')
  @Roles(...WAREHOUSE_MANAGER_ROLES)
  assignAgencies(
    @Param('id') id: string,
    @Body() body: { agencyIds: string[] },
  ): Promise<{ success: boolean; count: number }> {
    return this.warehousesService.assignAgencies(id, body.agencyIds || []);
  }

  @Get(':id/delete-check')
  @Roles(...WAREHOUSE_MANAGER_ROLES)
  checkDeleteEligibility(@Param('id') id: string) {
    return this.warehousesService.checkDeleteEligibility(id);
  }

  @Delete(':id')
  @Roles(...WAREHOUSE_MANAGER_ROLES)
  delete(
    @Param('id') id: string,
    @Query('confirmZeroStock') confirmZeroStock?: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.warehousesService.delete(id, confirmZeroStock === 'true' || confirmZeroStock === '1');
  }
}
