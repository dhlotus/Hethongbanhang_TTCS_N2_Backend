import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { WarehousesService } from './warehouses.service';

const MANAGERS = [UserRole.ADMIN, UserRole.WAREHOUSE_MANAGER, UserRole.WH_MANAGER];

@Controller('warehouses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  @Roles(...MANAGERS, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  findAll(): Promise<Record<string, unknown>[]> { return this.warehousesService.findAll(); }

  @Get('managers')
  @Roles(...MANAGERS)
  listManagers(): Promise<Array<{ id: string; name: string }>> {
    return this.warehousesService.listManagers();
  }

  @Post()
  @Roles(...MANAGERS)
  create(@Body() dto: CreateWarehouseDto): Promise<Record<string, unknown>> { return this.warehousesService.create(dto); }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto): Promise<Record<string, unknown>> { return this.warehousesService.update(id, dto); }

  @Get(':id/locations')
  @Roles(...MANAGERS, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  listLocations(@Param('id') id: string): Promise<Record<string, unknown>[]> { return this.warehousesService.listLocations(id); }

  @Post(':id/locations')
  @Roles(...MANAGERS, UserRole.WAREHOUSE_KEEPER, UserRole.WAREHOUSE)
  createLocation(@Param('id') id: string, @Body() dto: CreateLocationDto): Promise<Record<string, unknown>> { return this.warehousesService.createLocation(id, dto); }

  @Get('agencies/defaults')
  @Roles(...MANAGERS)
  listAgencyDefaults(): Promise<Array<{ agencyId: string; warehouseId: string }>> {
    return this.warehousesService.listAgencyDefaults();
  }

  @Put('agencies/:agencyId/default')
  @Roles(...MANAGERS)
  setAgencyDefault(@Param('agencyId') agencyId: string, @Body() body: { warehouseId: string | null }): Promise<Record<string, unknown>> {
    return this.warehousesService.setAgencyDefaultWarehouse(agencyId, body.warehouseId);
  }
}
