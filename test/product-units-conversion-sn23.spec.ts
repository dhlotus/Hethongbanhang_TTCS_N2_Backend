import { BadRequestException } from '@nestjs/common';
import { ProductStatus } from '../src/common/enums/product-status.enum';
import { UserRole } from '../src/common/enums/user-role.enum';
import { AdjustStockDto } from '../src/modules/inventory/dto/adjust-stock.dto';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { CreateProductDto } from '../src/modules/products/dto/create-product.dto';
import { UpdateProductDto } from '../src/modules/products/dto/update-product.dto';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * BỘ KIỂM THỬ TỰ ĐỘNG USER STORY SN-23 (PARENT: SN-21 - QUẢN LÝ KHO B2B):
 * "Là Nhân viên kho, tôi muốn có đơn vị tính quy đổi đúng theo cách kho đang gọi hàng,
 * để nhập xuất theo thùng mà sổ sách vẫn ghi đúng số lon."
 *
 * 3 TIÊU CHÍ NGHIỆM THU (ACCEPTANCE CRITERIA):
 * 1. Mỗi SKU khai báo được nhiều đơn vị: lon, lốc, thùng kèm hệ số quy đổi về đơn vị cơ sở.
 * 2. Đơn hàng và phiếu kho nhập theo đơn vị nào cũng quy về đơn vị cơ sở khi ghi sổ.
 * 3. Đổi hệ số quy đổi không làm sai lệch các giao dịch đã ghi trước đó (Snapshot bất biến).
 */
