import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../database/database.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProductsService } from '../products/products.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { TransferStatus } from './entities/transfer-status.enum';
import {
  InternalTransferEntity,
  InternalTransferItemEntity,
} from './entities/internal-transfer.entity';
import {
  ConfirmTransferReceiptDto,
  CreateInternalTransferDto,
  CreateTransferItemDto,
  QueryTransfersDto,
} from './dto';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

/** Cấu trúc dữ liệu hàng thô từ bảng internal_transfers */
interface InternalTransferDbRow {
  id: string;
  code: string;
  from_warehouse_id: string;
  from_warehouse_name: string;
  to_warehouse_id: string;
  to_warehouse_name: string;
  status: TransferStatus;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  transferred_at: Date | string | null;
  received_by: string | null;
  received_by_name: string | null;
  received_at: Date | string | null;
  discrepancy_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Cấu trúc dữ liệu hàng thô từ bảng internal_transfer_items */
interface InternalTransferItemDbRow {
  id: string;
  transfer_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  unit: string;
  conversion_rate: number | string;
  base_unit: string;
  transfer_quantity: number | string;
  base_transfer_quantity: number | string;
  received_quantity: number | string | null;
  base_received_quantity: number | string | null;
  discrepancy_quantity: number | string | null;
  discrepancy_reason: string | null;
  notes: string | null;
  created_at: Date | string;
}

/**
 * Service quản lý Phiếu Chuyển kho Nội bộ (Internal Warehouse Transfer) - SN-181
 * Tuân thủ quy chuẩn CODE_CONVENTION.md:
 * - 100% Type Safety (0 any)
 * - Tương tác dữ liệu với PostgreSQL qua DatabaseService & SQL Transaction
 * - Hỗ trợ file persistence an toàn khi môi trường phát triển chưa kết nối CSDL
 */
@Injectable()
export class InternalTransfersService implements OnModuleInit {
  private readonly logger = new Logger(InternalTransfersService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => InventoryService))
    private readonly inventoryService: InventoryService,
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    private readonly warehousesService: WarehousesService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initDatabaseTables();
  }

  /**
   * Khởi tạo bảng dữ liệu PostgreSQL
   */
  private async initDatabaseTables(): Promise<void> {
    if (!this.databaseService?.isConnected()) {
      this.logger.warn('CSDL PostgreSQL chưa sẵn sàng, hệ thống chuyển kho sẽ kích hoạt lưu trữ tệp đệm.');
      return;
    }

    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS internal_transfers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code VARCHAR(50) UNIQUE NOT NULL,
          from_warehouse_id VARCHAR(50) NOT NULL,
          from_warehouse_name VARCHAR(255) NOT NULL,
          to_warehouse_id VARCHAR(50) NOT NULL,
          to_warehouse_name VARCHAR(255) NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'IN_TRANSIT',
          notes TEXT,
          created_by VARCHAR(50),
          created_by_name VARCHAR(255),
          transferred_at TIMESTAMPTZ,
          received_by VARCHAR(50),
          received_by_name VARCHAR(255),
          received_at TIMESTAMPTZ,
          discrepancy_reason TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS internal_transfer_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          transfer_id UUID REFERENCES internal_transfers(id) ON DELETE CASCADE,
          product_id VARCHAR(50) NOT NULL,
          sku VARCHAR(100) NOT NULL,
          product_name VARCHAR(255) NOT NULL,
          unit VARCHAR(50) NOT NULL,
          conversion_rate DECIMAL(10, 2) NOT NULL DEFAULT 1,
          base_unit VARCHAR(50) NOT NULL,
          transfer_quantity DECIMAL(15, 2) NOT NULL,
          base_transfer_quantity DECIMAL(15, 2) NOT NULL,
          received_quantity DECIMAL(15, 2),
          base_received_quantity DECIMAL(15, 2),
          discrepancy_quantity DECIMAL(15, 2) DEFAULT 0,
          discrepancy_reason TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.logger.log('Đã khởi tạo bảng CSDL internal_transfers và internal_transfer_items thành công.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Không thể khởi tạo bảng CSDL internal_transfers: ${message}`);
    }
  }

  /**
   * Lấy danh sách phiếu chuyển kho theo bộ lọc
   */
  async findAll(query?: QueryTransfersDto): Promise<InternalTransferEntity[]> {
    if (this.databaseService?.isConnected()) {
      return this.findAllFromDatabase(query);
    }
    return this.findAllFromDisk(query);
  }

  /**
   * Xem chi tiết một phiếu chuyển kho (theo UUID hoặc Mã phiếu)
   */
  async findOne(id: string): Promise<InternalTransferEntity> {
    if (this.databaseService?.isConnected()) {
      return this.findOneFromDatabase(id);
    }
    return this.findOneFromDisk(id);
  }

  /**
   * Lập phiếu chuyển kho nội bộ mới
   *
   * Nghiệp vụ cốt lõi (SN-181):
   * 1. Kho đi và Kho đến phải khác nhau.
   * 2. Tồn kho khả dụng tại kho đi phải đủ cho toàn bộ số lượng yêu cầu.
   * 3. Khi xuất chuyển (IN_TRANSIT): Trừ tồn kho tại kho đi ngay lập tức.
   * 4. Hàng đang chuyển được ghi nhận là ĐANG TRÊN ĐƯỜNG, CHƯA ĐƯỢC CỘNG vào kho đến.
   */
  async create(
    dto: CreateInternalTransferDto,
    user: ICurrentUser,
  ): Promise<InternalTransferEntity> {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Kho xuất hàng và Kho nhận hàng không được trùng nhau.');
    }
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Phiếu chuyển kho phải có ít nhất 1 mặt hàng.');
    }

    const { fromWarehouse, toWarehouse } = await this.resolveWarehouses(
      dto.fromWarehouseId,
      dto.toWarehouseId,
    );

    const isDraft = Boolean(dto.isDraft);
    const items = await this.prepareTransferItems(dto.items, dto.fromWarehouseId, isDraft);

    if (this.databaseService?.isConnected()) {
      return this.createInDatabase(dto, fromWarehouse, toWarehouse, items, isDraft, user);
    }
    return this.createInDisk(dto, fromWarehouse, toWarehouse, items, isDraft, user);
  }

  /**
   * Xác nhận nhận hàng tại kho đến (Confirm Receipt)
   *
   * Nghiệp vụ cốt lõi (SN-181):
   * 1. Chỉ được xác nhận khi phiếu đang ở trạng thái IN_TRANSIT (Đang chuyển).
   * 2. Kho đến xác nhận nhận đủ -> cộng đúng số lượng tồn thực nhận vào kho đến.
   * 3. Nếu số lượng thực nhận chênh lệch so với số chuyển -> BẮT BUỘC NHẬP LÝ DO CHÊNH LỆCH.
   */
  async confirmReceipt(
    id: string,
    dto: ConfirmTransferReceiptDto,
    user: ICurrentUser,
  ): Promise<InternalTransferEntity> {
    const transfer = await this.findOne(id);

    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new BadRequestException(
        `Không thể xác nhận nhận hàng. Phiếu đang ở trạng thái "${transfer.status}", chỉ xử lý phiếu "IN_TRANSIT".`,
      );
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Vui lòng gửi danh sách số lượng kiểm đếm nhận hàng.');
    }

    // Kiểm tra ràng buộc lý do chênh lệch
    this.validateDiscrepancyReasons(transfer, dto);

    if (this.databaseService?.isConnected()) {
      return this.confirmReceiptInDatabase(transfer, dto, user);
    }
    return this.confirmReceiptInDisk(transfer, dto, user);
  }

  /**
   * Hủy phiếu chuyển kho
   */
  async cancel(id: string, user: ICurrentUser): Promise<InternalTransferEntity> {
    const transfer = await this.findOne(id);

    if (
      transfer.status === TransferStatus.COMPLETED ||
      transfer.status === TransferStatus.PARTIALLY_RECEIVED
    ) {
      throw new BadRequestException('Không thể hủy phiếu chuyển kho đã hoàn tất nhập hàng.');
    }

    if (transfer.status === TransferStatus.CANCELLED) {
      throw new BadRequestException('Phiếu chuyển kho này đã được hủy trước đó.');
    }

    if (this.databaseService?.isConnected()) {
      return this.cancelInDatabase(transfer, user);
    }
    return this.cancelInDisk(transfer, user);
  }

  // ===========================================================================
  // DATABASE TRANSACTION IMPLEMENTATION (POSTGRESQL)
  // ===========================================================================

  private async findAllFromDatabase(query?: QueryTransfersDto): Promise<InternalTransferEntity[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let pIdx = 1;

    if (query?.status) {
      conditions.push(`t.status = $${pIdx++}`);
      params.push(query.status);
    }
    if (query?.fromWarehouseId) {
      conditions.push(`t.from_warehouse_id = $${pIdx++}`);
      params.push(query.fromWarehouseId);
    }
    if (query?.toWarehouseId) {
      conditions.push(`t.to_warehouse_id = $${pIdx++}`);
      params.push(query.toWarehouseId);
    }
    if (query?.search?.trim()) {
      const searchPattern = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(
        `(LOWER(t.code) LIKE $${pIdx} OR LOWER(t.from_warehouse_name) LIKE $${pIdx} OR LOWER(t.to_warehouse_name) LIKE $${pIdx})`,
      );
      params.push(searchPattern);
      pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const transferRows = await this.databaseService.query<InternalTransferDbRow>(
      `SELECT * FROM internal_transfers t ${whereClause} ORDER BY t.created_at DESC`,
      params,
    );

    if (transferRows.length === 0) return [];

    const transferIds = transferRows.map((r) => r.id);
    const itemRows = await this.databaseService.query<InternalTransferItemDbRow>(
      `SELECT * FROM internal_transfer_items WHERE transfer_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
      [transferIds],
    );

    const itemsByTransferId = new Map<string, InternalTransferItemDbRow[]>();
    for (const item of itemRows) {
      const list = itemsByTransferId.get(item.transfer_id) || [];
      list.push(item);
      itemsByTransferId.set(item.transfer_id, list);
    }

    return transferRows.map((row) =>
      this.mapDbRowToEntity(row, itemsByTransferId.get(row.id) || []),
    );
  }

  private async findOneFromDatabase(id: string): Promise<InternalTransferEntity> {
    const transferRows = await this.databaseService.query<InternalTransferDbRow>(
      `SELECT * FROM internal_transfers WHERE id::text = $1 OR code = $1 LIMIT 1`,
      [id],
    );

    if (transferRows.length === 0) {
      throw new NotFoundException(`Không tìm thấy phiếu chuyển kho với ID hoặc Mã "${id}"`);
    }

    const row = transferRows[0];
    const itemRows = await this.databaseService.query<InternalTransferItemDbRow>(
      `SELECT * FROM internal_transfer_items WHERE transfer_id = $1 ORDER BY created_at ASC`,
      [row.id],
    );

    return this.mapDbRowToEntity(row, itemRows);
  }

  private async createInDatabase(
    dto: CreateInternalTransferDto,
    fromWarehouse: { id: string; name: string },
    toWarehouse: { id: string; name: string },
    items: InternalTransferItemEntity[],
    isDraft: boolean,
    user: ICurrentUser,
  ): Promise<InternalTransferEntity> {
    const client = await this.databaseService.getClient();
    await client.query('BEGIN');
    try {
      const codeRes = await client.query<{ next_code: string }>(
        `SELECT 'CK-' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || '-' || LPAD((COALESCE(MAX(SUBSTRING(code FROM 11)), '0')::INT + 1)::TEXT, 4, '0') AS next_code
         FROM internal_transfers WHERE code LIKE 'CK-' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || '-%'`,
      );
      const code = codeRes.rows[0]?.next_code || this.generateFallbackCode();
      const status = isDraft ? TransferStatus.DRAFT : TransferStatus.IN_TRANSIT;
      const transferredAt = isDraft ? null : new Date();

      const transferRes = await client.query<InternalTransferDbRow>(
        `INSERT INTO internal_transfers (
          code, from_warehouse_id, from_warehouse_name, to_warehouse_id, to_warehouse_name,
          status, notes, created_by, created_by_name, transferred_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *`,
        [
          code,
          fromWarehouse.id,
          fromWarehouse.name,
          toWarehouse.id,
          toWarehouse.name,
          status,
          dto.notes?.trim() || null,
          user.userId,
          user.username || user.email || 'Nhân viên kho',
          transferredAt,
        ],
      );

      const createdTransferRow = transferRes.rows[0];
      const insertedItemRows: InternalTransferItemDbRow[] = [];

      for (const item of items) {
        const itemRes = await client.query<InternalTransferItemDbRow>(
          `INSERT INTO internal_transfer_items (
            transfer_id, product_id, sku, product_name, unit, conversion_rate,
            base_unit, transfer_quantity, base_transfer_quantity, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`,
          [
            createdTransferRow.id,
            item.productId,
            item.sku,
            item.productName,
            item.unit,
            item.conversionRate,
            item.baseUnit,
            item.transferQuantity,
            item.baseTransferQuantity,
            item.notes || null,
          ],
        );
        insertedItemRows.push(itemRes.rows[0]);
      }

      // Trừ tồn kho tại kho xuất nếu không phải bản nháp
      if (!isDraft) {
        for (const item of items) {
          await this.inventoryService.adjustStock(
            {
              productSku: item.sku,
              quantityChange: -item.transferQuantity,
              unit: item.unit,
              reason: `Xuất điều chuyển nội bộ sang ${toWarehouse.name}`,
              referenceCode: code,
              warehouseId: fromWarehouse.id,
            },
            user.userId,
          );
        }
      }

      await client.query('COMMIT');
      return this.mapDbRowToEntity(createdTransferRow, insertedItemRows);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async confirmReceiptInDatabase(
    transfer: InternalTransferEntity,
    dto: ConfirmTransferReceiptDto,
    user: ICurrentUser,
  ): Promise<InternalTransferEntity> {
    const client = await this.databaseService.getClient();
    await client.query('BEGIN');
    try {
      const itemMap = new Map(dto.items.map((i) => [i.itemId, i]));
      let hasDiscrepancy = false;

      for (const item of transfer.items) {
        const confirmItem = itemMap.get(item.id) || itemMap.get(item.productId)!;
        const actualReceived = confirmItem.receivedQuantity;
        const discrepancy = item.transferQuantity - actualReceived;
        if (discrepancy !== 0) hasDiscrepancy = true;

        const baseReceived = Math.round(actualReceived * item.conversionRate);
        const discrepancyReason =
          confirmItem.discrepancyReason?.trim() || dto.generalDiscrepancyReason?.trim() || null;

        await client.query(
          `UPDATE internal_transfer_items
           SET received_quantity = $1, base_received_quantity = $2,
               discrepancy_quantity = $3, discrepancy_reason = $4
           WHERE id = $5`,
          [actualReceived, baseReceived, discrepancy, discrepancyReason, item.id],
        );

        // Cộng tồn kho tại kho nhận theo số lượng thực nhận
        if (actualReceived > 0) {
          await this.inventoryService.adjustStock(
            {
              productSku: item.sku,
              quantityChange: actualReceived,
              unit: item.unit,
              reason: `Nhập điều chuyển từ ${transfer.fromWarehouseName} (Phiếu ${transfer.code})${discrepancyReason ? ` [Lý do chênh lệch: ${discrepancyReason}]` : ''}`,
              referenceCode: transfer.code,
              warehouseId: transfer.toWarehouseId,
            },
            user.userId,
          );
        }
      }

      const finalStatus = hasDiscrepancy
        ? TransferStatus.PARTIALLY_RECEIVED
        : TransferStatus.COMPLETED;
      const discrepancyReason = dto.generalDiscrepancyReason?.trim() || transfer.discrepancyReason || null;

      const updatedRes = await client.query<InternalTransferDbRow>(
        `UPDATE internal_transfers
         SET status = $1, received_by = $2, received_by_name = $3,
             received_at = CURRENT_TIMESTAMP, discrepancy_reason = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [
          finalStatus,
          user.userId,
          user.username || user.email || 'Thủ kho nhận',
          discrepancyReason,
          transfer.id,
        ],
      );

      const updatedItems = await client.query<InternalTransferItemDbRow>(
        `SELECT * FROM internal_transfer_items WHERE transfer_id = $1 ORDER BY created_at ASC`,
        [transfer.id],
      );

      await client.query('COMMIT');
      return this.mapDbRowToEntity(updatedRes.rows[0], updatedItems.rows);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async cancelInDatabase(
    transfer: InternalTransferEntity,
    user: ICurrentUser,
  ): Promise<InternalTransferEntity> {
    const client = await this.databaseService.getClient();
    await client.query('BEGIN');
    try {
      // Nếu đang chuyển trên đường, hoàn trả lại tồn kho xuất
      if (transfer.status === TransferStatus.IN_TRANSIT) {
        for (const item of transfer.items) {
          await this.inventoryService.adjustStock(
            {
              productSku: item.sku,
              quantityChange: item.transferQuantity,
              unit: item.unit,
              reason: `Hoàn nhập do hủy phiếu điều chuyển ${transfer.code}`,
              referenceCode: transfer.code,
              warehouseId: transfer.fromWarehouseId,
            },
            user.userId,
          );
        }
      }

      const updatedRes = await client.query<InternalTransferDbRow>(
        `UPDATE internal_transfers
         SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [TransferStatus.CANCELLED, transfer.id],
      );

      const items = await client.query<InternalTransferItemDbRow>(
        `SELECT * FROM internal_transfer_items WHERE transfer_id = $1 ORDER BY created_at ASC`,
        [transfer.id],
      );

      await client.query('COMMIT');
      return this.mapDbRowToEntity(updatedRes.rows[0], items.rows);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ===========================================================================
  // DISK PERSISTENCE FALLBACK (Đảm bảo chạy độc lập khi chưa bật DB server)
  // ===========================================================================

  private getDiskStoragePath(): string {
    const dataDir = path.join(process.cwd(), 'uploads', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return path.join(dataDir, 'internal-transfers.json');
  }

  private readDiskTransfers(): InternalTransferEntity[] {
    try {
      const filePath = this.getDiskStoragePath();
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) return [];
      const rawList: Array<Partial<InternalTransferEntity>> = JSON.parse(content);
      return rawList.map((item) => new InternalTransferEntity(item));
    } catch {
      return [];
    }
  }

  private saveDiskTransfers(transfers: InternalTransferEntity[]): void {
    try {
      const filePath = this.getDiskStoragePath();
      fs.writeFileSync(filePath, JSON.stringify(transfers, null, 2), 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Lỗi lưu phiếu chuyển kho vào disk: ${msg}`);
    }
  }

  private findAllFromDisk(query?: QueryTransfersDto): InternalTransferEntity[] {
    let list = this.readDiskTransfers();

    if (query?.status) {
      list = list.filter((t) => t.status === query.status);
    }
    if (query?.fromWarehouseId) {
      list = list.filter((t) => t.fromWarehouseId === query.fromWarehouseId);
    }
    if (query?.toWarehouseId) {
      list = list.filter((t) => t.toWarehouseId === query.toWarehouseId);
    }
    if (query?.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.code.toLowerCase().includes(q) ||
          t.fromWarehouseName.toLowerCase().includes(q) ||
          t.toWarehouseName.toLowerCase().includes(q) ||
          t.items.some(
            (i) => i.sku.toLowerCase().includes(q) || i.productName.toLowerCase().includes(q),
          ),
      );
    }

    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  private findOneFromDisk(id: string): InternalTransferEntity {
    const list = this.readDiskTransfers();
    const transfer = list.find((t) => t.id === id || t.code === id);

    if (!transfer) {
      throw new NotFoundException(`Không tìm thấy phiếu chuyển kho với ID hoặc Mã "${id}"`);
    }

    return transfer;
  }

  private async createInDisk(
    dto: CreateInternalTransferDto,
    fromWarehouse: { id: string; name: string },
    toWarehouse: { id: string; name: string },
    items: InternalTransferItemEntity[],
    isDraft: boolean,
    user: ICurrentUser,
  ): Promise<InternalTransferEntity> {
    const list = this.readDiskTransfers();
    const code = this.generateFallbackCode();

    const transfer = new InternalTransferEntity({
      id: `itf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      code,
      fromWarehouseId: fromWarehouse.id,
      fromWarehouseName: fromWarehouse.name,
      toWarehouseId: toWarehouse.id,
      toWarehouseName: toWarehouse.name,
      status: isDraft ? TransferStatus.DRAFT : TransferStatus.IN_TRANSIT,
      notes: dto.notes?.trim() || '',
      createdBy: user.userId,
      createdByName: user.username || user.email || 'Nhân viên kho',
      createdAt: new Date(),
      transferredAt: isDraft ? undefined : new Date(),
      items: [],
    });

    items.forEach((item) => {
      item.transferId = transfer.id;
    });
    transfer.items = items;

    if (!isDraft) {
      for (const item of items) {
        await this.inventoryService.adjustStock(
          {
            productSku: item.sku,
            quantityChange: -item.transferQuantity,
            unit: item.unit,
            reason: `Xuất điều chuyển nội bộ sang ${toWarehouse.name}`,
            referenceCode: code,
            warehouseId: fromWarehouse.id,
          },
          user.userId,
        );
      }
    }

    list.unshift(transfer);
    this.saveDiskTransfers(list);
    return transfer;
  }

  private async confirmReceiptInDisk(
    transfer: InternalTransferEntity,
    dto: ConfirmTransferReceiptDto,
    user: ICurrentUser,
  ): Promise<InternalTransferEntity> {
    const list = this.readDiskTransfers();
    const itemMap = new Map(dto.items.map((i) => [i.itemId, i]));
    let hasDiscrepancy = false;

    for (const item of transfer.items) {
      const confirmItem = itemMap.get(item.id) || itemMap.get(item.productId)!;
      const actualReceived = confirmItem.receivedQuantity;
      const discrepancy = item.transferQuantity - actualReceived;
      if (discrepancy !== 0) hasDiscrepancy = true;

      item.receivedQuantity = actualReceived;
      item.baseReceivedQuantity = Math.round(actualReceived * item.conversionRate);
      item.discrepancyQuantity = discrepancy;
      item.discrepancyReason =
        confirmItem.discrepancyReason?.trim() || dto.generalDiscrepancyReason?.trim() || '';

      if (actualReceived > 0) {
        await this.inventoryService.adjustStock(
          {
            productSku: item.sku,
            quantityChange: actualReceived,
            unit: item.unit,
            reason: `Nhập điều chuyển từ ${transfer.fromWarehouseName} (Phiếu ${transfer.code})${item.discrepancyReason ? ` [Lý do chênh lệch: ${item.discrepancyReason}]` : ''}`,
            referenceCode: transfer.code,
            warehouseId: transfer.toWarehouseId,
          },
          user.userId,
        );
      }
    }

    transfer.status = hasDiscrepancy
      ? TransferStatus.PARTIALLY_RECEIVED
      : TransferStatus.COMPLETED;
    transfer.receivedBy = user.userId;
    transfer.receivedByName = user.username || user.email || 'Thủ kho nhận';
    transfer.receivedAt = new Date();
    transfer.discrepancyReason = dto.generalDiscrepancyReason?.trim() || transfer.discrepancyReason;
    transfer.updatedAt = new Date();

    const idx = list.findIndex((t) => t.id === transfer.id);
    if (idx >= 0) {
      list[idx] = transfer;
    } else {
      list.unshift(transfer);
    }
    this.saveDiskTransfers(list);
    return transfer;
  }

  private async cancelInDisk(
    transfer: InternalTransferEntity,
    user: ICurrentUser,
  ): Promise<InternalTransferEntity> {
    const list = this.readDiskTransfers();

    if (transfer.status === TransferStatus.IN_TRANSIT) {
      for (const item of transfer.items) {
        await this.inventoryService.adjustStock(
          {
            productSku: item.sku,
            quantityChange: item.transferQuantity,
            unit: item.unit,
            reason: `Hoàn nhập do hủy phiếu điều chuyển ${transfer.code}`,
            referenceCode: transfer.code,
            warehouseId: transfer.fromWarehouseId,
          },
          user.userId,
        );
      }
    }

    transfer.status = TransferStatus.CANCELLED;
    transfer.updatedAt = new Date();

    const idx = list.findIndex((t) => t.id === transfer.id);
    if (idx >= 0) {
      list[idx] = transfer;
    }
    this.saveDiskTransfers(list);
    return transfer;
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  private mapDbRowToEntity(
    row: InternalTransferDbRow,
    itemRows: InternalTransferItemDbRow[],
  ): InternalTransferEntity {
    return new InternalTransferEntity({
      id: row.id,
      code: row.code,
      fromWarehouseId: row.from_warehouse_id,
      fromWarehouseName: row.from_warehouse_name,
      toWarehouseId: row.to_warehouse_id,
      toWarehouseName: row.to_warehouse_name,
      status: row.status,
      notes: row.notes || '',
      createdBy: row.created_by || '',
      createdByName: row.created_by_name || '',
      transferredAt: row.transferred_at ? new Date(row.transferred_at) : undefined,
      receivedBy: row.received_by || undefined,
      receivedByName: row.received_by_name || undefined,
      receivedAt: row.received_at ? new Date(row.received_at) : undefined,
      discrepancyReason: row.discrepancy_reason || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      items: itemRows.map(
        (i) =>
          new InternalTransferItemEntity({
            id: i.id,
            transferId: i.transfer_id,
            productId: i.product_id,
            sku: i.sku,
            productName: i.product_name,
            unit: i.unit,
            conversionRate: Number(i.conversion_rate) || 1,
            baseUnit: i.base_unit,
            transferQuantity: Number(i.transfer_quantity) || 0,
            baseTransferQuantity: Number(i.base_transfer_quantity) || 0,
            receivedQuantity:
              i.received_quantity !== null && i.received_quantity !== undefined
                ? Number(i.received_quantity)
                : undefined,
            baseReceivedQuantity:
              i.base_received_quantity !== null && i.base_received_quantity !== undefined
                ? Number(i.base_received_quantity)
                : undefined,
            discrepancyQuantity:
              i.discrepancy_quantity !== null && i.discrepancy_quantity !== undefined
                ? Number(i.discrepancy_quantity)
                : 0,
            discrepancyReason: i.discrepancy_reason || '',
            notes: i.notes || '',
            createdAt: new Date(i.created_at),
          }),
      ),
    });
  }

  private async resolveWarehouses(
    fromId: string,
    toId: string,
  ): Promise<{
    fromWarehouse: { id: string; name: string };
    toWarehouse: { id: string; name: string };
  }> {
    const warehouses = await this.warehousesService.findAll();
    const fromWarehouse = warehouses.find(
      (w: { id?: string; code?: string }) => w.id === fromId || w.code === fromId,
    );
    const toWarehouse = warehouses.find(
      (w: { id?: string; code?: string }) => w.id === toId || w.code === toId,
    );

    if (!fromWarehouse) {
      throw new NotFoundException(`Kho xuất hàng với ID "${fromId}" không tồn tại.`);
    }
    if (!toWarehouse) {
      throw new NotFoundException(`Kho nhận hàng với ID "${toId}" không tồn tại.`);
    }

    return {
      fromWarehouse: { id: fromWarehouse.id, name: fromWarehouse.name },
      toWarehouse: { id: toWarehouse.id, name: toWarehouse.name },
    };
  }

  private async prepareTransferItems(
    rawItems: CreateTransferItemDto[],
    fromWarehouseId: string,
    isDraft: boolean,
  ): Promise<InternalTransferItemEntity[]> {
    const stockOverview = await this.inventoryService.getStockOverview(fromWarehouseId);
    const stockMap = new Map(stockOverview.map((s) => [s.sku.toUpperCase(), s]));

    const items: InternalTransferItemEntity[] = [];

    for (const raw of rawItems) {
      const product = await this.productsService.findById(raw.productId);
      const conversion = this.productsService.findUnitConversion(product, raw.unit);
      const baseQty = Math.round(raw.transferQuantity * conversion.conversionRate);

      if (!isDraft) {
        const stockInfo = stockMap.get(product.sku.toUpperCase());
        const available = stockInfo?.availableQuantity ?? 0;
        if (baseQty > available) {
          throw new BadRequestException(
            `Sản phẩm "${product.name}" (${product.sku}) không đủ tồn kho tại kho xuất. Khả dụng: ${available} ${product.baseUnit}, Yêu cầu chuyển: ${baseQty} ${product.baseUnit} (${raw.transferQuantity} ${raw.unit}).`,
          );
        }
      }

      items.push(
        new InternalTransferItemEntity({
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          unit: conversion.unitName,
          conversionRate: conversion.conversionRate,
          baseUnit: product.baseUnit,
          transferQuantity: raw.transferQuantity,
          baseTransferQuantity: baseQty,
          notes: raw.notes?.trim() || '',
        }),
      );
    }

    return items;
  }

  private validateDiscrepancyReasons(
    transfer: InternalTransferEntity,
    dto: ConfirmTransferReceiptDto,
  ): void {
    const itemMap = new Map(dto.items.map((i) => [i.itemId, i]));

    for (const item of transfer.items) {
      const confirmItem = itemMap.get(item.id) || itemMap.get(item.productId);
      if (!confirmItem) {
        throw new BadRequestException(
          `Thiếu số lượng kiểm đếm cho sản phẩm "${item.productName}" (${item.sku}).`,
        );
      }

      const received = confirmItem.receivedQuantity;
      const discrepancy = item.transferQuantity - received;

      if (discrepancy !== 0) {
        const reason =
          confirmItem.discrepancyReason?.trim() || dto.generalDiscrepancyReason?.trim();
        if (!reason) {
          throw new BadRequestException(
            `Mặt hàng "${item.productName}" có chênh lệch ${discrepancy > 0 ? 'thiếu' : 'thừa'} ${Math.abs(discrepancy)} ${item.unit}. Bắt buộc phải nhập lý do chênh lệch!`,
          );
        }
      }
    }
  }

  private generateFallbackCode(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `CK-${yy}${mm}${dd}-${randomSuffix}`;
  }
}
