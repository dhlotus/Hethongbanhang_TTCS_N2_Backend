import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
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
import { DEFAULT_WAREHOUSE_ID } from '../warehouses/warehouse.constants';

/**
 * Service quản lý Phiếu Chuyển kho Nội bộ (Internal Warehouse Transfer) - SN-181
 * Tuân thủ quy chuẩn Code Convention & Nghiệp vụ Quản trị Kho Vận
 */
@Injectable()
export class InternalTransfersService implements OnModuleInit {
  private readonly logger = new Logger(InternalTransfersService.name);
  private readonly memoryTransfers = new Map<string, InternalTransferEntity>();

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
    if (this.memoryTransfers.size === 0) {
      await this.seedInitialTransfers();
    }
  }

  /**
   * Khởi tạo bảng dữ liệu PostgreSQL nếu kết nối CSDL đang hoạt động
   */
  private async initDatabaseTables(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;

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
      this.logger.log('Đã khởi tạo bảng CSDL cho Chuyển kho Nội bộ.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Không thể khởi tạo bảng CSDL internal_transfers: ${message}`);
    }
  }

  /**
   * Dữ liệu mẫu chuẩn hóa phục vụ kiểm thử và trải nghiệm người dùng
   */
  private async seedInitialTransfers(): Promise<void> {
    const products = await this.productsService.findAll();
    const milk = products.find((p) => p.sku === 'LH-MILK-900G') || products[0];
    const cereal = products.find((p) => p.sku === 'LH-CEREAL-500G') || products[1] || products[0];
    const nut = products.find((p) => p.sku === 'LH-NUT-180ML') || products[2] || products[0];

    // Phiếu 1: ĐANG TRÊN ĐƯỜNG (IN_TRANSIT) - Để kiểm thử xác nhận nhận hàng
    const sampleTransit = new InternalTransferEntity({
      id: 'itf-seed-001',
      code: 'CK-261011-0001',
      fromWarehouseId: DEFAULT_WAREHOUSE_ID,
      fromWarehouseName: 'Kho Tổng Miền Nam',
      toWarehouseId: '11111111-0000-0000-0000-000000000002',
      toWarehouseName: 'Kho Phân Phối Hà Nội',
      status: TransferStatus.IN_TRANSIT,
      notes: 'Điều chuyển bổ sung hàng dự trữ đợt khuyến mãi miền Bắc',
      createdBy: 'user-001',
      createdByName: 'Nguyễn Văn Kho',
      transferredAt: new Date(Date.now() - 3 * 3600 * 1000),
      createdAt: new Date(Date.now() - 3 * 3600 * 1000),
      items: [
        new InternalTransferItemEntity({
          id: 'iti-001',
          transferId: 'itf-seed-001',
          productId: milk?.id || 'prod-001',
          sku: milk?.sku || 'LH-MILK-900G',
          productName: milk?.name || 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
          unit: 'Thùng',
          conversionRate: 24,
          baseUnit: 'Lon',
          transferQuantity: 10,
          baseTransferQuantity: 240,
        }),
        new InternalTransferItemEntity({
          id: 'iti-002',
          transferId: 'itf-seed-001',
          productId: cereal?.id || 'prod-004',
          sku: cereal?.sku || 'LH-CEREAL-500G',
          productName: cereal?.name || 'Ngũ Cốc Dinh Dưỡng Cao Cấp Loha Cereal 500g',
          unit: 'Thùng',
          conversionRate: 20,
          baseUnit: 'Gói',
          transferQuantity: 15,
          baseTransferQuantity: 300,
        }),
      ],
    });

    // Phiếu 2: ĐÃ HOÀN THÀNH (COMPLETED) - Nhận đủ 100%
    const sampleCompleted = new InternalTransferEntity({
      id: 'itf-seed-002',
      code: 'CK-261010-0002',
      fromWarehouseId: DEFAULT_WAREHOUSE_ID,
      fromWarehouseName: 'Kho Tổng Miền Nam',
      toWarehouseId: '11111111-0000-0000-0000-000000000003',
      toWarehouseName: 'Kho Vùng Tây Nam Bộ',
      status: TransferStatus.COMPLETED,
      notes: 'Cấp hàng định kỳ cho kho Cần Thơ',
      createdBy: 'user-001',
      createdByName: 'Nguyễn Văn Kho',
      transferredAt: new Date(Date.now() - 28 * 3600 * 1000),
      receivedBy: 'user-002',
      receivedByName: 'Trần Thị Nhận',
      receivedAt: new Date(Date.now() - 4 * 3600 * 1000),
      createdAt: new Date(Date.now() - 28 * 3600 * 1000),
      items: [
        new InternalTransferItemEntity({
          id: 'iti-003',
          transferId: 'itf-seed-002',
          productId: nut?.id || 'prod-002',
          sku: nut?.sku || 'LH-NUT-180ML',
          productName: nut?.name || 'Sữa Hạt Óc Chó Nguyên Chất Loha Nut 180ml',
          unit: 'Thùng',
          conversionRate: 48,
          baseUnit: 'Hộp',
          transferQuantity: 20,
          baseTransferQuantity: 960,
          receivedQuantity: 20,
          baseReceivedQuantity: 960,
          discrepancyQuantity: 0,
        }),
      ],
    });

    // Phiếu 3: NHẬN CÓ CHÊNH LỆCH (PARTIALLY_RECEIVED) - Kèm lý do
    const samplePartial = new InternalTransferEntity({
      id: 'itf-seed-003',
      code: 'CK-261009-0003',
      fromWarehouseId: '11111111-0000-0000-0000-000000000002',
      fromWarehouseName: 'Kho Phân Phối Hà Nội',
      toWarehouseId: DEFAULT_WAREHOUSE_ID,
      toWarehouseName: 'Kho Tổng Miền Nam',
      status: TransferStatus.PARTIALLY_RECEIVED,
      notes: 'Hồi chuyển hàng thừa từ kho Hà Nội về kho tổng',
      createdBy: 'user-003',
      createdByName: 'Lê Văn Bắc',
      transferredAt: new Date(Date.now() - 50 * 3600 * 1000),
      receivedBy: 'user-001',
      receivedByName: 'Nguyễn Văn Kho',
      receivedAt: new Date(Date.now() - 20 * 3600 * 1000),
      discrepancyReason: 'Xe chở hàng phanh gấp làm bẹp 2 thùng sữa bột khi dỡ hàng',
      createdAt: new Date(Date.now() - 50 * 3600 * 1000),
      items: [
        new InternalTransferItemEntity({
          id: 'iti-004',
          transferId: 'itf-seed-003',
          productId: milk?.id || 'prod-001',
          sku: milk?.sku || 'LH-MILK-900G',
          productName: milk?.name || 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
          unit: 'Thùng',
          conversionRate: 24,
          baseUnit: 'Lon',
          transferQuantity: 25,
          baseTransferQuantity: 600,
          receivedQuantity: 23,
          baseReceivedQuantity: 552,
          discrepancyQuantity: 2,
          discrepancyReason: 'Bị bẹp móp biến dạng nặng 2 thùng khi vận chuyển, không đạt chuẩn nhập kho',
        }),
      ],
    });

    this.memoryTransfers.set(sampleTransit.id, sampleTransit);
    this.memoryTransfers.set(sampleCompleted.id, sampleCompleted);
    this.memoryTransfers.set(samplePartial.id, samplePartial);
  }

  /**
   * Lấy danh sách phiếu chuyển kho theo bộ lọc
   */
  async findAll(query?: QueryTransfersDto): Promise<InternalTransferEntity[]> {
    let list = Array.from(this.memoryTransfers.values());

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

  /**
   * Xem chi tiết một phiếu chuyển kho
   */
  async findOne(id: string): Promise<InternalTransferEntity> {
    const transfer =
      this.memoryTransfers.get(id) ||
      Array.from(this.memoryTransfers.values()).find((t) => t.code === id);

    if (!transfer) {
      throw new NotFoundException(`Không tìm thấy phiếu chuyển kho với ID hoặc Mã "${id}"`);
    }

    return transfer;
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
    const code = this.generateTransferCode();

    // Chuẩn bị và kiểm tra các dòng mặt hàng
    const items = await this.prepareTransferItems(dto.items, dto.fromWarehouseId, isDraft);

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

    // Nếu không phải bản nháp, thực hiện xuất trừ kho đi
    if (!isDraft) {
      await this.processOutgoingStock(transfer, user.userId);
    }

    this.memoryTransfers.set(transfer.id, transfer);
    return transfer;
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

    // Kiểm tra tính hợp lệ và bắt buộc lý do chênh lệch
    this.validateDiscrepancyReasons(transfer, dto);

    // Tiến hành cộng tồn kho đến theo số lượng thực nhận
    await this.processIncomingStock(transfer, dto, user.userId);

    // Xác định trạng thái hoàn tất
    const hasDiscrepancy = transfer.items.some((item) => (item.discrepancyQuantity ?? 0) !== 0);
    transfer.status = hasDiscrepancy ? TransferStatus.PARTIALLY_RECEIVED : TransferStatus.COMPLETED;
    transfer.receivedBy = user.userId;
    transfer.receivedByName = user.username || user.email || 'Thủ kho nhận';
    transfer.receivedAt = new Date();
    transfer.discrepancyReason = dto.generalDiscrepancyReason?.trim() || transfer.discrepancyReason;
    transfer.updatedAt = new Date();

    this.memoryTransfers.set(transfer.id, transfer);
    return transfer;
  }

  /**
   * Hủy phiếu chuyển kho
   */
  async cancel(id: string, user: ICurrentUser): Promise<InternalTransferEntity> {
    const transfer = await this.findOne(id);

    if (transfer.status === TransferStatus.COMPLETED || transfer.status === TransferStatus.PARTIALLY_RECEIVED) {
      throw new BadRequestException('Không thể hủy phiếu chuyển kho đã hoàn tất nhập hàng.');
    }

    if (transfer.status === TransferStatus.CANCELLED) {
      throw new BadRequestException('Phiếu chuyển kho này đã được hủy trước đó.');
    }

    // Nếu đang trên đường mà bị hủy, hoàn trả lại tồn kho cho kho đi
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
    this.memoryTransfers.set(transfer.id, transfer);
    return transfer;
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS (Tuân thủ nguyên tắc hàm nhỏ gọn, dễ kiểm thử)
  // ===========================================================================

  /**
   * Tra cứu thông tin hợp lệ của 2 kho hàng
   */
  private async resolveWarehouses(
    fromId: string,
    toId: string,
  ): Promise<{ fromWarehouse: { id: string; name: string }; toWarehouse: { id: string; name: string } }> {
    const warehouses = await this.warehousesService.findAll();
    const fromWarehouse = warehouses.find((w) => w.id === fromId || w.code === fromId);
    const toWarehouse = warehouses.find((w) => w.id === toId || w.code === toId);

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

  /**
   * Chuẩn bị dữ liệu mặt hàng chuyển kho và kiểm tra tồn khả dụng kho đi
   */
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

  /**
   * Thực hiện trừ tồn kho tại kho đi và ghi nhận sổ kho
   */
  private async processOutgoingStock(
    transfer: InternalTransferEntity,
    userId: string,
  ): Promise<void> {
    for (const item of transfer.items) {
      await this.inventoryService.adjustStock(
        {
          productSku: item.sku,
          quantityChange: -item.transferQuantity,
          unit: item.unit,
          reason: `Xuất điều chuyển nội bộ sang ${transfer.toWarehouseName}`,
          referenceCode: transfer.code,
          warehouseId: transfer.fromWarehouseId,
        },
        userId,
      );
    }
  }

  /**
   * Kiểm tra ràng buộc lý do chênh lệch khi nhận hàng
   */
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
        const reason = confirmItem.discrepancyReason?.trim() || dto.generalDiscrepancyReason?.trim();
        if (!reason) {
          throw new BadRequestException(
            `Mặt hàng "${item.productName}" có chênh lệch ${discrepancy > 0 ? 'thiếu' : 'thừa'} ${Math.abs(discrepancy)} ${item.unit}. Bắt buộc phải nhập lý do chênh lệch!`,
          );
        }
      }
    }
  }

  /**
   * Cộng tồn kho tại kho đến đúng bằng số lượng thực nhận và ghi sổ kho
   */
  private async processIncomingStock(
    transfer: InternalTransferEntity,
    dto: ConfirmTransferReceiptDto,
    userId: string,
  ): Promise<void> {
    const itemMap = new Map(dto.items.map((i) => [i.itemId, i]));

    for (const item of transfer.items) {
      const confirmItem = itemMap.get(item.id) || itemMap.get(item.productId)!;
      const actualReceived = confirmItem.receivedQuantity;
      const discrepancy = item.transferQuantity - actualReceived;

      item.receivedQuantity = actualReceived;
      item.baseReceivedQuantity = Math.round(actualReceived * item.conversionRate);
      item.discrepancyQuantity = discrepancy;
      item.discrepancyReason =
        confirmItem.discrepancyReason?.trim() || dto.generalDiscrepancyReason?.trim() || '';

      // Chỉ cộng vào kho đến số lượng thực nhận nếu > 0
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
          userId,
        );
      }
    }
  }

  /**
   * Tự động sinh mã phiếu chuyển kho chuẩn (CK-YYMMDD-XXXX)
   */
  private generateTransferCode(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `CK-${yy}${mm}${dd}-`;

    const count = Array.from(this.memoryTransfers.values()).filter((t) =>
      t.code.startsWith(datePrefix),
    ).length;

    return `${datePrefix}${String(count + 1).padStart(4, '0')}`;
  }
}
