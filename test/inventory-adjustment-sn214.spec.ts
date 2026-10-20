import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ProductsService } from '../src/modules/products/products.service';
import { DatabaseService } from '../src/database/database.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';

describe('SN-214: Quản lý phiếu điều chỉnh tồn kho có phê duyệt', () => {
  let service: InventoryService;
  let productsService: ProductsService;

  const mockKeeperUser: ICurrentUser = {
    userId: 'usr-keeper-01',
    email: 'thukho1@loha.vn',
    username: 'thukho1',
    roles: [UserRole.WAREHOUSE_KEEPER],
  };

  const mockManagerUser: ICurrentUser = {
    userId: 'usr-manager-01',
    email: 'quanlykho1@loha.vn',
    username: 'quanlykho1',
    roles: [UserRole.WAREHOUSE_MANAGER],
  };

  const mockSalesUser: ICurrentUser = {
    userId: 'usr-sales-01',
    email: 'sales1@loha.vn',
    username: 'sales1',
    roles: [UserRole.SALES_REP],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        ProductsService,
        {
          provide: DatabaseService,
          useValue: {
            isConnected: () => false,
            query: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    productsService = module.get<ProductsService>(ProductsService);
    await service.onModuleInit();
  });

  describe('AC-1 & AC-2: Lập phiếu điều chỉnh với lý do và giá trị tổn thất', () => {
    it('phải tạo phiếu điều chỉnh thành công với lý do DAMAGED, LOST, hoặc EXPIRED và tổng giá trị tổn thất > 0', async () => {
      const allProducts = await productsService.findAll();
      const testProduct = allProducts[0];

      const adj = await service.createStockAdjustment(
        {
          warehouseId: 'WH01',
          warehouseName: 'Kho Tổng Miền Nam',
          reason: 'DAMAGED',
          reasonDetail: 'Bể vỡ trong quá trình bốc xếp hàng hoá',
          totalLossValue: 500000,
          items: [
            {
              productId: testProduct.id,
              productSku: testProduct.sku,
              productName: testProduct.name,
              unit: testProduct.baseUnit || 'Hộp',
              currentStock: testProduct.stockQuantity ?? 100,
              adjustedQuantity: 2,
              unitPrice: 250000,
              lossValue: 500000,
              reason: 'DAMAGED',
            },
          ],
          note: 'Biên bản số 01/BB-SC',
        },
        mockKeeperUser,
      );

      expect(adj).toBeDefined();
      expect(adj.adjustmentCode).toMatch(/^PDC-\d{6}-\d{4}$/);
      expect(adj.status).toBe('PENDING');
      expect(adj.reason).toBe('DAMAGED');
      expect(adj.totalLossValue).toBe(500000);
      expect(adj.creatorId).toBe(mockKeeperUser.userId);
    });

    it('phải ném lỗi BadRequestException nếu thiếu lý do hoặc lý do không hợp lệ', async () => {
      await expect(
        service.createStockAdjustment(
          {
            reason: 'INVALID_REASON' as any,
            totalLossValue: 100000,
            items: [],
          },
          mockKeeperUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('phải ném lỗi BadRequestException nếu danh sách mặt hàng rỗng', async () => {
      await expect(
        service.createStockAdjustment(
          {
            reason: 'LOST',
            totalLossValue: 100000,
            items: [],
          },
          mockKeeperUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('AC-3: Phân quyền duyệt và quy tắc creatorId !== approverId', () => {
    it('phải từ chối phê duyệt (BadRequestException) nếu người duyệt trùng với người lập phiếu', async () => {
      const allProducts = await productsService.findAll();
      const testProduct = allProducts[0];

      // Manager tự tạo phiếu
      const adj = await service.createStockAdjustment(
        {
          warehouseId: 'WH01',
          warehouseName: 'Kho Tổng Miền Nam',
          reason: 'EXPIRED',
          reasonDetail: 'Hết hạn sử dụng lô 01',
          totalLossValue: 300000,
          items: [
            {
              productId: testProduct.id,
              productSku: testProduct.sku,
              productName: testProduct.name,
              unit: 'Hộp',
              currentStock: 50,
              adjustedQuantity: 1,
              unitPrice: 300000,
              lossValue: 300000,
              reason: 'EXPIRED',
            },
          ],
        },
        mockManagerUser, // creatorId = mockManagerUser.userId
      );

      // Cố gắng tự phê duyệt phiếu của chính mình -> Phải bị chặn theo AC-3!
      await expect(
        service.approveStockAdjustment(adj.id, mockManagerUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('phải từ chối phê duyệt (ForbiddenException) nếu người duyệt không có vai trò Quản lý kho / Admin', async () => {
      const allProducts = await productsService.findAll();
      const testProduct = allProducts[0];

      const adj = await service.createStockAdjustment(
        {
          warehouseId: 'WH01',
          warehouseName: 'Kho Tổng Miền Nam',
          reason: 'LOST',
          reasonDetail: 'Thất thoát chưa rõ nguyên nhân',
          totalLossValue: 200000,
          items: [
            {
              productId: testProduct.id,
              productSku: testProduct.sku,
              productName: testProduct.name,
              unit: 'Hộp',
              currentStock: 50,
              adjustedQuantity: 1,
              unitPrice: 200000,
              lossValue: 200000,
              reason: 'LOST',
            },
          ],
        },
        mockKeeperUser,
      );

      // Nhân viên kinh doanh cố duyệt -> Bị chặn
      await expect(
        service.approveStockAdjustment(adj.id, mockSalesUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('phê duyệt thành công khi Quản lý kho duyệt phiếu do Thủ kho lập (creatorId !== approverId)', async () => {
      const allProducts = await productsService.findAll();
      const testProduct = allProducts[0];
      const initialStock = testProduct.stockQuantity ?? 100;

      const adj = await service.createStockAdjustment(
        {
          warehouseId: 'WH01',
          warehouseName: 'Kho Tổng Miền Nam',
          reason: 'DAMAGED',
          reasonDetail: 'Bể chai siro',
          totalLossValue: 120000,
          items: [
            {
              productId: testProduct.id,
              productSku: testProduct.sku,
              productName: testProduct.name,
              unit: 'Chai',
              currentStock: initialStock,
              adjustedQuantity: 2,
              unitPrice: 60000,
              lossValue: 120000,
              reason: 'DAMAGED',
            },
          ],
        },
        mockKeeperUser, // Thủ kho lập
      );

      // Quản lý kho duyệt
      const approved = await service.approveStockAdjustment(adj.id, mockManagerUser);

      expect(approved.status).toBe('APPROVED');
      expect(approved.approverId).toBe(mockManagerUser.userId);
      expect(approved.approvedAt).toBeDefined();

      // Kiểm tra tồn kho đã bị trừ đi 2
      const updatedProduct = await productsService.findById(testProduct.id);
      expect(updatedProduct.stockQuantity).toBe(initialStock - 2);
    });
  });

  describe('AC-4: Ghi nhận Thẻ kho (transactionType: ADJUSTMENT)', () => {
    it('khi phê duyệt phiếu điều chỉnh, hệ thống phải tự động tạo giao dịch Thẻ kho ADJUSTMENT', async () => {
      const allProducts = await productsService.findAll();
      const testProduct = allProducts[0];

      const adj = await service.createStockAdjustment(
        {
          warehouseId: 'WH01',
          warehouseName: 'Kho Tổng Miền Nam',
          reason: 'EXPIRED',
          reasonDetail: 'Thu hồi huỷ hàng hết date',
          totalLossValue: 500000,
          items: [
            {
              productId: testProduct.id,
              productSku: testProduct.sku,
              productName: testProduct.name,
              unit: 'Hộp',
              currentStock: 100,
              adjustedQuantity: 5,
              unitPrice: 100000,
              lossValue: 500000,
              reason: 'EXPIRED',
            },
          ],
        },
        mockKeeperUser,
      );

      await service.approveStockAdjustment(adj.id, mockManagerUser);

      // Kiểm tra Thẻ kho của sản phẩm
      const stockCard = await service.getTransactions({ sku: testProduct.sku });
      const adjustmentTx = stockCard.find(
        (tx: any) => tx.referenceCode === adj.adjustmentCode,
      );

      expect(adjustmentTx).toBeDefined();
      expect(adjustmentTx?.transactionType).toBe('ADJUSTMENT');
      expect(adjustmentTx?.baseQuantityChange).toBe(-5);
      expect(adjustmentTx?.reason).toContain(adj.adjustmentCode);
      expect(adjustmentTx?.reason).toContain('500.000 đ');
    });
  });

  describe('Từ chối phiếu điều chỉnh tồn kho', () => {
    it('Quản lý kho có thể từ chối phiếu với lý do cụ thể', async () => {
      const allProducts = await productsService.findAll();
      const testProduct = allProducts[0];

      const adj = await service.createStockAdjustment(
        {
          warehouseId: 'WH01',
          warehouseName: 'Kho Tổng Miền Nam',
          reason: 'LOST',
          reasonDetail: 'Thất thoát chưa rõ',
          totalLossValue: 100000,
          items: [
            {
              productId: testProduct.id,
              productSku: testProduct.sku,
              productName: testProduct.name,
              unit: 'Hộp',
              currentStock: 50,
              adjustedQuantity: 1,
              unitPrice: 100000,
              lossValue: 100000,
              reason: 'LOST',
            },
          ],
        },
        mockKeeperUser,
      );

      const rejected = await service.rejectStockAdjustment(
        adj.id,
        { rejectReason: 'Chưa đủ căn cứ xác nhận thất thoát, yêu cầu kiểm đếm lại' },
        mockManagerUser,
      );

      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectReason).toBe('Chưa đủ căn cứ xác nhận thất thoát, yêu cầu kiểm đếm lại');
    });
  });
});
