import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ProductsService } from '../src/modules/products/products.service';
import { DatabaseService } from '../src/database/database.service';
import { InventoryAuditStatus } from '../src/modules/inventory/entities/inventory-audit-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';

describe('SN-182: Quản lý kiểm kê kho hàng (Warehouse Audit)', () => {
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

  describe('AC1: Tạo phiếu kiểm kê theo kho hoặc nhóm hàng', () => {
    it('phải tạo phiếu kiểm kê với trạng thái DRAFT và chốt số lượng tồn sổ sách (bookQuantity)', async () => {
      const allProducts = await productsService.findAll();
      expect(allProducts.length).toBeGreaterThan(0);

      const audit = await service.createAudit(
        {
          warehouseId: 'WH01',
          warehouseName: 'Kho Tổng Miền Nam - LOHA WH01',
          scope: 'ALL',
          note: 'Kiểm kê toàn bộ kho định kỳ quý 4',
        },
        mockKeeperUser,
      );

      expect(audit).toBeDefined();
      expect(audit.id).toBeDefined();
      expect(audit.auditCode).toMatch(/^PKK-/);
      expect(audit.status).toBe(InventoryAuditStatus.DRAFT);
      expect(audit.items.length).toBe(allProducts.length);

      // Kiểm tra bookQuantity được chốt đúng với tồn hiện tại của sản phẩm
      const firstProduct = allProducts[0];
      const auditItem = audit.items.find((i) => i.productId === firstProduct.id);
      expect(auditItem).toBeDefined();
      expect(auditItem?.bookQuantity).toBe(firstProduct.stockQuantity ?? 0);
      expect(auditItem?.actualQuantity).toBeNull();
      expect(auditItem?.difference).toBe(0);
    });

    it('hỗ trợ tạo phiếu kiểm kê theo nhóm hàng (CATEGORY)', async () => {
      const audit = await service.createAudit(
        {
          warehouseId: 'WH01',
          scope: 'CATEGORY',
          categoryName: 'Sữa Bột',
          note: 'Kiểm kê chuyên đề nhóm Sữa bột',
        },
        mockKeeperUser,
      );

      expect(audit).toBeDefined();
      expect(audit.scope).toBe('CATEGORY');
      expect(audit.items.length).toBeGreaterThan(0);
      expect(
        audit.items.every(
          (i) =>
            (i.categoryName || '').toLowerCase().includes('sữa') ||
            (i.categoryName || '').toLowerCase().includes('bột'),
        ),
      ).toBeTruthy();
    });
  });

  describe('AC2: Nhập số đếm thực tế và tính chênh lệch', () => {
    it('tự động tính chênh lệch từng dòng (difference = actualQuantity - bookQuantity) và giá trị chênh lệch', async () => {
      const audit = await service.createAudit(
        {
          warehouseId: 'WH01',
          scope: 'ALL',
        },
        mockKeeperUser,
      );

      const item1 = audit.items[0];
      const bookQty1 = item1.bookQuantity;
      const actualQty1 = bookQty1 + 5; // Dư 5

      const item2 = audit.items[1];
      const bookQty2 = item2.bookQuantity;
      const actualQty2 = Math.max(0, bookQty2 - 3); // Hao hụt 3

      const updatedAudit = await service.updateAuditItems(
        audit.id,
        {
          items: [
            {
              productId: item1.productId,
              actualQuantity: actualQty1,
              note: 'Tìm thấy thêm 5 sản phẩm ở kệ B3',
            },
            {
              productId: item2.productId,
              actualQuantity: actualQty2,
              note: 'Hao hụt vỡ hỏng 3 sản phẩm',
            },
          ],
        },
        mockKeeperUser,
      );

      const updatedItem1 = updatedAudit.items.find((i) => i.productId === item1.productId);
      const updatedItem2 = updatedAudit.items.find((i) => i.productId === item2.productId);

      expect(updatedItem1?.actualQuantity).toBe(actualQty1);
      expect(updatedItem1?.difference).toBe(5);
      expect(updatedItem1?.differenceAmount).toBe(5 * (updatedItem1?.unitPrice || 0));
      expect(updatedItem1?.note).toBe('Tìm thấy thêm 5 sản phẩm ở kệ B3');

      expect(updatedItem2?.actualQuantity).toBe(actualQty2);
      expect(updatedItem2?.difference).toBe(actualQty2 - bookQty2);
      expect(updatedItem2?.note).toBe('Hao hụt vỡ hỏng 3 sản phẩm');
    });

    it('chặn cập nhật số đếm nếu phiếu kiểm kê không còn ở trạng thái DRAFT', async () => {
      const audit = await service.createAudit({ warehouseId: 'WH01' }, mockKeeperUser);
      await service.cancelAudit(audit.id, 'Hủy kiểm kê do đổi lịch');

      await expect(
        service.updateAuditItems(
          audit.id,
          { items: [{ productId: audit.items[0].productId, actualQuantity: 10 }] },
          mockKeeperUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('AC3: Chốt kiểm kê điều chỉnh tồn về số thực đếm & Ghi sổ kho', () => {
    it('bắt buộc nhập lý do điều chỉnh khi chốt phiếu kiểm kê', async () => {
      const audit = await service.createAudit({ warehouseId: 'WH01' }, mockKeeperUser);

      await expect(
        service.completeAudit(
          audit.id,
          { reason: '' }, // Thiếu lý do
          mockManagerUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('cập nhật tồn kho sản phẩm về actualQuantity và ghi sổ kho giao dịch ADJUSTMENT khi Quản lý kho chốt', async () => {
      const audit = await service.createAudit({ warehouseId: 'WH01' }, mockKeeperUser);
      const itemToAdjust = audit.items[0];
      const targetProduct = await productsService.findById(itemToAdjust.productId);
      const initialStock = targetProduct.stockQuantity ?? 0;
      const actualStock = initialStock + 10; // Chênh lệch +10

      // Nhập số đếm thực tế
      await service.updateAuditItems(
        audit.id,
        {
          items: [{ productId: itemToAdjust.productId, actualQuantity: actualStock }],
        },
        mockKeeperUser,
      );

      // Quản lý kho chốt phiếu
      const completedAudit = await service.completeAudit(
        audit.id,
        {
          reason: 'Điều chỉnh tồn kho theo biên bản kiểm kê quý 4',
          note: 'Đã được phê duyệt bởi Ban Giám Đốc',
        },
        mockManagerUser,
      );

      expect(completedAudit.status).toBe(InventoryAuditStatus.COMPLETED);
      expect(completedAudit.completedById).toBe(mockManagerUser.userId);
      expect(completedAudit.reason).toBe('Điều chỉnh tồn kho theo biên bản kiểm kê quý 4');

      // Kiểm tra sản phẩm đã được cập nhật về actualStock
      const updatedProduct = await productsService.findById(itemToAdjust.productId);
      expect(updatedProduct.stockQuantity).toBe(actualStock);

      // Kiểm tra sổ kho đã ghi giao dịch ADJUSTMENT
      const transactions = await service.getTransactions(targetProduct.sku);
      const adjustmentTx = transactions.find(
        (t) => t.referenceCode === completedAudit.auditCode && t.transactionType === 'ADJUSTMENT',
      );
      expect(adjustmentTx).toBeDefined();
      expect(adjustmentTx?.baseQuantityChange).toBe(10);
      expect(adjustmentTx?.previousStock).toBe(initialStock);
      expect(adjustmentTx?.newStock).toBe(actualStock);
      expect(adjustmentTx?.reason).toContain('Điều chỉnh tồn kho theo biên bản kiểm kê quý 4');
    });
  });

  describe('AC4: Phân quyền chặt chẽ Quản lý kho vs Thủ kho vs Vai trò khác', () => {
    it('từ chối Thủ kho (WAREHOUSE_KEEPER) chốt phiếu kiểm kê với lỗi ForbiddenException (403)', async () => {
      const audit = await service.createAudit({ warehouseId: 'WH01' }, mockKeeperUser);

      await expect(
        service.completeAudit(
          audit.id,
          { reason: 'Thủ kho tự ý chốt phiếu' },
          mockKeeperUser, // Role WAREHOUSE_KEEPER
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('từ chối vai trò không phận sự (SALES_REP) chốt phiếu kiểm kê với lỗi ForbiddenException (403)', async () => {
      const audit = await service.createAudit({ warehouseId: 'WH01' }, mockKeeperUser);

      await expect(
        service.completeAudit(
          audit.id,
          { reason: 'Sales cố ý chốt' },
          mockSalesUser, // Role SALES_REP
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('cho phép Quản trị viên (ADMIN) và Quản lý kho (WH_MANAGER / WAREHOUSE_MANAGER) chốt phiếu kiểm kê', async () => {
      const audit1 = await service.createAudit({ warehouseId: 'WH01' }, mockKeeperUser);
      const adminUser: ICurrentUser = {
        userId: 'usr-admin-01',
        email: 'admin@loha.vn',
        username: 'admin',
        roles: [UserRole.ADMIN],
      };

      const resAdmin = await service.completeAudit(
        audit1.id,
        { reason: 'Admin phê duyệt kiểm kê' },
        adminUser,
      );
      expect(resAdmin.status).toBe(InventoryAuditStatus.COMPLETED);

      const audit2 = await service.createAudit({ warehouseId: 'WH01' }, mockKeeperUser);
      const whManagerUser: ICurrentUser = {
        userId: 'usr-wh-manager-02',
        email: 'wh_manager@loha.vn',
        username: 'wh_manager',
        roles: [UserRole.WH_MANAGER],
      };

      const resManager = await service.completeAudit(
        audit2.id,
        { reason: 'WH Manager phê duyệt kiểm kê' },
        whManagerUser,
      );
      expect(resManager.status).toBe(InventoryAuditStatus.COMPLETED);
    });
  });
});
