import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { OrdersService } from '../orders/orders.service';
import { OrderStatus } from '../orders/entities/order-status.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  OrderAllocationItem,
  PickingItemStatus,
  PickingLineItem,
  PickingSheetEntity,
  PickingSheetStatus,
  WarehouseLocationDetail,
} from './entities/picking-sheet.entity';
import { CreatePickingSheetDto } from './dto/create-picking-sheet.dto';
import { UpdatePickingItemDto } from './dto/update-picking-item.dto';
import { STANDARD_WAREHOUSES } from '../warehouses/warehouse.constants';

/**
 * Mutex phòng ngừa race condition khi nhiều thủ kho tạo phiếu cùng lúc
 */
class AsyncLock {
  private queue: Promise<void> = Promise.resolve();

  async acquire<T>(fn: () => Promise<T> | T): Promise<T> {
    let release: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.queue;
    this.queue = this.queue.then(() => wait);
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

@Injectable()
export class PickingSheetsService implements OnModuleInit {
  private readonly logger = new Logger(PickingSheetsService.name);
  private readonly sheets = new Map<string, PickingSheetEntity>();
  private readonly lock = new AsyncLock();

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    @Optional()
    private readonly databaseService?: DatabaseService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
    await this.loadSheetsFromDb();
    await this.syncCompletedSheetsWithOrders();
  }

  private async syncCompletedSheetsWithOrders(): Promise<void> {
    for (const sheet of this.sheets.values()) {
      if (sheet.status === 'COMPLETED' || sheet.status === 'PARTIALLY_COMPLETED') {
        for (const orderId of sheet.sourceOrderIds || []) {
          try {
            await this.ordersService.updatePickingStatus(orderId, OrderStatus.PACKED, sheet.sheetCode);
          } catch (e) {
            this.logger.debug(`Đồng bộ trạng thái PACKED cho đơn ${orderId}: ${e}`);
          }
        }
      }
    }
  }

  private async ensureTable(): Promise<void> {
    if (!this.databaseService || !this.databaseService.isConnected()) return;
    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS app_picking_sheets (
          id TEXT PRIMARY KEY,
          sheet_code TEXT NOT NULL UNIQUE,
          warehouse_id TEXT NOT NULL,
          warehouse_code TEXT,
          warehouse_name TEXT,
          status VARCHAR(30) NOT NULL DEFAULT 'IN_PROGRESS',
          picker_name TEXT,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_picking_sheets_wh ON app_picking_sheets(warehouse_id);
        CREATE INDEX IF NOT EXISTS idx_picking_sheets_status ON app_picking_sheets(status);
      `);
      this.logger.log('[PostgreSQL] Bảng app_picking_sheets đã được đồng bộ cấu trúc.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PostgreSQL] Lỗi tạo bảng app_picking_sheets: ${msg}`);
    }
  }

  private async loadSheetsFromDb(): Promise<void> {
    if (!this.databaseService || !this.databaseService.isConnected()) return;
    try {
      const rows = await this.databaseService.query<{ id: string; payload: any }>(
        `SELECT id, payload FROM app_picking_sheets ORDER BY created_at DESC LIMIT 500`,
      );
      for (const row of rows) {
        if (row.payload) {
          this.sheets.set(row.id, row.payload as PickingSheetEntity);
        }
      }
      this.logger.log(`[PostgreSQL] Đã tải ${rows.length} phiếu soạn hàng vào bộ nhớ.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PostgreSQL] Lỗi đọc danh sách app_picking_sheets: ${msg}`);
    }
  }

