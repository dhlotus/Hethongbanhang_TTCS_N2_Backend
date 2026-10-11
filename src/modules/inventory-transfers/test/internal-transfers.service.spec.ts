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

describe('InternalTransfersService (SN-181)', () => {
  let service: InternalTransfersService;
  let inventoryServiceMock: Partial<InventoryService>;
  let productsServiceMock: Partial<ProductsService>;
  let warehousesServiceMock: Partial<WarehousesService>;
  let databaseServiceMock: Partial<DatabaseService>;

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
    databaseServiceMock = {
      isConnected: jest.fn().mockReturnValue(false),
      query: jest.fn().mockResolvedValue([]),
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
