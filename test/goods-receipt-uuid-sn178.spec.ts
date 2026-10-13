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
  console.log('=== KIỂM THỬ KHẮC PHỤC LỖI UUID TẠI TRƯỜNG KHO NHẬP (SN-178) ===\n');
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

  // 1. Kiểm tra validation DTO: CreateGoodsReceiptDto phải từ chối chuỗi không phải UUID (ví dụ 'WH01')
  console.log('--- 1. Kiểm tra validation DTO với class-validator ---');
  const invalidDto = new CreateGoodsReceiptDto();
  invalidDto.warehouseId = 'WH01';
  invalidDto.items = [
    Object.assign(new CreateGoodsReceiptItemDto(), {
      productId: '33333333-0000-0000-0000-000000000001',
      unitId: 'unit-01',
      packageQuantity: 10,
      conversionFactor: 1,
      unitCost: 10000,
    }),
  ];
  const invalidErrors = await validate(invalidDto);
  const warehouseError = invalidErrors.find((e) => e.property === 'warehouseId');
  assert(
    Boolean(warehouseError),
    'CreateGoodsReceiptDto từ chối chuỗi code "WH01" không phải UUID',
    `Lỗi nhận được: ${JSON.stringify(warehouseError?.constraints)}`,
  );

  // 2. Kiểm tra validation DTO: chấp nhận UUID v4 hợp lệ
  const validDto = new CreateGoodsReceiptDto();
  validDto.warehouseId = DEFAULT_WAREHOUSE_ID;
  validDto.items = [
    Object.assign(new CreateGoodsReceiptItemDto(), {
      productId: '33333333-0000-0000-0000-000000000001',
      unitId: 'unit-01',
      packageQuantity: 5,
      conversionFactor: 1,
      unitCost: 15000,
      batchNumber: 'LOT-SN178-TEST',
      mfgDate: '2026-01-01',
      expiryDate: '2027-01-01',
    }),
  ];
  const validErrors = await validate(validDto);
  const validWhError = validErrors.find((e) => e.property === 'warehouseId');
  assert(
    !validWhError,
    `CreateGoodsReceiptDto chấp nhận UUID v4 chuẩn (${DEFAULT_WAREHOUSE_ID})`,
  );

  // 3. Kiểm tra validation DTO: CreateGoodsReceiptItemDto từ chối productId không phải UUID
  const invalidProdDto = new CreateGoodsReceiptDto();
  invalidProdDto.warehouseId = DEFAULT_WAREHOUSE_ID;
  invalidProdDto.items = [
    Object.assign(new CreateGoodsReceiptItemDto(), {
      productId: 'prod-001',
      unitId: 'unit-01',
      packageQuantity: 10,
      conversionFactor: 1,
      unitCost: 10000,
    }),
  ];
  const invalidProdErrors = await validate(invalidProdDto);
  const itemErrors = invalidProdErrors.find((e) => e.property === 'items');
  const prodError = itemErrors?.children?.[0]?.children?.find((c) => c.property === 'productId');
  assert(
    Boolean(prodError),
    'CreateGoodsReceiptDto từ chối productId dạng code "prod-001" (yêu cầu UUID)',
    `Lỗi nhận được: ${JSON.stringify(prodError?.constraints)}`,
  );

  // 4. Kiểm tra validation DTO: CreateGoodsReceiptDto từ chối supplierId không phải UUID
  const invalidSupDto = new CreateGoodsReceiptDto();
  invalidSupDto.warehouseId = DEFAULT_WAREHOUSE_ID;
  invalidSupDto.supplierId = 'NCC-01';
  invalidSupDto.items = [
    Object.assign(new CreateGoodsReceiptItemDto(), {
      productId: '33333333-0000-0000-0000-000000000001',
      unitId: 'unit-01',
      packageQuantity: 10,
      conversionFactor: 1,
      unitCost: 10000,
    }),
  ];
  const invalidSupErrors = await validate(invalidSupDto);
  const supError = invalidSupErrors.find((e) => e.property === 'supplierId');
  assert(
    Boolean(supError),
    'CreateGoodsReceiptDto từ chối supplierId dạng code "NCC-01" (yêu cầu UUID)',
    `Lỗi nhận được: ${JSON.stringify(supError?.constraints)}`,
  );

  // 5. Kiểm thử tích hợp Database với GoodsReceiptsService
  console.log('\n--- 2. Kiểm thử Tạo, Cập nhật, Xác nhận và Khóa phiếu trong Database ---');
  const dbService = new DatabaseService();
  await dbService.onModuleInit();
  const service = new GoodsReceiptsService(dbService);
  await service.onModuleInit();

  const userRows = await dbService.query('SELECT id, username, email FROM users LIMIT 5');
  console.log('USER ROWS IN DB:', userRows);
  const mockUser: ICurrentUser = {
    userId: userRows[0]?.id,
    username: userRows[0]?.username || 'warehouse_keeper',
    email: userRows[0]?.email || 'warehouse@loha.vn',
    roles: [UserRole.WAREHOUSE_KEEPER],
  };

  const productRows = await dbService.query('SELECT id FROM products LIMIT 1');
  const realProductId = productRows[0]?.id;

  // Tạo phiếu nhập nháp với UUID kho hợp lệ
  const createRes = await service.create(
    {
      warehouseId: DEFAULT_WAREHOUSE_ID,
      referenceDocument: 'HD-SN178-VERIFY',
      notes: 'Phiếu kiểm tra sửa lỗi UUID SN-178',
      items: [
        {
          productId: realProductId,
          unitId: 'unit-01',
          packageQuantity: 10,
          conversionFactor: 1,
          unitCost: 20000,
          batchNumber: 'LOT-SN178-PASS',
          mfgDate: '2026-01-01',
          expiryDate: '2027-01-01',
          notes: 'Dòng test kiểm thử xác nhận nhập kho',
        },
      ],
    },
    mockUser,
  );

  assert(
    Boolean(createRes && createRes.id),
    'Tạo phiếu nhập kho thành công với warehouseId là UUID v4',
    `Receipt ID tạo ra: ${createRes.id}`,
  );

  // Thử cập nhật phiếu khi đang ở trạng thái DRAFT
  const updateRes = await service.update(
    createRes.id,
    {
      notes: 'Đã cập nhật phiếu nháp thành công',
      items: [
        {
          productId: realProductId,
          unitId: 'unit-01',
          packageQuantity: 15,
          conversionFactor: 2,
          unitCost: 20000,
          batchNumber: 'LOT-SN178-UPDATED',
          mfgDate: '2026-01-01',
          expiryDate: '2027-01-01',
          notes: 'Cập nhật lại số lượng và hệ số quy đổi',
        },
      ],
    },
    mockUser,
  );
  assert(
    updateRes.success === true,
    'Cho phép cập nhật phiếu nhập khi còn ở trạng thái DRAFT',
    `Thông báo: ${updateRes.message}`,
  );

  // Xác nhận phiếu nhập kho
  const confirmRes = await service.confirm(createRes.id, mockUser);
  assert(
    confirmRes.success === true,
    'Xác nhận phiếu nhập kho thành công KHÔNG CÒN LỖI UUID!',
    `Thông báo: ${confirmRes.message}`,
  );

  // Kiểm tra chi tiết phiếu sau khi xác nhận
  const detail = await service.findOne(createRes.id);
  assert(
    detail.status === 'CONFIRMED' && detail.warehouseId === DEFAULT_WAREHOUSE_ID,
    'Trạng thái phiếu là CONFIRMED và warehouseId đúng chuẩn UUID',
    `Mã phiếu: ${detail.code}, Kho: ${detail.warehouseName}`,
  );

  // Kiểm tra KHÓA PHIẾU: Không cho phép sửa khi đã CONFIRMED
  let editBlocked = false;
  let editMsg = '';
  try {
    await service.update(createRes.id, { notes: 'Thử sửa phiếu đã xác nhận' }, mockUser);
  } catch (err: any) {
    editBlocked = true;
    editMsg = err?.message;
  }
  assert(
    editBlocked && editMsg.includes('Phiếu đã xác nhận không thể chỉnh sửa'),
    'Khóa phiếu: Chặn thao tác SỬA khi đã CONFIRMED kèm thông báo chuẩn',
    `Lỗi nhận được: ${editMsg}`,
  );

  // Kiểm tra KHÓA PHIẾU: Không cho phép xóa khi đã CONFIRMED
  let deleteBlocked = false;
  let deleteMsg = '';
  try {
    await service.remove(createRes.id);
  } catch (err: any) {
    deleteBlocked = true;
    deleteMsg = err?.message;
  }
  assert(
    deleteBlocked && deleteMsg.includes('Phiếu đã xác nhận không thể xóa'),
    'Khóa phiếu: Chặn thao tác XÓA khi đã CONFIRMED kèm thông báo chuẩn',
    `Lỗi nhận được: ${deleteMsg}`,
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