  private async persistSheet(sheet: PickingSheetEntity): Promise<void> {
    this.sheets.set(sheet.id, sheet);
    if (!this.databaseService || !this.databaseService.isConnected()) return;

    try {
      await this.databaseService.query(
        `INSERT INTO app_picking_sheets (id, sheet_code, warehouse_id, warehouse_code, warehouse_name, status, picker_name, payload, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           sheet_code = EXCLUDED.sheet_code,
           warehouse_id = EXCLUDED.warehouse_id,
           status = EXCLUDED.status,
           picker_name = EXCLUDED.picker_name,
           payload = EXCLUDED.payload,
           updated_at = CURRENT_TIMESTAMP`,
        [
          sheet.id,
          sheet.sheetCode,
          sheet.warehouseId,
          sheet.warehouseCode,
          sheet.warehouseName,
          sheet.status,
          sheet.pickerName,
          JSON.stringify(sheet),
        ],
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PostgreSQL] Lỗi lưu phiếu soạn ${sheet.sheetCode}: ${msg}`);
    }
  }

  private async removeSheetFromDb(sheetId: string): Promise<void> {
    this.sheets.delete(sheetId);
    if (!this.databaseService || !this.databaseService.isConnected()) return;
    try {
      await this.databaseService.query(`DELETE FROM app_picking_sheets WHERE id = $1`, [sheetId]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PostgreSQL] Lỗi xóa phiếu soạn ${sheetId}: ${msg}`);
    }
  }

  /**
   * Tính toán vị trí lưu kho & chỉ số đường đi S-Shape (Snake Routing)
   * Tuyệt đối không tự bịa vị trí: Nếu chưa cấu hình, gắn cờ isConfigured: false
   */
  async calculateLocationForSku(
    warehouseId: string,
    sku: string,
    productId?: string,
    category?: string,
  ): Promise<WarehouseLocationDetail> {
    const normalizedSku = (sku || '').trim().toUpperCase();

    // 1. Kiểm tra CSDL thực tế trong bảng warehouse_locations nếu PostgreSQL kết nối
    if (this.databaseService && this.databaseService.isConnected()) {
      try {
        const rows = await this.databaseService.query<any>(
          `SELECT wl.zone, wl.aisle, wl.rack, wl.shelf, wl.bin, wl.code, ib.batch_number, ib.quantity
           FROM inventory_batches ib
           JOIN warehouse_locations wl ON wl.id = ib.location_id
           LEFT JOIN products p ON p.id = ib.product_id
           WHERE (ib.warehouse_id::text = $1 OR $1 IS NULL)
             AND (ib.product_id::text = $2 OR p.sku ILIKE $3 OR ib.batch_number ILIKE $3)
           ORDER BY wl.aisle, wl.rack, wl.shelf, wl.bin`,
          [warehouseId, productId || '', `%${normalizedSku}%`],
        );
        if (rows && rows.length > 0) {
          const locDetails = rows.map((r) => ({
            detail: this.formatConfiguredLocation(r.zone, r.aisle, r.rack, r.shelf, r.bin, r.code),
            batchNumber: r.batch_number,
            quantity: Number(r.quantity) || 0,
          }));

          // Sắp xếp theo thứ tự S-Shape sortIndex
          locDetails.sort((a, b) => a.detail.sortIndex - b.detail.sortIndex);

          const primary = locDetails[0].detail;
          if (locDetails.length > 1) {
            primary.hasMultipleLocations = true;
            primary.multipleLocations = locDetails.map((l) => ({
              code: l.detail.formattedCode,
              zone: l.detail.zone,
              aisle: l.detail.aisle,
              rack: l.detail.rack,
              shelf: l.detail.shelf,
              bin: l.detail.bin,
              batchNumber: l.batchNumber,
              quantity: l.quantity,
            }));
            primary.formattedCode = `${primary.formattedCode} (+${locDetails.length - 1} vị trí khác)`;
          }
          return primary;
        }
      } catch (err) {
        this.logger.debug(`Tra cứu vị trí kho từ DB: ${err}`);
      }
    }

    // 2. Tra cứu cấu hình vị trí thực tế chuẩn hóa theo danh mục kho
    const stdLocations: Record<string, { zone: string; aisle: string; rack: string; shelf: string; bin: string; code: string }> = {
      'LH-COLA-330': { zone: 'KHU_KHO', aisle: 'A1', rack: 'R1', shelf: 'S1', bin: 'B01', code: 'KMN-A1-T1-01' },
      'LOHA-COLA-330': { zone: 'KHU_KHO', aisle: 'A1', rack: 'R1', shelf: 'S1', bin: 'B01', code: 'KMN-A1-T1-01' },
      'LH-MILK-900G': { zone: 'KHU_MAT', aisle: 'B2', rack: 'R2', shelf: 'S2', bin: 'B01', code: 'KMN-B2-T2-01' },
      'LH-NUT-180ML': { zone: 'KHU_MAT', aisle: 'B2', rack: 'R2', shelf: 'S1', bin: 'B02', code: 'KMN-B2-T1-02' },
      'LH-NEST-70ML': { zone: 'KHU_KHO', aisle: 'A1', rack: 'R2', shelf: 'S1', bin: 'B03', code: 'KMN-A1-T1-03' },
    };

    const cfg = stdLocations[normalizedSku];
    if (cfg) {
      return this.formatConfiguredLocation(cfg.zone, cfg.aisle, cfg.rack, cfg.shelf, cfg.bin, cfg.code);
    }

    // 3. Nếu chưa có cấu hình vị trí trong kho: Không tự bịa vị trí, đánh dấu rõ ràng để bổ sung
    return {
      zone: '',
      aisle: '',
      rack: '',
      shelf: '',
      bin: '',
      formattedCode: 'Chưa cấu hình',
      sortIndex: 999999,
      isConfigured: false,
    };
  }

  private formatConfiguredLocation(
    zone: string,
    aisle: string,
    rack: string,
    shelf: string,
    bin: string,
    code?: string,
  ): WarehouseLocationDetail {
    const aisleNum = parseInt((aisle || '').replace(/\D/g, ''), 10) || 1;
    const rackNum = parseInt((rack || '').replace(/\D/g, ''), 10) || 1;
    const shelfNum = parseInt((shelf || '').replace(/\D/g, ''), 10) || 1;
    const binNum = parseInt((bin || '').replace(/\D/g, ''), 10) || 1;

    // Lộ trình S-Shape: Dãy lẻ đi 1->N, Dãy chẵn đi ngược N->1
    const isReverseAisle = aisleNum % 2 === 0;
    const effectiveRackScore = isReverseAisle ? 99 - rackNum : rackNum;
    const sortIndex = aisleNum * 10000 + effectiveRackScore * 100 + shelfNum * 10 + binNum;

    return {
      zone: zone || 'DEFAULT',
      aisle: aisle || '01',
      rack: rack || 'R01',
      shelf: shelf || 'T1',
      bin: bin || 'B01',
      formattedCode: code || `${zone}-${aisle}-${rack}-${shelf}-${bin}`,
      sortIndex,
      isConfigured: true,
    };
  }

  /**
   * Kiểm tra phân quyền truy cập kho của người dùng
   */
  private checkWarehouseAccess(warehouseId: string, currentUser?: ICurrentUser): void {
    if (!currentUser) return;
    const roles = currentUser.roles || [];
    const isAdmin = roles.includes(UserRole.ADMIN);
    const isManager = roles.includes(UserRole.WAREHOUSE_MANAGER) || roles.includes(UserRole.WH_MANAGER as any) || isAdmin;

    if (isManager) return;

    const isKeeper = roles.includes(UserRole.WAREHOUSE_KEEPER) || roles.includes(UserRole.WAREHOUSE as any);
    if (!isKeeper) {
      throw new ForbiddenException('Bạn không có quyền truy cập vào phân hệ Quản lý Soạn hàng');
    }

    let normalizedWhId = warehouseId;
    if (warehouseId === 'wh-hcm-01' || warehouseId === 'wh-main-01' || warehouseId === 'kho-mn-01') {
      normalizedWhId = '11111111-0000-0000-0000-000000000001';
    } else if (warehouseId === 'wh-hn-01' || warehouseId === 'kho-mb-01') {
      normalizedWhId = '11111111-0000-0000-0000-000000000002';
    } else if (warehouseId === 'wh-dn-01' || warehouseId === 'kho-mt-01') {
      normalizedWhId = '11111111-0000-0000-0000-000000000004';
    } else if (warehouseId === 'wh-ct-01' || warehouseId === 'kho-west-01') {
      normalizedWhId = '11111111-0000-0000-0000-000000000003';
    }

    const userWh = currentUser.warehouseId || currentUser.warehouseCode || currentUser.assignedWarehouse;
    if (userWh && normalizedWhId) {
      const match =
        userWh.toLowerCase() === normalizedWhId.toLowerCase() ||
        normalizedWhId.toLowerCase().includes(userWh.toLowerCase()) ||
        userWh.toLowerCase().includes(normalizedWhId.toLowerCase());
      if (!match) {
        // Cho phép nếu kho thuộc danh mục kho chuẩn tương ứng
        const std = STANDARD_WAREHOUSES.find(
          (w) => w.id === normalizedWhId || w.code === normalizedWhId || w.name === normalizedWhId,
        );
        const stdMatch =
          std &&
          (userWh.toLowerCase().includes(std.id.toLowerCase()) ||
            userWh.toLowerCase().includes(std.code.toLowerCase()) ||
            std.name.toLowerCase().includes(userWh.toLowerCase()) ||
            (std.region && userWh.toLowerCase().includes(std.region.toLowerCase())));
        if (!stdMatch) {
          throw new ForbiddenException(`Thủ kho chỉ được thao tác trên kho được phân công (${userWh})`);
        }
      }
    }
  }

  /**
   * Lấy danh sách đơn hàng đủ điều kiện soạn hàng
   * Kiểm tra trạng thái và phân quyền kho, gắn cờ nếu đơn đang nằm trong phiếu khác
   */
  async getEligibleOrders(currentUser?: ICurrentUser): Promise<any[]> {
    const rawOrdersRes = await this.ordersService.findAllOrders({ limit: 100 } as any, currentUser as any);
    const allOrders = Array.isArray(rawOrdersRes) ? rawOrdersRes : rawOrdersRes?.data || [];

    // Tìm danh sách orderId đang nằm trong các phiếu soạn IN_PROGRESS và các phiếu đã hoàn tất
    const activeSheetOrdersMap = new Map<string, string>();
    const finishedOrderIds = new Set<string>();

    for (const sheet of this.sheets.values()) {
      if (sheet.status === 'IN_PROGRESS') {
        for (const ordId of sheet.sourceOrderIds || []) {
          activeSheetOrdersMap.set(ordId, sheet.sheetCode);
        }
        for (const code of sheet.sourceOrderCodes || []) {
          activeSheetOrdersMap.set(code, sheet.sheetCode);
        }
      } else if (sheet.status === 'COMPLETED' || sheet.status === 'PARTIALLY_COMPLETED') {
        for (const ordId of sheet.sourceOrderIds || []) {
          finishedOrderIds.add(ordId);
        }
        for (const code of sheet.sourceOrderCodes || []) {
          finishedOrderIds.add(code);
        }
      }
    }

    // Lọc trạng thái đủ điều kiện:
    // - Chỉ các đơn đã duyệt (APPROVED) hoặc đang trong tiến trình kho (PROCESSING)
    // - TUYỆT ĐỐI LOẠI BỎ các đơn đã nằm trong các phiếu soạn đã hoàn thành (COMPLETED / PARTIALLY_COMPLETED)
    // - TUYỆT ĐỐI LOẠI BỎ các đơn đã PACKED, DISPATCHED, SHIPPED, DELIVERED, COMPLETED, CANCELLED
    const eligibleOrders = allOrders.filter((o: any) => {
      const id = o.id;
      const code = o.orderCode;
      if (finishedOrderIds.has(id) || (code && finishedOrderIds.has(code))) {
        return false;
      }

      const st = String(o.status || '').toUpperCase();
      if (
        st === OrderStatus.PACKED ||
        st === OrderStatus.DISPATCHED ||
        st === OrderStatus.SHIPPED ||
        st === OrderStatus.DELIVERED ||
        st === OrderStatus.COMPLETED ||
        st === OrderStatus.CANCELLED ||
        st === 'PACKED' ||
        st === 'DISPATCHED' ||
        st === 'SHIPPED' ||
        st === 'DELIVERED' ||
        st === 'COMPLETED' ||
        st === 'CANCELLED'
      ) {
        return false;
      }

      return (
        st === OrderStatus.APPROVED ||
        st === OrderStatus.PROCESSING ||
        st === 'APPROVED' ||
        st === 'PROCESSING'
      );
    });

    return eligibleOrders.map((o: any) => ({
      ...o,
      currentActivePickingSheet: activeSheetOrdersMap.get(o.id) || activeSheetOrdersMap.get(o.orderCode) || null,
      isCurrentlyPicking: Boolean(activeSheetOrdersMap.has(o.id) || activeSheetOrdersMap.has(o.orderCode)),
    }));
  }

  /**
   * Lấy danh sách phiếu soạn hàng (hỗ trợ lọc theo kho và trạng thái)
   */
  async findAll(
    query?: { warehouseId?: string; status?: string; search?: string },
    currentUser?: ICurrentUser,
  ): Promise<PickingSheetEntity[]> {
    let list = Array.from(this.sheets.values());

    // Phân quyền: nếu là thủ kho, chỉ xem kho của mình
    const roles = currentUser?.roles || [];
    const isAdmin = roles.includes(UserRole.ADMIN);
    const isManager = roles.includes(UserRole.WAREHOUSE_MANAGER) || roles.includes(UserRole.WH_MANAGER as any) || isAdmin;
    const isKeeper = (roles.includes(UserRole.WAREHOUSE_KEEPER) || roles.includes(UserRole.WAREHOUSE as any)) && !isManager;

    if (isKeeper) {
      const myWh = currentUser?.warehouseId || currentUser?.warehouseCode || currentUser?.assignedWarehouse;
      if (myWh) {
        list = list.filter(
          (s) =>
            s.warehouseId === myWh ||
            s.warehouseCode === myWh ||
            (s.warehouseName && s.warehouseName.toLowerCase().includes(myWh.toLowerCase())),
        );
      }
    }

    if (query?.warehouseId && query.warehouseId !== 'ALL') {
      list = list.filter((s) => s.warehouseId === query.warehouseId || s.warehouseCode === query.warehouseId);
    }

    if (query?.status && query.status !== 'ALL') {
      list = list.filter((s) => s.status === query.status);
    }

    if (query?.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.sheetCode.toLowerCase().includes(q) ||
          s.warehouseName.toLowerCase().includes(q) ||
          s.pickerName.toLowerCase().includes(q) ||
          (s.sourceOrderCodes || []).some((code) => code.toLowerCase().includes(q)),
      );
    }

    // Sắp xếp mới nhất lên đầu
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Lấy chi tiết một phiếu soạn hàng theo ID hoặc Mã phiếu
   */
  async findOne(idOrCode: string, currentUser?: ICurrentUser): Promise<PickingSheetEntity> {
    const sheet =
      this.sheets.get(idOrCode) ||
      Array.from(this.sheets.values()).find((s) => s.sheetCode === idOrCode || s.id === idOrCode);

    if (!sheet) {
      throw new NotFoundException(`Không tìm thấy phiếu soạn hàng: ${idOrCode}`);
    }

    this.checkWarehouseAccess(sheet.warehouseId, currentUser);
    return sheet;
  }

  /**
   * Tạo phiếu soạn hàng mới (Wave Picking / Gộp đơn)
   * Kiểm tra trạng thái đơn, chống tạo trùng hoặc phân bổ vượt số lượng
   */
  async create(dto: CreatePickingSheetDto, currentUser?: ICurrentUser): Promise<PickingSheetEntity> {
    return this.lock.acquire(async () => {
      this.checkWarehouseAccess(dto.warehouseId, currentUser);

      if (!dto.selectedOrderIds || dto.selectedOrderIds.length === 0) {
        throw new BadRequestException('Vui lòng chọn ít nhất 1 đơn hàng để tạo lượt soạn hàng');
      }

      // 1. Kiểm tra đơn hàng có đang nằm trong phiếu soạn IN_PROGRESS khác hoặc đã hoàn tất không (Chống tạo trùng)
      for (const sheet of this.sheets.values()) {
        if (sheet.status === 'IN_PROGRESS') {
          for (const selectedId of dto.selectedOrderIds) {
            if (
              sheet.sourceOrderIds.includes(selectedId) ||
              (sheet.sourceOrderCodes && sheet.sourceOrderCodes.includes(selectedId))
            ) {
              throw new BadRequestException(
                `Đơn hàng ${selectedId} đang được soạn trong phiếu ${sheet.sheetCode}. Không thể đưa vào phiếu mới!`,
              );
            }
          }
        } else if (sheet.status === 'COMPLETED' || sheet.status === 'PARTIALLY_COMPLETED') {
          for (const selectedId of dto.selectedOrderIds) {
            if (
              sheet.sourceOrderIds.includes(selectedId) ||
              (sheet.sourceOrderCodes && sheet.sourceOrderCodes.includes(selectedId))
            ) {
              throw new BadRequestException(
                `Đơn hàng ${selectedId} đã được soạn hoàn tất trong phiếu ${sheet.sheetCode}. Không thể soạn lại!`,
              );
            }
          }
        }
      }

      // 2. Lấy thông tin các đơn hàng hợp lệ
      const rawOrdersRes = await this.ordersService.findAllOrders({ limit: 200 } as any, currentUser as any);
      const allOrders = Array.isArray(rawOrdersRes) ? rawOrdersRes : rawOrdersRes?.data || [];

      const selectedOrders = allOrders.filter((o: any) =>
        dto.selectedOrderIds.includes(o.id) || dto.selectedOrderIds.includes(o.orderCode),
      );

      if (selectedOrders.length === 0) {
        throw new BadRequestException('Không tìm thấy thông tin các đơn hàng đã chọn');
      }

      // Kiểm tra xem có đơn nào trong danh sách chọn không tồn tại hoặc không tìm thấy
      const foundIds = new Set(selectedOrders.flatMap((o: any) => [o.id, o.orderCode]));
      const missingIds = dto.selectedOrderIds.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw new BadRequestException(
          `Không tìm thấy hoặc không đủ điều kiện cho các đơn hàng: ${missingIds.join(', ')}`,
        );
      }

      // Kiểm tra trạng thái từng đơn: chỉ nhận các đơn đã duyệt (APPROVED hoặc PROCESSING)
      for (const order of selectedOrders) {
        const st = (order.status || '').toUpperCase();
        if (st !== 'APPROVED' && st !== 'PROCESSING') {
          throw new BadRequestException(
            `Đơn hàng ${order.orderCode} đang ở trạng thái ${st}, chỉ các đơn đã được duyệt (APPROVED, PROCESSING) mới đủ điều kiện tạo phiếu soạn`,
          );
        }
      }

      // 3. Map gom các dòng hàng theo SKU và Đơn vị tính
      const itemMap = new Map<
        string,
        {
          productId: string;
          productSku: string;
          productName: string;
          category?: string;
          unit: string;
          baseUnit: string;
          conversionRate: number;
          totalQuantity: number;
          orders: OrderAllocationItem[];
        }
      >();

      for (const order of selectedOrders) {
        const orderId = order.id || order.orderCode;
        const orderCode = order.orderCode || order.id;
        const customerId = order.customerId || '';
        const customerName = order.customerName || 'Đại lý';

        for (const line of order.lines || []) {
          const skuKey = `${(line.productSku || line.productId).toUpperCase()}_${(line.unit || 'Đơn vị').toUpperCase()}`;
          const existing = itemMap.get(skuKey);

          const allocation: OrderAllocationItem = {
            orderId,
            orderCode,
            customerId,
            customerName,
            requiredQuantity: line.quantity,
            pickedQuantity: 0,
            unit: line.unit || 'Đơn vị',
          };

          if (existing) {
            existing.totalQuantity += line.quantity;
            existing.orders.push(allocation);
          } else {
            itemMap.set(skuKey, {
              productId: line.productId || line.productSku,
              productSku: line.productSku,
              productName: line.productName,
              category: line.category,
              unit: line.unit || 'Đơn vị',
              baseUnit: line.baseUnit || line.unit || 'Đơn vị',
              conversionRate: line.conversionRate || 1,
              totalQuantity: line.quantity,
              orders: [allocation],
            });
          }
        }
      }

      if (itemMap.size === 0) {
        throw new BadRequestException('Các đơn hàng đã chọn không có mặt hàng nào để soạn');
      }

      // 4. Ánh xạ vị trí và sắp xếp theo đường đi Snake Routing (S-Shape)
      const rawItems: Array<{
        productId: string;
        productSku: string;
        productName: string;
        category?: string;
        unit: string;
        baseUnit: string;
        conversionRate: number;
        location: WarehouseLocationDetail;
        totalRequiredQuantity: number;
        orders: OrderAllocationItem[];
      }> = [];

      for (const entry of itemMap.values()) {
        const location = await this.calculateLocationForSku(
          dto.warehouseId,
          entry.productSku,
          entry.productId,
          entry.category,
        );
        rawItems.push({
          productId: entry.productId,
          productSku: entry.productSku,
          productName: entry.productName,
          category: entry.category,
          unit: entry.unit,
          baseUnit: entry.baseUnit,
          conversionRate: entry.conversionRate,
          location,
          totalRequiredQuantity: entry.totalQuantity,
          orders: entry.orders,
        });
      }

      // Sắp xếp thứ tự di chuyển trong kho (sortIndex tăng dần)
      rawItems.sort((a, b) => a.location.sortIndex - b.location.sortIndex);

      const items: PickingLineItem[] = rawItems.map((it, idx) => ({
        id: `pick-line-${Date.now()}-${idx + 1}`,
        productId: it.productId,
        productSku: it.productSku,
        productName: it.productName,
        category: it.category,
        unit: it.unit,
        baseUnit: it.baseUnit,
        conversionRate: it.conversionRate,
        location: it.location,
        stepNumber: idx + 1,
        totalRequiredQuantity: it.totalRequiredQuantity,
        totalPickedQuantity: 0,
        status: 'PENDING',
        orders: it.orders,
      }));

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const randNum = Math.floor(100 + Math.random() * 900);
      const sheetCode = `PSH-${dateStr}-${randNum}`;

      const warehouseObj = STANDARD_WAREHOUSES.find((w) => w.id === dto.warehouseId);
      const resolvedCode = dto.warehouseCode || warehouseObj?.code || 'KHO01';
      const resolvedName = dto.warehouseName || warehouseObj?.name || 'Kho hàng';

      const newSheet: PickingSheetEntity = {
        id: `psh-${Date.now()}-${randNum}`,
        sheetCode,
        warehouseId: dto.warehouseId,
        warehouseCode: resolvedCode,
        warehouseName: resolvedName,
        sourceOrderIds: selectedOrders.map((o: any) => o.id || o.orderCode),
        sourceOrderCodes: selectedOrders.map((o: any) => o.orderCode || o.id),
        orderCount: selectedOrders.length,
        status: 'IN_PROGRESS',
        pickerId: currentUser?.userId,
        pickerName: dto.pickerName || currentUser?.username || 'Thủ kho phụ trách',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        items,
        totalLines: items.length,
        pickedLines: 0,
        totalRequiredQuantity: items.reduce((s, it) => s + it.totalRequiredQuantity, 0),
        totalPickedQuantity: 0,
        note: dto.note || `Gộp ${selectedOrders.length} đơn hàng đã duyệt để soạn theo đường đi`,
      };

      // 5. Cập nhật trạng thái đơn sang PROCESSING kèm mã phiếu soạn
      for (const order of selectedOrders) {
        try {
          await this.ordersService.updatePickingStatus(
            order.id || order.orderCode,
            OrderStatus.PROCESSING,
            sheetCode,
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Không thể cập nhật trạng thái đơn ${order.orderCode}: ${msg}`);
        }
      }

      await this.persistSheet(newSheet);
      return newSheet;
    });
  }

  /**
   * Cập nhật số lượng thực soạn của 1 dòng hàng
   * Bắt buộc có lý do giải trình nếu soạn thiếu
   */
  async updateLineItem(
    sheetId: string,
    itemId: string,
    dto: UpdatePickingItemDto,
    currentUser?: ICurrentUser,
  ): Promise<PickingSheetEntity> {
    return this.lock.acquire(async () => {
      const sheet = await this.findOne(sheetId, currentUser);

      if (sheet.status === 'COMPLETED' || sheet.status === 'CANCELLED') {
        throw new BadRequestException('Không thể chỉnh sửa phiếu soạn đã hoàn tất hoặc đã hủy');
      }

      const itemIndex = sheet.items.findIndex((it) => it.id === itemId);
      if (itemIndex === -1) {
        throw new NotFoundException(`Không tìm thấy dòng hàng với ID: ${itemId}`);
      }

      const currentItem = sheet.items[itemIndex];
      const pickedQty = Number(dto.pickedQuantity);

      if (isNaN(pickedQty) || pickedQty < 0) {
        throw new BadRequestException('Số lượng thực soạn phải là số hợp lệ không âm');
      }

      if (pickedQty > currentItem.totalRequiredQuantity) {
        throw new BadRequestException(
          `Số lượng thực soạn (${pickedQty}) không được vượt quá số lượng yêu cầu (${currentItem.totalRequiredQuantity})`,
        );
      }

      const isShort = pickedQty < currentItem.totalRequiredQuantity;

      // Kiểm tra lý do soạn thiếu: không được chỉ chứa khoảng trắng
      if (dto.shortPickReason !== undefined && dto.shortPickReason.trim().length === 0) {
        throw new BadRequestException('Lý do soạn thiếu không được chỉ chứa khoảng trắng');
      }

      const effectiveReason =
        dto.shortPickReason !== undefined
          ? dto.shortPickReason.trim()
          : (currentItem.shortPickReason ? currentItem.shortPickReason.trim() : '');
      const effectiveReasonCode =
        dto.shortPickReasonCode || currentItem.shortPickReasonCode;

      if (isShort && (!effectiveReason || effectiveReason.length === 0)) {
        throw new BadRequestException(
          'Khi soạn thiếu hàng (số lượng nhặt < số lượng cần), bắt buộc phải nhập lý do giải trình',
        );
      }

      let nextStatus: PickingItemStatus = 'PENDING';
      if (pickedQty >= currentItem.totalRequiredQuantity) {
        nextStatus = 'PICKED';
      } else if (effectiveReason) {
        nextStatus = 'SHORT_PICKED';
      }

      // Phân bổ số lượng nhặt cho từng đơn hàng thành phần theo thứ tự yêu cầu
      let remainingToAllocate = pickedQty;
      const updatedOrders = currentItem.orders.map((alloc) => {
        if (remainingToAllocate <= 0) {
          return { ...alloc, pickedQuantity: 0 };
        }
        if (remainingToAllocate >= alloc.requiredQuantity) {
          remainingToAllocate -= alloc.requiredQuantity;
          return { ...alloc, pickedQuantity: alloc.requiredQuantity };
        }
        const partial = remainingToAllocate;
        remainingToAllocate = 0;
        return { ...alloc, pickedQuantity: partial };
      });

      const updatedItem: PickingLineItem = {
        ...currentItem,
        totalPickedQuantity: pickedQty,
        status: nextStatus,
        shortPickReason: isShort ? effectiveReason : undefined,
        shortPickReasonCode: isShort ? effectiveReasonCode : undefined,
        notes: dto.notes?.trim() || currentItem.notes,
        orders: updatedOrders,
        completedAt: nextStatus !== 'PENDING' ? new Date().toISOString() : undefined,
      };

      sheet.items[itemIndex] = updatedItem;
      this.recalculateSheetSummary(sheet);

      await this.persistSheet(sheet);
      return sheet;
    });
  }

  /**
   * Thao tác nhanh 1 chạm: Đánh dấu soạn đủ 100% cho dòng hàng
   */
  async quickPickAllItem(sheetId: string, itemId: string, currentUser?: ICurrentUser): Promise<PickingSheetEntity> {
    return this.lock.acquire(async () => {
      const sheet = await this.findOne(sheetId, currentUser);
      if (sheet.status === 'COMPLETED' || sheet.status === 'CANCELLED') {
        throw new BadRequestException('Không thể chỉnh sửa phiếu soạn đã hoàn tất hoặc đã hủy');
      }

      const item = sheet.items.find((it) => it.id === itemId);
      if (!item) throw new NotFoundException('Không tìm thấy dòng hàng');

      // Tự động phân bổ 100% cho từng đơn
      const updatedOrders = item.orders.map((alloc) => ({
        ...alloc,
        pickedQuantity: alloc.requiredQuantity,
      }));

      const updatedItem: PickingLineItem = {
        ...item,
        totalPickedQuantity: item.totalRequiredQuantity,
        status: 'PICKED',
        shortPickReason: undefined,
        shortPickReasonCode: undefined,
        orders: updatedOrders,
        completedAt: new Date().toISOString(),
      };

      const itemIdx = sheet.items.findIndex((it) => it.id === itemId);
      sheet.items[itemIdx] = updatedItem;
      this.recalculateSheetSummary(sheet);

      await this.persistSheet(sheet);
      return sheet;
    });
  }

  /**
   * Hoàn tất phiếu soạn hàng
   * Bắt buộc tất cả dòng thiếu phải có lý do
   */
  async completeSheet(sheetId: string, currentUser?: ICurrentUser): Promise<PickingSheetEntity> {
    return this.lock.acquire(async () => {
      const sheet = await this.findOne(sheetId, currentUser);

      if (sheet.status === 'COMPLETED' || sheet.status === 'PARTIALLY_COMPLETED') {
        return sheet;
      }

      // Kiểm tra dòng chưa xử lý
      const pendingItems = sheet.items.filter((it) => it.status === 'PENDING');
      if (pendingItems.length > 0) {
        throw new BadRequestException(
          `Còn ${pendingItems.length} mặt hàng chưa được kiểm đếm hoặc đánh dấu. Vui lòng hoàn thành trước khi chốt phiếu.`,
        );
      }

      // Kiểm tra dòng thiếu chưa có lý do
      const missingReasonItems = sheet.items.filter(
        (it) => it.totalPickedQuantity < it.totalRequiredQuantity && !it.shortPickReason?.trim(),
      );
      if (missingReasonItems.length > 0) {
        throw new BadRequestException(
          `Có ${missingReasonItems.length} mặt hàng soạn thiếu nhưng chưa nhập lý do giải trình`,
        );
      }

      const hasShort = sheet.items.some((i) => i.status === 'SHORT_PICKED');
      sheet.status = hasShort ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
      sheet.completedAt = new Date().toISOString();
      sheet.updatedAt = new Date().toISOString();
      this.recalculateSheetSummary(sheet);

      // Cập nhật trạng thái các đơn hàng sang PACKED (Đã soạn hàng & đóng gói xong)
      for (const orderId of sheet.sourceOrderIds || []) {
        try {
          await this.ordersService.updatePickingStatus(
            orderId,
            OrderStatus.PACKED,
            sheet.sheetCode,
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Lỗi cập nhật trạng thái PACKED cho đơn ${orderId}: ${msg}`);
        }
      }

      await this.persistSheet(sheet);
      return sheet;
    });
  }

  /**
   * Xóa / Hủy phiếu soạn hàng
   * Phục hồi trạng thái đơn về APPROVED nếu cần
   */
  async deleteSheet(sheetId: string, currentUser?: ICurrentUser): Promise<{ success: boolean; message: string }> {
    return this.lock.acquire(async () => {
      const sheet = await this.findOne(sheetId, currentUser);

      if (sheet.status === 'IN_PROGRESS') {
        // Revert đơn hàng về APPROVED nếu đơn đang mang mã phiếu này
        for (const orderId of sheet.sourceOrderIds || []) {
          try {
            await this.ordersService.updatePickingStatus(orderId, OrderStatus.APPROVED, undefined);
          } catch {}
        }
      }

      await this.removeSheetFromDb(sheet.id);
      return { success: true, message: `Đã xóa phiếu soạn hàng ${sheet.sheetCode} thành công` };
    });
  }

  /**
   * Tính toán lại tiến độ và trạng thái tổng quát của phiếu
   */
  private recalculateSheetSummary(sheet: PickingSheetEntity): void {
    const totalLines = sheet.items.length;
    const processedItems = sheet.items.filter((i) => i.status !== 'PENDING');
    const pickedLines = processedItems.length;

    const totalRequiredQuantity = sheet.items.reduce((s, i) => s + i.totalRequiredQuantity, 0);
    const totalPickedQuantity = sheet.items.reduce((s, i) => s + i.totalPickedQuantity, 0);

    let status: PickingSheetStatus = sheet.status || 'IN_PROGRESS';
    if (sheet.status === 'COMPLETED' || sheet.status === 'PARTIALLY_COMPLETED') {
      const hasShort = sheet.items.some((i) => i.status === 'SHORT_PICKED');
      status = hasShort ? 'PARTIALLY_COMPLETED' : 'COMPLETED';
    }

    sheet.totalLines = totalLines;
    sheet.pickedLines = pickedLines;
    sheet.totalRequiredQuantity = totalRequiredQuantity;
    sheet.totalPickedQuantity = totalPickedQuantity;
    sheet.status = status;
    sheet.updatedAt = new Date().toISOString();
  }
}
