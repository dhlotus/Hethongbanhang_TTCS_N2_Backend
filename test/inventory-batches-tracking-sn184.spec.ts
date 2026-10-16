import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ProductsService } from '../src/modules/products/products.service';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';
import { BatchStatusFilter } from '../src/modules/inventory/dto/query-batches.dto';

describe('[SN-184] Theo Dõi Lô & Hạn Sử Dụng Hàng Hóa (FEFO)', () => {
  let inventoryService: InventoryService;
  let productsService: ProductsService;

  const mockWarehouseKeeper: ICurrentUser = {
    userId: 'usr-wh-keeper-01',
    username: 'thukho01',
    email: 'thukho01@loha.vn',
    roles: [UserRole.WAREHOUSE_KEEPER],
  };

  const mockWarehouseManager: ICurrentUser = {
    userId: 'usr-wh-manager-01',
    username: 'quanlykho01',
    email: 'quanlykho01@loha.vn',
    roles: [UserRole.WAREHOUSE_MANAGER],
  };

  const mockAdmin: ICurrentUser = {
    userId: 'usr-admin-01',
    username: 'admin',
    email: 'admin@loha.vn',
    roles: [UserRole.ADMIN],
  };

  const mockSalesRep: ICurrentUser = {
    userId: 'usr-sale-01',
    username: 'salesrep01',
    email: 'salesrep01@loha.vn',
    roles: [UserRole.SALES_REP],
  };

  beforeEach(async () => {
    productsService = new ProductsService();
    await productsService.onModuleInit();

    inventoryService = new InventoryService(productsService);
    await inventoryService.onModuleInit();
  });

  describe('Tiêu chí 1: Bật hoặc tắt quản lý lô theo từng SKU (isBatchManaged)', () => {
    it('TC-01: Sản phẩm mặc định có cờ isBatchManaged = true', async () => {
      const allProducts = await productsService.findAll();
      expect(allProducts.length).toBeGreaterThan(0);
      const firstProduct = allProducts[0];
      expect(firstProduct.isBatchManaged).toBe(true);
      expect(firstProduct.is_batch_managed).toBe(true);
    });

    it('TC-02: Cho phép tạo SKU mới với cờ isBatchManaged = false (tắt quản lý lô)', async () => {
      const newSku = `SKU-NO-BATCH-${Date.now()}`;
      const created = await productsService.create({
        sku: newSku,
        name: 'Sản phẩm không quản lý lô (Văn phòng phẩm)',
        parentCategory: 'Khác',
        subCategory: 'Vật tư',
        baseUnit: 'Cái',
        price: 50000,
        costPrice: 30000,
        isBatchManaged: false,
      });

      expect(created.sku).toBe(newSku);
      expect(created.isBatchManaged).toBe(false);
      expect(created.is_batch_managed).toBe(false);

      const retrieved = await productsService.findById(created.id);
      expect(retrieved.isBatchManaged).toBe(false);
    });

    it('TC-03: Cho phép cập nhật chuyển đổi bật/tắt isBatchManaged trên SKU hiện có', async () => {
      const allProducts = await productsService.findAll();
      const target = allProducts[0];

      const updated = await productsService.update(target.id, {
        isBatchManaged: false,
      });
      expect(updated.isBatchManaged).toBe(false);

      const reUpdated = await productsService.update(target.id, {
        isBatchManaged: true,
      });
      expect(reUpdated.isBatchManaged).toBe(true);
    });
  });

  describe('Tiêu chí 2 & 3: Thông tin chi tiết mỗi lô & Cảnh báo cận hạn theo ngưỡng', () => {
    it('TC-04: Mỗi lô hàng có đầy đủ số lô, NSX, HSD, số lượng tồn và số ngày còn lại', async () => {
      const res = await inventoryService.getBatches({ limit: 50 });
      expect(res.data.length).toBeGreaterThan(0);

      for (const batch of res.data) {
        expect(batch.batchNumber).toBeDefined();
        expect(batch.batchNumber.length).toBeGreaterThan(0);
        expect(batch.expiryDate).toBeDefined();
        expect(typeof batch.quantity).toBe('number');
        expect(typeof batch.availableQuantity).toBe('number');
        expect(typeof batch.daysRemaining).toBe('number');
        expect(['VALID', 'EXPIRING_SOON', 'EXPIRED']).toContain(batch.status);
      }
    });

    it('TC-05: Cảnh báo lô sắp hết hạn và đã hết hạn đúng theo ngưỡng khai báo được (ví dụ 30 ngày vs 60 ngày)', async () => {
      // Khi ngưỡng = 30 ngày
      const res30 = await inventoryService.getBatches({ expiryThresholdDays: 30 });
      const stats30 = await inventoryService.getBatchStats(undefined, 30);

      // Khi ngưỡng = 60 ngày -> các lô có HSD còn lại từ 31 đến 60 ngày sẽ chuyển từ VALID sang EXPIRING_SOON
      const res60 = await inventoryService.getBatches({ expiryThresholdDays: 60 });
      const stats60 = await inventoryService.getBatchStats(undefined, 60);

      expect(stats60.expiringSoonCount).toBeGreaterThanOrEqual(stats30.expiringSoonCount);
      expect(stats60.validCount).toBeLessThanOrEqual(stats30.validCount);
      // Số lô đã hết hạn (daysRemaining < 0) luôn bất biến khi đổi ngưỡng
      expect(stats60.expiredCount).toBe(stats30.expiredCount);
    });

    it('TC-06: Sắp xếp danh sách lô hàng theo thứ tự ưu tiên FEFO (First Expired, First Out)', async () => {
      const res = await inventoryService.getBatches({ limit: 20 });
      for (let i = 0; i < res.data.length - 1; i++) {
        const currentExp = new Date(res.data[i].expiryDate).getTime();
        const nextExp = new Date(res.data[i + 1].expiryDate).getTime();
        expect(currentExp).toBeLessThanOrEqual(nextExp);
      }
    });

    it('TC-07: Hỗ trợ lọc danh sách theo trạng thái VALID, EXPIRING_SOON, EXPIRED', async () => {
      const expiredBatches = await inventoryService.getBatches({ status: BatchStatusFilter.EXPIRED });
      for (const b of expiredBatches.data) {
        expect(b.status).toBe('EXPIRED');
        expect(b.daysRemaining).toBeLessThan(0);
      }

      const expiringSoonBatches = await inventoryService.getBatches({
        status: BatchStatusFilter.EXPIRING_SOON,
        expiryThresholdDays: 30,
      });
      for (const b of expiringSoonBatches.data) {
        expect(b.status).toBe('EXPIRING_SOON');
        expect(b.daysRemaining).toBeGreaterThanOrEqual(0);
        expect(b.daysRemaining).toBeLessThanOrEqual(30);
      }
    });
  });

  describe('Tiêu chí 4: Kiểm soát xuất kho & Ghi đè Quản lý đối với lô quá hạn', () => {
    it('TC-08: Chặn xuất lô hàng đã quá hạn nếu không có lý do ghi đè', async () => {
      const expiredList = await inventoryService.getBatches({ status: BatchStatusFilter.EXPIRED });
      expect(expiredList.data.length).toBeGreaterThan(0);
      const expiredBatch = expiredList.data[0];

      await expect(
        inventoryService.checkBatchDispatch(
          {
            batchId: expiredBatch.id,
            quantity: 10,
          },
          mockWarehouseKeeper,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-09: Từ chối nếu nhân viên không phải Quản lý kho (ví dụ Sales Rep hoặc Thủ kho) cố tình ghi đè xuất lô quá hạn', async () => {
      const expiredList = await inventoryService.getBatches({ status: BatchStatusFilter.EXPIRED });
      const expiredBatch = expiredList.data[0];

      await expect(
        inventoryService.checkBatchDispatch(
          {
            batchId: expiredBatch.id,
            quantity: 10,
            managerOverrideReason: 'Xuất hàng thanh lý gấp',
          },
          mockSalesRep,
        ),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        inventoryService.checkBatchDispatch(
          {
            batchId: expiredBatch.id,
            quantity: 10,
            managerOverrideReason: 'Xuất hàng thanh lý gấp',
          },
          mockWarehouseKeeper,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('TC-10: Cho phép Quản lý kho (Warehouse Manager) hoặc Admin xác nhận ghi đè kèm lý do để xuất lô quá hạn', async () => {
      const expiredList = await inventoryService.getBatches({ status: BatchStatusFilter.EXPIRED });
      const expiredBatch = expiredList.data[0];
      const reason = 'Xuất hàng trả nhà cung cấp và xử lý tiêu hủy';

      const result = await inventoryService.checkBatchDispatch(
        {
          batchId: expiredBatch.id,
          quantity: 10,
          managerOverrideReason: reason,
        },
        mockWarehouseManager,
      );

      expect(result.allowed).toBe(true);
      expect(result.isOverridden).toBe(true);
      expect(result.overrideReason).toBe(reason);
      expect(result.warning).toBeDefined();

      // Admin cũng có quyền ghi đè
      const adminResult = await inventoryService.checkBatchDispatch(
        {
          batchId: expiredBatch.id,
          quantity: 5,
          managerOverrideReason: 'Phê duyệt xuất kiểm nghiệm mẫu',
        },
        mockAdmin,
      );
      expect(adminResult.allowed).toBe(true);
      expect(adminResult.isOverridden).toBe(true);
    });

    it('TC-11: Lô hàng còn hạn hợp lệ (VALID) được phép xuất kho bình thường không cần ghi đè', async () => {
      const validList = await inventoryService.getBatches({ status: BatchStatusFilter.VALID });
      expect(validList.data.length).toBeGreaterThan(0);
      const validBatch = validList.data[0];

      const result = await inventoryService.checkBatchDispatch(
        {
          batchId: validBatch.id,
          quantity: 10,
        },
        mockWarehouseKeeper,
      );

      expect(result.allowed).toBe(true);
      expect(result.isOverridden).toBe(false);
      expect(result.status).toBe('VALID');
    });
  });
});
