import { Test, TestingModule } from '@nestjs/testing';
import { InternalTransfersService } from '../internal-transfers.service';
import { DatabaseService } from '../../../database/database.service';
import { InventoryService } from '../../inventory/inventory.service';
import { ProductsService } from '../../products/products.service';
import { WarehousesService } from '../../warehouses/warehouses.service';
import { TransferStatus } from '../entities/transfer-status.enum';
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../../../common/enums/user-role.enum';
import { ICurrentUser } from '../../auth/interfaces/current-user.interface';
import { PoolClient } from 'pg';

describe('InternalTransfersService (SN-181)', () => {
  let service: InternalTransfersService;
  let inventoryServiceMock: Partial<InventoryService>;
  let productsServiceMock: Partial<ProductsService>;
  let warehousesServiceMock: Partial<WarehousesService>;
  let databaseServiceMock: Partial<DatabaseService>;
  let mockClient: Partial<PoolClient>;

  const mockUser: ICurrentUser = {
    userId: 'user-001',
    email: 'kho@loha.vn',
    username: 'thukho',
    roles: [UserRole.WAREHOUSE_KEEPER],
  };

  const mockWarehouses = [
    {
      id: 'wh-1',
      code: 'KHO-01',
      name: 'Kho Đi (Tổng)',
      address: 'Bình Dương',
      phone: '0123456789',
      managerId: null,
      status: 'ACTIVE' as const,
      locationCount: 1,
    },
    {
      id: 'wh-2',
      code: 'KHO-02',
      name: 'Kho Đến (Hà Nội)',
      address: 'Hà Nội',
      phone: '0987654321',
      managerId: null,
      status: 'ACTIVE' as const,
      locationCount: 1,
    },
  ];

  const mockProduct = {
    id: 'prod-001',
    sku: 'LH-MILK-900G',
    name: 'Sữa Bột Loha Gold 900g',
    baseUnit: 'Lon',
    stockQuantity: 500,
    units: [{ unitName: 'Thùng', conversionRate: 24, isBaseUnit: false }],
  };

  beforeEach(async () => {
    // Lưu trữ các bản ghi mock mô phỏng bảng database
    const storedTransfers = new Map<string, any>();
    const storedItems = new Map<string, any[]>();

    mockClient = {
      query: jest.fn().mockImplementation(async (text: string, params?: any[]) => {
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [] };
        }

        if (text.includes("SELECT 'CK-'")) {
          return { rows: [{ next_code: 'CK-261012-0001' }] };
        }

        if (text.includes('INSERT INTO internal_transfers')) {
          const row = {
            id: 'itf-test-001',
            code: params?.[0] || 'CK-261012-0001',
            from_warehouse_id: params?.[1],
            from_warehouse_name: params?.[2],
            to_warehouse_id: params?.[3],
            to_warehouse_name: params?.[4],
            status: params?.[5],
            notes: params?.[6],
            created_by: params?.[7],
            created_by_name: params?.[8],
            transferred_at: params?.[9] || new Date(),
            received_by: null,
            received_by_name: null,
            received_at: null,
            discrepancy_reason: null,
            created_at: new Date(),
            updated_at: new Date(),
          };
          storedTransfers.set(row.id, row);
          return { rows: [row] };
        }

        if (text.includes('INSERT INTO internal_transfer_items')) {
          const itemRow = {
            id: 'iti-test-001',
            transfer_id: params?.[0],
            product_id: params?.[1],
            sku: params?.[2],
            product_name: params?.[3],
            unit: params?.[4],
            conversion_rate: params?.[5],
            base_unit: params?.[6],
            transfer_quantity: params?.[7],
            base_transfer_quantity: params?.[8],
            received_quantity: null,
            base_received_quantity: null,
            discrepancy_quantity: 0,
            discrepancy_reason: null,
            notes: params?.[9],
            created_at: new Date(),
          };
          const list = storedItems.get(itemRow.transfer_id) || [];
          list.push(itemRow);
          storedItems.set(itemRow.transfer_id, list);
          return { rows: [itemRow] };
        }

        if (text.includes('UPDATE internal_transfer_items')) {
          const actualReceived = params?.[0];
          const baseReceived = params?.[1];
          const discrepancy = params?.[2];
          const reason = params?.[3];
          const itemId = params?.[4];
          for (const list of storedItems.values()) {
            const item = list.find((i) => i.id === itemId);
            if (item) {
              item.received_quantity = actualReceived;
              item.base_received_quantity = baseReceived;
              item.discrepancy_quantity = discrepancy;
              item.discrepancy_reason = reason;
            }
          }
          return { rows: [] };
        }

        if (text.includes('UPDATE internal_transfers')) {
          const transfer = storedTransfers.get(params?.[4]);
          if (transfer) {
            transfer.status = params?.[0];
            transfer.received_by = params?.[1];
            transfer.received_by_name = params?.[2];
            transfer.discrepancy_reason = params?.[3];
            transfer.received_at = new Date();
          }
          return { rows: [transfer] };
        }

        if (text.includes('SELECT * FROM internal_transfer_items')) {
          const transferId = params?.[0];
          return { rows: storedItems.get(transferId) || [] };
        }

        return { rows: [] };
      }),
      release: jest.fn(),
    };

    databaseServiceMock = {
      isConnected: jest.fn().mockReturnValue(true),
      getClient: jest.fn().mockResolvedValue(mockClient as PoolClient),
      query: jest.fn().mockImplementation(async (text: string, params?: any[]) => {
        if (text.includes('SELECT * FROM internal_transfers')) {
          const id = params?.[0];
          const transfer = storedTransfers.get(id);
          return transfer ? [transfer] : [];
        }
        if (text.includes('SELECT * FROM internal_transfer_items')) {
          const id = params?.[0];
          return storedItems.get(id) || [];
        }
        return [];
      }),
    };

    warehousesServiceMock = {
      findAll: jest.fn().mockResolvedValue(mockWarehouses),
    };

    productsServiceMock = {
      findAll: jest.fn().mockResolvedValue([mockProduct]),
      findById: jest.fn().mockResolvedValue(mockProduct),
      findUnitConversion: jest.fn().mockReturnValue({
        unitName: 'Thùng',
        conversionRate: 24,
      }),
    };

    inventoryServiceMock = {
      getStockOverview: jest.fn().mockResolvedValue([
        {
          sku: 'LH-MILK-900G',
          availableQuantity: 240, // Đủ cho 10 Thùng
          physicalQuantity: 240,
          reservedQuantity: 0,
        },
      ]),
      adjustStock: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InternalTransfersService,
        { provide: DatabaseService, useValue: databaseServiceMock },
        { provide: InventoryService, useValue: inventoryServiceMock },
        { provide: ProductsService, useValue: productsServiceMock },
        { provide: WarehousesService, useValue: warehousesServiceMock },
      ],
    }).compile();

    service = module.get<InternalTransfersService>(InternalTransfersService);
    await service.onModuleInit();
  });

  it('1. Chặn chuyển kho nếu Kho đi và Kho đến trùng nhau', async () => {
    await expect(
      service.create(
        {
          fromWarehouseId: 'wh-1',
          toWarehouseId: 'wh-1',
          items: [{ productId: 'prod-001', unit: 'Thùng', transferQuantity: 2 }],
        },
        mockUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('2. Chặn xuất chuyển kho nếu số lượng vượt quá tồn khả dụng kho đi', async () => {
    // Kho đi chỉ có khả dụng 240 lon (10 Thùng), yêu cầu chuyển 15 Thùng (360 lon)
    await expect(
      service.create(
        {
          fromWarehouseId: 'wh-1',
          toWarehouseId: 'wh-2',
          items: [{ productId: 'prod-001', unit: 'Thùng', transferQuantity: 15 }],
        },
        mockUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('3. Khi lập phiếu xuất chuyển (IN_TRANSIT): trừ tồn kho đi, hàng đang trên đường CHƯA cộng kho đến', async () => {
    const transfer = await service.create(
      {
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [{ productId: 'prod-001', unit: 'Thùng', transferQuantity: 5 }],
      },
      mockUser,
    );

    expect(transfer.status).toBe(TransferStatus.IN_TRANSIT);
    expect(transfer.items[0].transferQuantity).toBe(5);
    expect(transfer.items[0].baseTransferQuantity).toBe(120);

    // Kiểm tra kho đi bị trừ tồn kho
    expect(inventoryServiceMock.adjustStock).toHaveBeenCalledWith(
      expect.objectContaining({
        productSku: 'LH-MILK-900G',
        quantityChange: -5,
        warehouseId: 'wh-1',
      }),
      mockUser.userId,
    );

    // Kho đến TUYỆT ĐỐI CHƯA được gọi cộng tồn kho
    expect(inventoryServiceMock.adjustStock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: 'wh-2',
      }),
      expect.anything(),
    );
  });

  it('4. Kho đến xác nhận nhận có chênh lệch mà không nhập lý do -> Bắt buộc báo lỗi', async () => {
    const transfer = await service.create(
      {
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [{ productId: 'prod-001', unit: 'Thùng', transferQuantity: 5 }],
      },
      mockUser,
    );

    const itemId = transfer.items[0].id;

    // Chuyển 5 Thùng nhưng thực nhận chỉ 4 Thùng và để trống lý do
    await expect(
      service.confirmReceipt(
        transfer.id,
        {
          items: [
            {
              itemId,
              receivedQuantity: 4,
              discrepancyReason: '', // Không nhập lý do
            },
          ],
        },
        mockUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('5. Kho đến xác nhận có chênh lệch KÈM LÝ DO -> Chỉ cộng đúng tồn thực nhận và trạng thái PARTIALLY_RECEIVED', async () => {
    const transfer = await service.create(
      {
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [{ productId: 'prod-001', unit: 'Thùng', transferQuantity: 5 }],
      },
      mockUser,
    );

    const itemId = transfer.items[0].id;
    (inventoryServiceMock.adjustStock as jest.Mock).mockClear();

    const updated = await service.confirmReceipt(
      transfer.id,
      {
        items: [
          {
            itemId,
            receivedQuantity: 4,
            discrepancyReason: 'Vỡ bẹp 1 thùng trên đường',
          },
        ],
      },
      mockUser,
    );

    expect(updated.status).toBe(TransferStatus.PARTIALLY_RECEIVED);
    expect(updated.items[0].receivedQuantity).toBe(4);
    expect(updated.items[0].discrepancyQuantity).toBe(1);
    expect(updated.items[0].discrepancyReason).toBe('Vỡ bẹp 1 thùng trên đường');

    // Tồn kho đến được cộng đúng 4 thùng thực nhận
    expect(inventoryServiceMock.adjustStock).toHaveBeenCalledWith(
      expect.objectContaining({
        productSku: 'LH-MILK-900G',
        quantityChange: 4,
        warehouseId: 'wh-2',
      }),
      mockUser.userId,
    );
  });

  it('6. Kho đến xác nhận nhận đủ 100% -> Tồn kho đến được cộng đủ và trạng thái COMPLETED', async () => {
    const transfer = await service.create(
      {
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [{ productId: 'prod-001', unit: 'Thùng', transferQuantity: 5 }],
      },
      mockUser,
    );

    const itemId = transfer.items[0].id;
    (inventoryServiceMock.adjustStock as jest.Mock).mockClear();

    const updated = await service.confirmReceipt(
      transfer.id,
      {
        items: [
          {
            itemId,
            receivedQuantity: 5,
          },
        ],
      },
      mockUser,
    );

    expect(updated.status).toBe(TransferStatus.COMPLETED);
    expect(updated.items[0].receivedQuantity).toBe(5);
    expect(updated.items[0].discrepancyQuantity).toBe(0);

    // Tồn kho đến được cộng đủ 5 thùng
    expect(inventoryServiceMock.adjustStock).toHaveBeenCalledWith(
      expect.objectContaining({
        productSku: 'LH-MILK-900G',
        quantityChange: 5,
        warehouseId: 'wh-2',
      }),
      mockUser.userId,
    );
  });
});
