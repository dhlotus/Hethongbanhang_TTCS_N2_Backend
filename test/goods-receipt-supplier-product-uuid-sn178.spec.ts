import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { validate } from 'class-validator';
import { CreateGoodsReceiptDto, CreateGoodsReceiptItemDto } from '../src/modules/inventory-receipts/dto/create-goods-receipt.dto';
import { GoodsReceiptsService } from '../src/modules/inventory-receipts/goods-receipts.service';
import { DatabaseService } from '../src/database/database.service';
import { DEFAULT_WAREHOUSE_ID } from '../src/modules/warehouses/warehouse.constants';
import { UserRole } from '../src/common/enums/user-role.enum';
import { ICurrentUser } from '../src/modules/auth/interfaces/current-user.interface';

async function runTest() {
  console.log('=== KIỂM THỬ VALIDATION UUID SUPPLIER_ID & PRODUCT_ID (SN-178) ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      if (detail) console.log(`   └─ ${detail}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName}`);
      if (detail) console.error(`   └─ ${detail}`);
      failed++;
    }
  }

  const VALID_SUPPLIER_UUID = '22222222-0000-0000-0000-000000000001';
  const VALID_PRODUCT_UUID = '33333333-0000-0000-0000-000000000001';

  // 1. DTO Validation: supplierId là UUID hợp lệ + items[0].productId là UUID hợp lệ
  const validDto = new CreateGoodsReceiptDto();
  validDto.warehouseId = DEFAULT_WAREHOUSE_ID;
  validDto.supplierId = VALID_SUPPLIER_UUID;
  validDto.items = [
    Object.assign(new CreateGoodsReceiptItemDto(), {
      productId: VALID_PRODUCT_UUID,
      unitId: 'unit-01',
      packageQuantity: 20,
      conversionFactor: 1,
      unitCost: 15000,
    }),
  ];
  const validErrors = await validate(validDto);
  assert(
    validErrors.length === 0,
    'CreateGoodsReceiptDto chấp nhận supplierId và productId là UUID v4 hợp lệ',
    `Số lỗi validate: ${validErrors.length}`,
  );

  // 2. DTO Validation: supplierId dạng code 'NCC-BEV-01' bị chặn với message đúng đặc tả
  const invalidSupDto = new CreateGoodsReceiptDto();
  invalidSupDto.warehouseId = DEFAULT_WAREHOUSE_ID;
  invalidSupDto.supplierId = 'NCC-BEV-01';
  invalidSupDto.items = [
    Object.assign(new CreateGoodsReceiptItemDto(), {
      productId: VALID_PRODUCT_UUID,
      unitId: 'unit-01',
      packageQuantity: 10,
      conversionFactor: 1,
    }),
  ];
  const supErrors = await validate(invalidSupDto);
  const supError = supErrors.find((e) => e.property === 'supplierId');
  assert(
    Boolean(supError && supError.constraints?.isUuid?.includes('supplierId phải là định dạng UUID hợp lệ')),
    'CreateGoodsReceiptDto chặn supplier.code với message "supplierId phải là định dạng UUID hợp lệ"',
    `Lỗi nhận được: ${JSON.stringify(supError?.constraints)}`,
  );

  // 3. DTO Validation: productId dạng code 'prod-001' / 'LH-MILK-900G' bị chặn với message đúng đặc tả
  const invalidProdDto = new CreateGoodsReceiptDto();
  invalidProdDto.warehouseId = DEFAULT_WAREHOUSE_ID;
  invalidProdDto.supplierId = VALID_SUPPLIER_UUID;
  invalidProdDto.items = [
    Object.assign(new CreateGoodsReceiptItemDto(), {
      productId: 'prod-001',
      unitId: 'unit-01',
      packageQuantity: 10,
      conversionFactor: 1,
    }),
  ];
  const prodErrors = await validate(invalidProdDto);
  const itemErr = prodErrors.find((e) => e.property === 'items');
  const prodErr = itemErr?.children?.[0]?.children?.find((c) => c.property === 'productId');
  assert(
    Boolean(prodErr && prodErr.constraints?.isUuid?.includes('productId phải là định dạng UUID hợp lệ')),
    'CreateGoodsReceiptItemDto chặn product.code/sku với message "productId phải là định dạng UUID hợp lệ"',
    `Lỗi nhận được: ${JSON.stringify(prodErr?.constraints)}`,
  );

  // 4. Database Integration: Tạo phiếu với UUID chuẩn và xác nhận thành công
  const dbService = new DatabaseService();
  await dbService.onModuleInit();
  const service = new GoodsReceiptsService(dbService);
  await service.onModuleInit();

  const mockUser: ICurrentUser = {
    userId: '00000000-0000-0000-0000-000000000004',
    username: 'warehouse_keeper',
    email: 'warehouse@loha.vn',
    roles: [UserRole.WAREHOUSE_KEEPER],
  };

  const receipt = await service.create(
    {
      warehouseId: DEFAULT_WAREHOUSE_ID,
      supplierId: VALID_SUPPLIER_UUID,
      referenceDocument: 'HD-UUID-VALIDATION-SN178',
      items: [
        {
          productId: VALID_PRODUCT_UUID,
          unitId: '33333333-1000-0000-0000-000000000001',
          packageQuantity: 50,
          conversionFactor: 1,
          unitCost: 6500,
          batchNumber: 'LOT-UUID-SN178',
          mfgDate: '2026-03-01',
          expiryDate: '2027-03-01',
        },
      ],
    },
    mockUser,
  );

  assert(
    Boolean(receipt && receipt.id),
    'Tạo phiếu nhập thành công trong CSDL với supplierId & productId là UUID chuẩn',
    `Mã ID phiếu tạo: ${receipt.id}`,
  );

  // 5. Kiểm tra chi tiết phiếu có lưu đúng supplierId và productId
  const detail = await service.findOne(receipt.id);
  assert(
    detail.supplierId === VALID_SUPPLIER_UUID && detail.items[0]?.productId === VALID_PRODUCT_UUID,
    'Chi tiết phiếu lưu trữ chính xác UUID của nhà cung cấp và sản phẩm',
    `supplierId: ${detail.supplierId}, productId: ${detail.items[0]?.productId}`,
  );

  await dbService.onModuleDestroy();

  console.log('\n=============================================================');
  console.log(`TỔNG KẾT: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error('Lỗi kiểm thử:', err);
  process.exit(1);
});
