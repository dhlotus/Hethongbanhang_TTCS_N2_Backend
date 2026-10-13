import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateLocationDto } from './dto/create-location.dto';
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
  @Roles(...WAREHOUSE_MANAGER_ROLES, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  findAll(): Promise<WarehouseEntity[]> {
    return this.warehousesService.findAll();
  }

  @Get('managers')
  @Roles(...WAREHOUSE_MANAGER_ROLES)
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
  @Roles(...WAREHOUSE_MANAGER_ROLES)
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
}
