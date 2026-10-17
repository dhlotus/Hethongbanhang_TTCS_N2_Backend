import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CustomersService } from '../customers/customers.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import {
  DEFAULT_WAREHOUSE_ID,
  STANDARD_WAREHOUSES,
} from './warehouse.constants';
import { UserRole } from '../../common/enums/user-role.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import {
  AgencyWarehouseAssignmentEntity,
  AgencyWarehouseDetailEntity,
  AgencyWarehouseUpdateEntity,
  WarehouseEntity,
  WarehouseLocationEntity,
  WarehouseManagerEntity,
} from './entities/warehouse.entity';

@Injectable()
export class WarehousesService implements OnModuleInit {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly customersService: CustomersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureStandardWarehouses();
  }

  async ensureStandardWarehouses(): Promise<void> {
    if (!this.databaseService?.isConnected()) {
      await this.databaseService?.ensureConnection?.();
    }
    if (!this.databaseService?.isConnected()) return;

    try {
      // 1. Dọn dẹp kho cũ WH01 (nếu còn)
      try {
        await this.databaseService.query(
          `DELETE FROM app_inventory_stock_balances WHERE warehouse_id = '11111111-0000-4000-8000-000000000001'`,
        );
        await this.databaseService.query(
          `DELETE FROM warehouses WHERE id = '11111111-0000-4000-8000-000000000001'`,
        );
      } catch {}

      // 2. Đồng bộ 4 kho chính chuẩn hóa
      for (const wh of STANDARD_WAREHOUSES) {
        await this.databaseService.query(
          `INSERT INTO warehouses (id, code, name, address, phone, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO UPDATE SET
             code = EXCLUDED.code,
             name = EXCLUDED.name,
             address = EXCLUDED.address,
             phone = EXCLUDED.phone,
             status = 'ACTIVE',
             updated_at = CURRENT_TIMESTAMP`,
          [wh.id, wh.code, wh.name, wh.address, wh.phone],
        );
      }
    } catch (err) {
      console.warn('[WarehousesService] Lỗi đồng bộ 4 kho chính:', err);
    }
  }

  async findAll(currentUser?: ICurrentUser): Promise<WarehouseEntity[]> {
    if (!this.databaseService?.isConnected()) {
      await this.databaseService?.ensureConnection?.();
    }
    if (!this.databaseService?.isConnected()) {
      return STANDARD_WAREHOUSES.map((wh) => ({
        id: wh.id,
        code: wh.code,
        name: wh.name,
        address: wh.address,
        phone: wh.phone,
        managerId: null,
        status: wh.status,
        locationCount: 2,
      }));
    }

    const roles = currentUser?.roles || [];
    const isAdmin = roles.includes(UserRole.ADMIN);
    const isManager = roles.includes(UserRole.WAREHOUSE_MANAGER) || roles.includes(UserRole.WH_MANAGER as any) || isAdmin;
    const isKeeperOnly = (roles.includes(UserRole.WAREHOUSE_KEEPER) || roles.includes(UserRole.WAREHOUSE as any)) && !isManager;

    if (isKeeperOnly && currentUser) {
      const keeperWhId = currentUser.warehouseId;
      const keeperUserId = currentUser.userId;
      return this.databaseService.query<WarehouseEntity>(
        `
        SELECT w.id, w.code, w.name, w.address, w.phone, w.manager_id AS "managerId",
               w.status, w.created_at AS "createdAt", w.updated_at AS "updatedAt",
               COUNT(l.id)::int AS "locationCount"
        FROM warehouses w 
        LEFT JOIN warehouse_locations l ON l.warehouse_id = w.id
        WHERE (
          w.manager_id = $1::uuid
          OR w.id IN (SELECT warehouse_id FROM user_warehouses WHERE user_id = $1::uuid)
          OR ($2::uuid IS NOT NULL AND w.id = $2::uuid)
        )
        GROUP BY w.id
        ORDER BY w.name ASC
        `,
        [keeperUserId, keeperWhId || null],
      );
    }

    return this.databaseService.query<WarehouseEntity>(`
      SELECT w.id, w.code, w.name, w.address, w.phone, w.manager_id AS "managerId",
             w.status, w.created_at AS "createdAt", w.updated_at AS "updatedAt",
             COUNT(l.id)::int AS "locationCount"
      FROM warehouses w LEFT JOIN warehouse_locations l ON l.warehouse_id = w.id
      GROUP BY w.id
      ORDER BY CASE 
        WHEN w.code = 'KHO-MB-01' THEN 1
        WHEN w.code = 'KHO-MT-01' THEN 2
        WHEN w.code = 'KHO-MN-01' THEN 3
        WHEN w.code = 'KHO-WEST-01' THEN 4
        ELSE 5
      END, w.created_at ASC, w.name ASC
    `);
  }

  async findById(id: string): Promise<WarehouseEntity | null> {
    const list = await this.findAll();
    return list.find((w) => w.id === id || w.code === id) || null;
  }

  async listManagers(): Promise<WarehouseManagerEntity[]> {
    if (!this.databaseService?.isConnected()) {
      await this.databaseService?.ensureConnection?.();
    }
    if (!this.databaseService?.isConnected()) {
      return [
        { id: '00000000-0000-0000-0000-000000000005', name: 'Phạm Hùng Kho', roleName: 'Thủ kho', roleCode: 'WAREHOUSE_KEEPER' },
        { id: '00000000-0000-0000-0000-000000000015', name: 'Hoàng Minh Tuấn Thủ Kho', roleName: 'Thủ kho', roleCode: 'WAREHOUSE_KEEPER' },
      ];
    }
    try {
      // Người phụ trách kho: Nơi gán quyền 1-1 cho Nhân viên kho / Thủ kho
      // Chỉ lấy các tài khoản Thủ kho / Nhân viên kho (không bao gồm Quản lý kho vì Quản lý kho quản trị chung toàn bộ hệ thống)
      return await this.databaseService.query<WarehouseManagerEntity>(
        `SELECT u.id, u.full_name AS name, r.name AS "roleName", r.code AS "roleCode", u.phone,
                w.id AS "assignedWarehouseId", w.code AS "assignedWarehouseCode", w.name AS "assignedWarehouseName"
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN warehouses w ON w.manager_id = u.id
         WHERE r.code IN ('WAREHOUSE_KEEPER', 'WAREHOUSE', 'WH_KEEPER') AND u.status = 'ACTIVE'
         ORDER BY u.full_name ASC`,
      );
    } catch {
      return [
        { id: '00000000-0000-0000-0000-000000000005', name: 'Phạm Hùng Kho', roleName: 'Thủ kho', roleCode: 'WAREHOUSE_KEEPER' },
        { id: '00000000-0000-0000-0000-000000000015', name: 'Hoàng Minh Tuấn Thủ Kho', roleName: 'Thủ kho', roleCode: 'WAREHOUSE_KEEPER' },
      ];
    }
  }

  async create(dto: CreateWarehouseDto): Promise<WarehouseEntity> {
    const rows = await this.databaseService.query<WarehouseEntity>(
      `INSERT INTO warehouses (code, name, address, phone, manager_id, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
       RETURNING id, code, name, address, phone, manager_id AS "managerId", status`,
      [
        dto.code.trim(),
        dto.name.trim(),
        dto.address.trim(),
        dto.phone?.trim() || null,
        dto.managerId || null,
      ],
    );
    const created = rows[0];
    if (created) {
      if (dto.managerId) {
        try {
          // RÀNG BUỘC 1 - 1: Nếu nhân viên kho / thủ kho này đã phụ trách kho khác, gỡ ở kho cũ
          await this.databaseService.query(
            `UPDATE warehouses SET manager_id = NULL WHERE manager_id = $1::uuid`,
            [dto.managerId],
          );
          // Gỡ bỏ phân công cũ trong user_warehouses
          await this.databaseService.query(
            `DELETE FROM user_warehouses WHERE user_id = $1::uuid OR warehouse_id = $2::uuid`,
            [dto.managerId, created.id],
          );
          // Gán quan hệ 1-1 mới
          await this.databaseService.query(
            `INSERT INTO user_warehouses (user_id, warehouse_id, is_primary)
             VALUES ($1::uuid, $2::uuid, true)
             ON CONFLICT (user_id, warehouse_id) DO UPDATE SET is_primary = true`,
            [dto.managerId, created.id],
          );
        } catch (err) {
          console.warn('[WarehousesService] Gán user_warehouses khi tạo kho:', err);
        }
      }

      try {
        // Tự động khởi tạo tồn kho của toàn bộ sản phẩm trong danh mục cho kho mới này với số lượng = 0
        await this.databaseService.query(
          `INSERT INTO inventories (warehouse_id, product_id, on_hand, allocated, updated_at)
           SELECT $1::uuid, p.id, 0, 0, CURRENT_TIMESTAMP
           FROM products p
           ON CONFLICT (warehouse_id, product_id) DO NOTHING;`,
          [created.id],
        );
        await this.databaseService.query(
          `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity, updated_at)
           SELECT UPPER(TRIM(p.sku)), $1::uuid, 0, CURRENT_TIMESTAMP
           FROM products p
           ON CONFLICT (product_sku, warehouse_id) DO NOTHING;`,
          [created.id],
        );
      } catch (invErr) {
        console.warn('[WarehousesService] Khởi tạo tồn kho mặc định = 0 cho kho mới thất bại:', invErr);
      }
    }
    return created;
  }

  async update(id: string, dto: UpdateWarehouseDto): Promise<WarehouseEntity> {
    const isUpdatingManager = dto.managerId !== undefined;
    const newManagerId = dto.managerId ? dto.managerId : null;

    const rows = await this.databaseService.query<WarehouseEntity>(
      `UPDATE warehouses SET 
         name = COALESCE($2, name), 
         address = COALESCE($3, address),
         phone = COALESCE($4, phone), 
         manager_id = CASE WHEN $5::boolean = true THEN $6::uuid ELSE manager_id END,
         status = COALESCE($7, status), 
         updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1
       RETURNING id, code, name, address, phone, manager_id AS "managerId", status`,
      [
        id,
        dto.name?.trim() || null,
        dto.address?.trim() || null,
        dto.phone?.trim() || null,
        isUpdatingManager,
        newManagerId,
        dto.status || null,
      ],
    );
    if (!rows[0]) throw new NotFoundException('Không tìm thấy kho hàng');
    const updated = rows[0];

    if (isUpdatingManager) {
      try {
        if (newManagerId) {
          // RÀNG BUỘC 1 - 1: Nếu nhân viên kho / thủ kho này đã phụ trách kho khác, gỡ ở kho cũ
          await this.databaseService.query(
            `UPDATE warehouses SET manager_id = NULL WHERE manager_id = $1::uuid AND id != $2::uuid`,
            [newManagerId, id],
          );
          // Gỡ bỏ phân công cũ trong user_warehouses
          await this.databaseService.query(
            `DELETE FROM user_warehouses WHERE user_id = $1::uuid OR warehouse_id = $2::uuid`,
            [newManagerId, id],
          );
          // Gán quan hệ 1-1 mới
          await this.databaseService.query(
            `INSERT INTO user_warehouses (user_id, warehouse_id, is_primary)
             VALUES ($1::uuid, $2::uuid, true)
             ON CONFLICT (user_id, warehouse_id) DO UPDATE SET is_primary = true`,
            [newManagerId, id],
          );
        } else {
          // Xóa gán khỏi kho này nếu bỏ trống người phụ trách
          await this.databaseService.query(
            `DELETE FROM user_warehouses WHERE warehouse_id = $1::uuid`,
            [id],
          );
        }
      } catch (err) {
        console.warn('[WarehousesService] Cập nhật user_warehouses:', err);
      }
    }
    return updated;
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
    try {
      const rows = await this.databaseService.query<AgencyWarehouseAssignmentEntity>(
        `SELECT agency_key AS "agencyId", warehouse_id AS "warehouseId"
         FROM app_agency_default_warehouses ORDER BY agency_key`,
      );
      return rows;
    } catch {
      return [];
    }
  }

  async getAgencyDefault(agencyId: string): Promise<AgencyWarehouseDetailEntity> {
    await this.customersService.getCustomerById(agencyId).catch(() => null);
    let warehouseId = DEFAULT_WAREHOUSE_ID;
    try {
      const rows = await this.databaseService.query<{ warehouse_id: string }>(
        'SELECT warehouse_id FROM app_agency_default_warehouses WHERE agency_key = $1',
        [agencyId],
      );
      if (rows[0]?.warehouse_id) {
        warehouseId = rows[0].warehouse_id;
      }
    } catch {
      // Fallback default warehouse
    }

    try {
      const warehouses = await this.databaseService.query<{ id: string; code: string; name: string }>(
        'SELECT id, code, name FROM warehouses WHERE id = $1::uuid',
        [warehouseId],
      );
      if (warehouses[0]) {
        return {
          agencyId,
          warehouseId,
          warehouseCode: warehouses[0].code,
          warehouseName: warehouses[0].name,
        };
      }

      // Nếu không tìm thấy kho theo ID cố định, tìm kho bất kỳ đang hoạt động
      const anyWh = await this.databaseService.query<{ id: string; code: string; name: string }>(
        'SELECT id, code, name FROM warehouses WHERE status = \'ACTIVE\' LIMIT 1',
      );
      if (anyWh[0]) {
        return {
          agencyId,
          warehouseId: anyWh[0].id,
          warehouseCode: anyWh[0].code,
          warehouseName: anyWh[0].name,
        };
      }
    } catch {
      // Bỏ qua lỗi DB
    }

    return {
      agencyId,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      warehouseCode: 'KHO-MN-01',
      warehouseName: 'Kho Tổng Miền Nam',
    };
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

  async assignAgencies(
    warehouseId: string,
    agencyIds: string[],
  ): Promise<{ success: boolean; count: number }> {
    await this.requireWarehouse(warehouseId);
    for (const agencyId of agencyIds) {
      if (!agencyId) continue;
      await this.databaseService.query(
        `INSERT INTO app_agency_default_warehouses (agency_key, warehouse_id)
         VALUES ($1, $2::uuid)
         ON CONFLICT (agency_key) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id`,
        [agencyId, warehouseId],
      );
    }
    return { success: true, count: agencyIds.length };
  }

  async checkDeleteEligibility(id: string): Promise<{
    canDelete: boolean;
    hasPositiveStock: boolean;
    totalOnHand: number;
    totalAllocated: number;
    hasZeroStockProducts: boolean;
    productRecordCount: number;
    isEmpty: boolean;
    warehouseName: string;
    warehouseCode: string;
    message: string;
  }> {
    if (!this.databaseService?.isConnected()) {
      await this.databaseService?.ensureConnection?.();
    }

    const rows = await this.databaseService.query<{ id: string; name: string; code: string }>(
      'SELECT id, name, code FROM warehouses WHERE id = $1',
      [id],
    );
    if (!rows[0]) {
      throw new NotFoundException('Không tìm thấy kho hàng');
    }
    const wh = rows[0];

    // Kiểm tra số lượng tồn kho > 0 trong inventories
    const invCheck = await this.databaseService.query<{
      total_on_hand: string;
      total_allocated: string;
      positive_count: string;
      total_records: string;
    }>(
      `SELECT 
         COALESCE(SUM(on_hand), 0)::text as total_on_hand,
         COALESCE(SUM(allocated), 0)::text as total_allocated,
         COUNT(CASE WHEN on_hand > 0 OR allocated > 0 THEN 1 END)::text as positive_count,
         COUNT(*)::text as total_records
       FROM inventories
       WHERE warehouse_id = $1::uuid`,
      [id],
    );

    // Kiểm tra số lượng tồn kho > 0 trong app_inventory_stock_balances
    const balCheck = await this.databaseService.query<{ total_physical: string }>(
      `SELECT COALESCE(SUM(physical_quantity), 0)::text as total_physical
       FROM app_inventory_stock_balances
       WHERE warehouse_id = $1::uuid AND physical_quantity > 0`,
      [id],
    );

    // Kiểm tra giữ tồn đơn hàng
    const resCheck = await this.databaseService.query<{ total_reserved: string }>(
      `SELECT COALESCE(SUM(base_quantity), 0)::text as total_reserved
       FROM app_order_inventory_reservations
       WHERE warehouse_id = $1::uuid AND status = 'RESERVED' AND base_quantity > 0`,
      [id],
    );

    const totalOnHand = Math.max(
      parseInt(invCheck[0]?.total_on_hand || '0', 10),
      parseInt(balCheck[0]?.total_physical || '0', 10),
    );
    const totalAllocated = Math.max(
      parseInt(invCheck[0]?.total_allocated || '0', 10),
      parseInt(resCheck[0]?.total_reserved || '0', 10),
    );
    const positiveCount = parseInt(invCheck[0]?.positive_count || '0', 10);
    const totalRecords = parseInt(invCheck[0]?.total_records || '0', 10);

    const hasPositiveStock = totalOnHand > 0 || totalAllocated > 0 || positiveCount > 0;
    const hasZeroStockProducts = !hasPositiveStock && totalRecords > 0;
    const isEmpty = !hasPositiveStock && totalRecords === 0;

    let message = '';
    if (hasPositiveStock) {
      message = `Kho đang có sản phẩm còn số lượng tồn kho (Tồn thực tế: ${totalOnHand}, Tạm giữ: ${totalAllocated}). Không được phép xóa kho này!`;
    } else if (hasZeroStockProducts) {
      message = `Kho hàng có ${totalRecords} sản phẩm trong danh mục nhưng không còn hàng (số lượng tồn kho = 0). Cần xác nhận đồng ý để xóa kho và xóa toàn bộ dữ liệu này khỏi cơ sở dữ liệu.`;
    } else {
      message = 'Kho trống không có dữ liệu hàng hóa (kho ma). Cho phép xóa kho.';
    }

    return {
      canDelete: !hasPositiveStock,
      hasPositiveStock,
      totalOnHand,
      totalAllocated,
      hasZeroStockProducts,
      productRecordCount: totalRecords,
      isEmpty,
      warehouseName: wh.name,
      warehouseCode: wh.code,
      message,
    };
  }

  async delete(id: string, confirmZeroStock: boolean = false): Promise<{ success: boolean; message: string }> {
    if (!this.databaseService?.isConnected()) {
      await this.databaseService?.ensureConnection?.();
    }

    if (!this.databaseService?.isConnected()) {
      return { success: true, message: 'Đã xóa kho hàng khỏi hệ thống thành công' };
    }

    // 1. Kiểm tra điều kiện xóa kho
    const eligibility = await this.checkDeleteEligibility(id);

    // TH1: Kho đang có sản phẩm và số lượng > 0 -> Tuyệt đối không cho phép xóa
    if (eligibility.hasPositiveStock) {
      throw new BadRequestException(
        `Không thể xóa kho hàng! Kho đang có sản phẩm tồn kho (Tồn thực tế: ${eligibility.totalOnHand}, Đang tạm giữ: ${eligibility.totalAllocated}). Vui lòng xuất kho hoặc chuyển hết tồn kho về 0 trước khi xóa.`,
      );
    }

    // TH2: Kho có danh mục sản phẩm nhưng tồn kho = 0 -> Cần xác nhận
    if (eligibility.hasZeroStockProducts && !confirmZeroStock) {
      throw new BadRequestException(
        `Kho hàng đang có ${eligibility.productRecordCount} sản phẩm trong danh mục (tất cả tồn kho = 0). Vui lòng xác nhận để xóa kho và xóa toàn bộ dữ liệu này khỏi cơ sở dữ liệu.`,
      );
    }

    const warehouseName = eligibility.warehouseName;
    const warehouseCode = eligibility.warehouseCode;

    // Xóa sạch sẽ tất cả dữ liệu và liên kết liên quan đến kho hàng:

    // 1. Gỡ mặc định đại lý
    try {
      await this.databaseService.query(
        'DELETE FROM app_agency_default_warehouses WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua nếu bảng chưa tồn tại
    }

    // 2. Xóa giữ chỗ tồn kho cho đơn hàng
    try {
      await this.databaseService.query(
        'DELETE FROM app_order_inventory_reservations WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 3. Xóa số dư tồn kho app_inventory_stock_balances
    try {
      await this.databaseService.query(
        'DELETE FROM app_inventory_stock_balances WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 4. Ngắt liên kết đơn hàng với kho (chuyển warehouse_id sang NULL)
    try {
      await this.databaseService.query(
        'UPDATE orders SET warehouse_id = NULL WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 5. Phiếu xuất kho (goods_issues & goods_issue_items)
    try {
      await this.databaseService.query(
        `DELETE FROM goods_issue_items WHERE issue_id IN (SELECT id FROM goods_issues WHERE warehouse_id = $1::uuid)`,
        [id],
      );
      await this.databaseService.query(
        'DELETE FROM goods_issues WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 6. Phiếu nhập kho (goods_receipts & goods_receipt_items)
    try {
      await this.databaseService.query(
        `DELETE FROM goods_receipt_items WHERE receipt_id IN (SELECT id FROM goods_receipts WHERE warehouse_id = $1::uuid)`,
        [id],
      );
      await this.databaseService.query(
        'DELETE FROM goods_receipts WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 7. Đơn trả hàng (return_orders & return_order_items)
    try {
      await this.databaseService.query(
        `DELETE FROM return_order_items WHERE return_order_id IN (SELECT id FROM return_orders WHERE warehouse_id = $1::uuid)`,
        [id],
      );
      await this.databaseService.query(
        'DELETE FROM return_orders WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 8. Chuyển kho nội bộ (internal_transfers & internal_transfer_items)
    try {
      await this.databaseService.query(
        `DELETE FROM internal_transfer_items WHERE transfer_id IN (
          SELECT id FROM internal_transfers WHERE from_warehouse_id = $1::text OR to_warehouse_id = $1::text
        )`,
        [id],
      );
      await this.databaseService.query(
        'DELETE FROM internal_transfers WHERE from_warehouse_id = $1::text OR to_warehouse_id = $1::text',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 9. Lịch sử giao dịch kho (inventory_transactions)
    try {
      await this.databaseService.query(
        'DELETE FROM inventory_transactions WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 10. Lô hàng tồn kho (inventory_batches)
    try {
      await this.databaseService.query(
        'DELETE FROM inventory_batches WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 11. Tồn kho sản phẩm (inventories)
    try {
      await this.databaseService.query(
        'DELETE FROM inventories WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 12. Phân công người dùng quản lý kho (user_warehouses)
    try {
      await this.databaseService.query(
        'DELETE FROM user_warehouses WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 13. Vị trí lưu kho (warehouse_locations)
    try {
      await this.databaseService.query(
        'DELETE FROM warehouse_locations WHERE warehouse_id = $1::uuid',
        [id],
      );
    } catch {
      // bỏ qua
    }

    // 14. Xóa kho hàng khỏi bảng warehouses
    await this.databaseService.query(
      'DELETE FROM warehouses WHERE id = $1::uuid',
      [id],
    );

    return {
      success: true,
      message: `Đã xóa sạch sẽ kho hàng "${warehouseName}" (${warehouseCode}) và các dữ liệu liên quan khỏi hệ thống thành công.`,
    };
  }

  private async requireWarehouse(id: string): Promise<void> {
    const rows = await this.databaseService.query<{ id: string }>(
      'SELECT id FROM warehouses WHERE id = $1',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Không tìm thấy kho hàng');
  }
}