describe('[SN-23] Đơn Vị Tính Quy Đổi & Ghi Sổ Kho Chuẩn Đơn Vị Cơ Sở', () => {
  let productsService: ProductsService;
  let inventoryService: InventoryService;

  beforeEach(() => {
    productsService = new ProductsService();
    inventoryService = new InventoryService(productsService);
    inventoryService.onModuleInit();
  });

  describe('1. Khai báo Đơn vị tính quy đổi đa cấp cho SKU (Lon, Lốc, Thùng)', () => {
    it('TC-01: Sản phẩm ban đầu (Seed Data) có sẵn danh sách đơn vị quy đổi chuẩn FMCG', async () => {
      const milk = await productsService.findById('LH-MILK-900G');
      expect(milk).toBeDefined();
      expect(milk.baseUnit).toBe('Lon');
      expect(milk.units).toBeDefined();
      expect(milk.units.length).toBeGreaterThanOrEqual(3);

      const lon = milk.units.find((u) => u.unitName === 'Lon');
      const loc = milk.units.find((u) => u.unitName === 'Lốc');
      const thung = milk.units.find((u) => u.unitName === 'Thùng');

      expect(lon).toBeDefined();
      expect(lon?.conversionRate).toBe(1);
      expect(lon?.isBaseUnit).toBe(true);

      expect(loc).toBeDefined();
      expect(loc?.conversionRate).toBe(6);

      expect(thung).toBeDefined();
      expect(thung?.conversionRate).toBe(24);
    });

    it('TC-02: Tạo mới SKU khai báo nhiều đơn vị quy đổi thành công (baseUnit + conversion units)', async () => {
      const createDto: CreateProductDto = {
        sku: 'TEST-BEER-330ML',
        name: 'Bia Tươi Thượng Hạng Loha Draft 330ml',
        parentCategory: 'Nước giải khát & Trà',
        subCategory: 'Trà thảo mộc thanh nhiệt',
        baseUnit: 'Lon',
        packagingSpec: '24 lon/thùng (4 lốc x 6 lon)',
        price: 22000,
        costPrice: 14000,
        stockQuantity: 100,
        status: ProductStatus.ACTIVE,
        units: [
          { unitName: 'Lon', conversionRate: 1, isBaseUnit: true },
          { unitName: 'Lốc', conversionRate: 6 },
          { unitName: 'Két', conversionRate: 20 },
          { unitName: 'Thùng', conversionRate: 24 },
        ],
      };

      const created = await productsService.create(createDto);
      expect(created.sku).toBe('TEST-BEER-330ML');
      expect(created.units.length).toBe(4);

      const ket = created.units.find((u) => u.unitName === 'Két');
      expect(ket?.conversionRate).toBe(20);
    });

    it('TC-03: Tự động đảm bảo đơn vị cơ sở (baseUnit) luôn có mặt trong units với conversionRate = 1', async () => {
      const createDto: CreateProductDto = {
        sku: 'TEST-JUICE-1L',
        name: 'Nước Ép Cam Tươi Nguyên Chất 1L',
        parentCategory: 'Nước giải khát & Trà',
        baseUnit: 'Chai',
        price: 45000,
        units: [
          { unitName: 'Thùng', conversionRate: 12 }, // không khai báo Chai trong units
        ],
      };

      const created = await productsService.create(createDto);
      expect(created.units.length).toBe(2);

      const base = created.units.find((u) => u.unitName === 'Chai');
      expect(base).toBeDefined();
      expect(base?.conversionRate).toBe(1);
      expect(base?.isBaseUnit).toBe(true);
    });

    it('TC-04: Từ chối tạo SKU nếu có đơn vị quy đổi bị trùng lặp tên', async () => {
      const createDto: CreateProductDto = {
        sku: 'TEST-DUPLICATE-UNIT',
        name: 'Sản phẩm lỗi trùng đơn vị',
        parentCategory: 'Nước giải khát & Trà',
        baseUnit: 'Lon',
        price: 10000,
        units: [
          { unitName: 'Thùng', conversionRate: 24 },
          { unitName: 'Thùng', conversionRate: 30 }, // Trùng tên
        ],
      };

      await expect(productsService.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('TC-05: Từ chối tạo SKU nếu hệ số quy đổi <= 0', async () => {
      const createDto: CreateProductDto = {
        sku: 'TEST-INVALID-RATE',
        name: 'Sản phẩm lỗi hệ số',
        parentCategory: 'Nước giải khát & Trà',
        baseUnit: 'Lon',
        price: 10000,
        units: [
          { unitName: 'Thùng', conversionRate: 0 }, // Lỗi <= 0
        ],
      };

      await expect(productsService.create(createDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('2. Nhập/Xuất kho theo thùng/lốc đều quy về đơn vị cơ sở khi ghi sổ', () => {
    it('TC-06: Nhập kho 5 Thùng (hệ số 24) -> Tồn kho tăng chính xác +120 Lon cơ sở', async () => {
      const sku = 'LH-MILK-900G';
      const initialProduct = await productsService.findById(sku);
      const initialStock = initialProduct.stockQuantity; // 340 Lon

      const adjustDto: AdjustStockDto = {
        productSku: sku,
        quantityChange: 5,
        unit: 'Thùng', // 1 Thùng = 24 Lon
        reason: 'Nhập hàng định kỳ từ nhà phân phối',
        referenceCode: 'PNK-2026-TEST-01',
      };

      const result = await inventoryService.adjustStock(adjustDto, 'wh-keeper-01');

      expect(result.success).toBe(true);
      expect(result.inputQuantity).toBe(5);
      expect(result.inputUnit).toBe('Thùng');
      expect(result.conversionRate).toBe(24);
      expect(result.baseQuantityChange).toBe(120); // 5 * 24 = 120 Lon
      expect(result.baseUnit).toBe('Lon');
      expect(result.previousQuantity).toBe(initialStock);
      expect(result.newQuantity).toBe(initialStock + 120);

      // Kiểm tra thực tế trong ProductsService
      const updatedProduct = await productsService.findById(sku);
      expect(updatedProduct.stockQuantity).toBe(initialStock + 120);
    });

    it('TC-07: Xuất kho 2 Lốc (hệ số 6) -> Tồn kho giảm chính xác -12 Lon cơ sở', async () => {
      const sku = 'LH-TEA-240ML';
      const initialProduct = await productsService.findById(sku);
      const initialStock = initialProduct.stockQuantity; // 890 Lon

      const adjustDto: AdjustStockDto = {
        productSku: sku,
        quantityChange: -2,
        unit: 'Lốc', // 1 Lốc = 6 Lon
        reason: 'Xuất hàng mẫu tiếp thị',
        referenceCode: 'PXK-2026-TEST-02',
      };

      const result = await inventoryService.adjustStock(adjustDto, 'wh-keeper-01');

      expect(result.inputQuantity).toBe(-2);
      expect(result.inputUnit).toBe('Lốc');
      expect(result.conversionRate).toBe(6);
      expect(result.baseQuantityChange).toBe(-12);
      expect(result.newQuantity).toBe(initialStock - 12);

      const updatedProduct = await productsService.findById(sku);
      expect(updatedProduct.stockQuantity).toBe(initialStock - 12);
    });

    it('TC-08: Nếu không truyền unit -> Mặc định là đơn vị cơ sở (conversionRate = 1)', async () => {
      const sku = 'LH-TEA-240ML';
      const initialProduct = await productsService.findById(sku);
      const initialStock = initialProduct.stockQuantity;

      const adjustDto: AdjustStockDto = {
        productSku: sku,
        quantityChange: 15,
        // Không truyền unit
        reason: 'Kiểm kê bù số lẻ',
      };

      const result = await inventoryService.adjustStock(adjustDto, 'wh-keeper-01');

      expect(result.inputUnit).toBe('Lon');
      expect(result.conversionRate).toBe(1);
      expect(result.baseQuantityChange).toBe(15);
      expect(result.newQuantity).toBe(initialStock + 15);
    });

    it('TC-09: Báo lỗi nếu chọn đơn vị không tồn tại trong danh mục của SKU', async () => {
      const adjustDto: AdjustStockDto = {
        productSku: 'LH-MILK-900G',
        quantityChange: 10,
        unit: 'Bao Tải', // Không có đơn vị này
        reason: 'Nhập sai đơn vị',
      };

      await expect(
        inventoryService.adjustStock(adjustDto, 'wh-keeper-01'),
      ).rejects.toThrow(BadRequestException);
    });

    it('TC-10: Ràng buộc chống tồn kho âm tuyệt đối khi xuất vượt quá tồn cơ sở', async () => {
      const sku = 'LH-COLLAGEN-50ML'; // Tồn ban đầu 260 chai, 1 Thùng = 30 chai
      const adjustDto: AdjustStockDto = {
        productSku: sku,
        quantityChange: -10, // 10 Thùng * 30 = 300 chai > 260 chai
        unit: 'Thùng',
        reason: 'Xuất hàng vượt tồn kho',
      };

      await expect(
        inventoryService.adjustStock(adjustDto, 'wh-keeper-01'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('3. Đổi hệ số quy đổi KHÔNG làm sai lệch các giao dịch đã ghi trước đó (Snapshot bất biến)', () => {
    it('TC-11: Bản ghi sổ kho lưu cứng Snapshot conversionRate và baseQuantityChange tại thời điểm phát sinh', async () => {
      const sku = 'LH-MILK-900G';

      // Bước 1: Ghi nhận 1 giao dịch nhập 10 Thùng (hệ số quy đổi lúc này là 24 -> 240 Lon)
      await inventoryService.adjustStock(
        {
          productSku: sku,
          quantityChange: 10,
          unit: 'Thùng',
          reason: 'Giao dịch đợt 1',
          referenceCode: 'PNK-SNAPSHOT-01',
        },
        'wh-keeper-01',
      );

      // Lấy danh sách giao dịch từ sổ kho
      const transactionsBefore = await inventoryService.getTransactions(sku);
      const txOld = transactionsBefore.find((t) => t.referenceCode === 'PNK-SNAPSHOT-01');

      expect(txOld).toBeDefined();
      expect(txOld?.inputQuantity).toBe(10);
      expect(txOld?.inputUnit).toBe('Thùng');
      expect(txOld?.conversionRate).toBe(24);
      expect(txOld?.baseQuantityChange).toBe(240);
      expect(txOld?.baseUnit).toBe('Lon');

      // Bước 2: Doanh nghiệp thay đổi quy cách đóng gói SKU: Sửa 1 Thùng thành 30 Lon (thay vì 24)
      const updateDto: UpdateProductDto = {
        packagingSpec: '30 lon/thùng',
        units: [
          { unitName: 'Lon', conversionRate: 1, isBaseUnit: true },
          { unitName: 'Lốc', conversionRate: 6 },
          { unitName: 'Thùng', conversionRate: 30 }, // Đổi từ 24 -> 30
        ],
      };
      await productsService.update(sku, updateDto);

      // Xác nhận SKU đã đổi hệ số mới
      const updatedProduct = await productsService.findById(sku);
      const thungUnit = updatedProduct.units.find((u) => u.unitName === 'Thùng');
      expect(thungUnit?.conversionRate).toBe(30);

      // Bước 3: Kiểm tra lại giao dịch CŨ trong sổ kho: PHẢI HOÀN TOÀN BẤT BIẾN
      const transactionsAfter = await inventoryService.getTransactions(sku);
      const txOldAfter = transactionsAfter.find((t) => t.referenceCode === 'PNK-SNAPSHOT-01');

      expect(txOldAfter).toBeDefined();
      expect(txOldAfter?.inputQuantity).toBe(10);
      expect(txOldAfter?.conversionRate).toBe(24); // VẪN LÀ 24, KHÔNG BỊ NHẢY THÀNH 30
      expect(txOldAfter?.baseQuantityChange).toBe(240); // VẪN LÀ 240, KHÔNG BỊ NHẢY THÀNH 300

      // Bước 4: Thực hiện giao dịch MỚI với hệ số 30
      const stockBeforeNew = updatedProduct.stockQuantity;
      await inventoryService.adjustStock(
        {
          productSku: sku,
          quantityChange: 2,
          unit: 'Thùng',
          reason: 'Giao dịch đợt 2 theo quy cách mới',
          referenceCode: 'PNK-SNAPSHOT-02',
        },
        'wh-keeper-01',
      );

      const transactionsFinal = await inventoryService.getTransactions(sku);
      const txNew = transactionsFinal.find((t) => t.referenceCode === 'PNK-SNAPSHOT-02');

      expect(txNew).toBeDefined();
      expect(txNew?.inputQuantity).toBe(2);
      expect(txNew?.conversionRate).toBe(30); // Giao dịch mới ăn theo hệ số 30
      expect(txNew?.baseQuantityChange).toBe(60); // 2 * 30 = 60 Lon
      expect(txNew?.newStock).toBe(stockBeforeNew + 60);

      // Giao dịch cũ vẫn nguyên vẹn 240
      const txOldFinal = transactionsFinal.find((t) => t.referenceCode === 'PNK-SNAPSHOT-01');
      expect(txOldFinal?.conversionRate).toBe(24);
      expect(txOldFinal?.baseQuantityChange).toBe(240);
    });
  });
});
