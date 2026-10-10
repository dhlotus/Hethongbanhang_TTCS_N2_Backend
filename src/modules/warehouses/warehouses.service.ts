import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CustomersService } from '../customers/customers.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import {
  AgencyWarehouseAssignmentEntity,
  AgencyWarehouseUpdateEntity,
  WarehouseEntity,
  WarehouseLocationEntity,
  WarehouseManagerEntity,
} from './entities/warehouse.entity';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly customersService: CustomersService,
  ) {}

  async findAll(): Promise<WarehouseEntity[]> {
    return this.databaseService.query<WarehouseEntity>(`
      SELECT w.id, w.code, w.name, w.address, w.phone, w.manager_id AS "managerId",
             w.status, w.created_at AS "createdAt", w.updated_at AS "updatedAt",
             COUNT(l.id)::int AS "locationCount"
      FROM warehouses w LEFT JOIN warehouse_locations l ON l.warehouse_id = w.id
      GROUP BY w.id ORDER BY w.name
    `);
  }

  async listManagers(): Promise<WarehouseManagerEntity[]> {
    return this.databaseService.query<WarehouseManagerEntity>(
      `SELECT u.id, u.full_name AS name FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.code IN ('WAREHOUSE_MANAGER', 'WH_MANAGER') AND u.status = 'ACTIVE'
       ORDER BY u.full_name`,
    );
  }

  async create(dto: CreateWarehouseDto): Promise<WarehouseEntity> {
    const rows = await this.databaseService.query<WarehouseEntity>(
      `INSERT INTO warehouses (code, name, address, phone, manager_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, address, phone, manager_id AS "managerId", status`,
      [
        dto.code.trim(),
        dto.name.trim(),
        dto.address.trim(),
        dto.phone?.trim() || null,
        dto.managerId || null,
      ],
    );
    return rows[0];
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<WarehouseEntity> {
    const rows = await this.databaseService.query<WarehouseEntity>(
      `UPDATE warehouses SET name = COALESCE($2, name), address = COALESCE($3, address),
       phone = COALESCE($4, phone), manager_id = COALESCE($5, manager_id),
       status = COALESCE($6, status), updated_at = CURRENT_TIMESTAMP WHERE id = $1
       RETURNING id, code, name, address, phone, manager_id AS "managerId", status`,
      [
        id,
        dto.name?.trim() || null,
        dto.address?.trim() || null,
        dto.phone?.trim() || null,
        dto.managerId || null,
        dto.status || null,
      ],
    );
    if (!rows[0]) throw new NotFoundException('Không tìm thấy kho hàng');
    return rows[0];
  }

  async listLocations(warehouseId: string): Promise<WarehouseLocationEntity[]> {
    await this.requireWarehouse(warehouseId);
    return this.databaseService.query<WarehouseLocationEntity>(
      `SELECT id, warehouse_id AS "warehouseId", code, zone, aisle, rack, shelf, bin, status
       FROM warehouse_locations WHERE warehouse_id = $1 ORDER BY zone, aisle, rack, shelf, bin, code`,
      [warehouseId],
    );
  }

  async createLocation(
    warehouseId: string,
    dto: CreateLocationDto,
  ): Promise<WarehouseLocationEntity> {
    await this.requireWarehouse(warehouseId);
    const rows = await this.databaseService.query<WarehouseLocationEntity>(
      `INSERT INTO warehouse_locations (warehouse_id, code, zone, aisle, rack, shelf, bin, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, warehouse_id AS "warehouseId", code, zone, aisle, rack, shelf, bin, status`,
      [
        warehouseId,
        dto.code.trim(),
        dto.zone?.trim() || 'DEFAULT',
        dto.aisle || null,
        dto.rack || null,
        dto.shelf || null,
        dto.bin || null,
        dto.status || 'ACTIVE',
      ],
    );
    return rows[0];
  }

  async listAgencyDefaults(): Promise<AgencyWarehouseAssignmentEntity[]> {
    const rows = await this.databaseService.query<AgencyWarehouseAssignmentEntity>(
      `SELECT agency_key AS "agencyId", warehouse_id AS "warehouseId"
       FROM app_agency_default_warehouses ORDER BY agency_key`,
    );
    return rows;
  }

  async setAgencyDefaultWarehouse(
    agencyId: string,
    warehouseId: string | null,
  ): Promise<AgencyWarehouseUpdateEntity> {
    await this.customersService.getCustomerById(agencyId);
    if (warehouseId) await this.requireWarehouse(warehouseId);
    if (warehouseId) {
      await this.databaseService.query(
        `INSERT INTO app_agency_default_warehouses (agency_key, warehouse_id)
         VALUES ($1, $2::uuid)
         ON CONFLICT (agency_key) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id`,
        [agencyId, warehouseId],
      );
    } else {
      await this.databaseService.query(
        'DELETE FROM app_agency_default_warehouses WHERE agency_key = $1',
        [agencyId],
      );
    }
    return { agencyId, defaultWarehouseId: warehouseId };
  }

  private async requireWarehouse(id: string): Promise<void> {
    const rows = await this.databaseService.query<{ id: string }>(
      'SELECT id FROM warehouses WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Không tìm thấy kho hàng');
  }
}
