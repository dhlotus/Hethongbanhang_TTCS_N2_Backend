import { BadRequestException } from '@nestjs/common';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { ProductsService } from '../src/modules/products/products.service';

/**
 * Test Suite: Đơn Vị Tính Quy Đổi & Sổ Kho Bất Biến (SN-148)
 * User Story: "Là Nhân viên kho, tôi muốn có đơn vị tính quy đổi đúng theo cách kho đang gọi hàng,
 * để nhập xuất theo thùng mà sổ sách vẫn ghi đúng số lon."
 */
async function runUnitConversionTests(): Promise<void> {
  console.log('=== BẮT ĐẦU KIỂM THỬ SN-148: ĐƠN VỊ TÍNH QUY ĐỔI & SỔ KHO BẤT BIẾN ===\n');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string): void {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedCount++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      failedCount++;
    }
  }

  const productsService = new ProductsService();
  const inventoryService = new InventoryService(productsService);

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Kiểm tra danh mục đơn vị tính mặc định
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- 1. Kiểm tra danh mục đơn vị tính mặc định của SKU ---');
  const milkUnits = await productsService.getUnits('LH-MILK-900G');
  assert(
    milkUnits.length === 3,
    'Sản phẩm LH-MILK-900G có sẵn 3 cấp đơn vị tính (Lon, Lốc, Thùng)',
  );

  const baseUnit = milkUnits.find((u) => u.isBaseUnit);
  assert(
    baseUnit?.unitName === 'Lon' && baseUnit?.conversionFactor === 1,
    'Đơn vị cơ sở là "Lon" với hệ số quy đổi bằng 1',
  );

  const thungUnit = milkUnits.find((u) => u.unitName === 'Thùng');
  assert(
    thungUnit?.conversionFactor === 24,
    'Đơn vị "Thùng" có hệ số quy đổi về đơn vị cơ sở là 24 Lon',
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Thêm đơn vị tính mới cho SKU
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Khai báo thêm đơn vị tính quy đổi mới ---');
  const kienUnit = await productsService.addUnit('LH-MILK-900G', {
    unitName: 'Kiện',
    conversionFactor: 96,
    barcode: '8936012345099',
  });
  assert(
    kienUnit.unitName === 'Kiện' && kienUnit.conversionFactor === 96,
    'Thêm thành công đơn vị "Kiện" (hệ số 96 Lon)',
  );

  // Kiểm tra chống trùng tên đơn vị tính
  let duplicatePrevented = false;
  try {
    await productsService.addUnit('LH-MILK-900G', {
      unitName: 'Thùng',
      conversionFactor: 24,
    });
  } catch (err) {
    if (err instanceof BadRequestException) {
      duplicatePrevented = true;
    }
  }
  assert(duplicatePrevented, 'Ngăn chặn thành công khi thêm đơn vị tính trùng tên ("Thùng")');

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Bảo vệ đơn vị cơ sở không cho phép xóa
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Kiểm tra ràng buộc bảo vệ đơn vị cơ sở ---');
  let deleteBasePrevented = false;
  try {
    await productsService.deleteUnit('LH-MILK-900G', baseUnit!.id);
  } catch (err) {
    if (err instanceof BadRequestException) {
      deleteBasePrevented = true;
    }
  }
  assert(deleteBasePrevented, 'Tuyệt đối cấm xóa đơn vị tính cơ sở (isBaseUnit = true)');

  // Xóa đơn vị phụ (Kiện) hợp lệ
  const deleteResult = await productsService.deleteUnit('LH-MILK-900G', kienUnit.id);
  assert(deleteResult.success, 'Cho phép xóa đơn vị tính phụ ("Kiện")');

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Nhập kho theo đơn vị Thùng, tự động quy về Lon trong sổ kho
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Nhập kho theo Thùng & Tự động quy về đơn vị cơ sở ---');
  const initialProduct = await productsService.findById('LH-MILK-900G');
  const initialStock = initialProduct.stockQuantity; // 340 Lon

  // Nhập thêm 5 Thùng (Mỗi thùng = 24 lon -> Tổng cộng 120 lon)
  const adjustResult1 = await inventoryService.adjustStock(
    {
      productSku: 'LH-MILK-900G',
      quantityChange: 5,
      unitName: 'Thùng',
      reason: 'Nhập lô hàng mới từ nhà máy LOHA',
    },
    'wh-user-01',
  );

  assert(
    adjustResult1.packageQuantity === 5 && adjustResult1.conversionFactor === 24,
    'Giao dịch ghi nhận đúng 5 Thùng với hệ số quy đổi 24',
  );
  assert(
    adjustResult1.baseQuantityChange === 120,
    'Số lượng quy đổi về đơn vị cơ sở là 120 Lon (5 * 24)',
  );
  assert(
    adjustResult1.newQuantity === initialStock + 120,
    `Tồn kho sản phẩm cập nhật chính xác từ ${initialStock} lên ${initialStock + 120} Lon`,
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Kiểm tra tính bất biến của sổ giao dịch kho khi đổi hệ số quy đổi
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 5. Kiểm tra tính bất biến lịch sử (Historical Ledger Immutability) ---');
  // Cập nhật quy cách đóng gói Thùng mới: Đổi hệ số quy đổi từ 24 thành 30 Lon/Thùng
  await productsService.updateUnit('LH-MILK-900G', thungUnit!.id, {
    conversionFactor: 30,
  });

  // Kiểm tra giao dịch đã ghi trước đó trong sổ kho
  const transactions = await inventoryService.getTransactions('LH-MILK-900G');
  const pastTxn = transactions.find((t) => t.id === adjustResult1.transactionId);

  assert(
    pastTxn !== undefined,
    'Tìm thấy bản ghi giao dịch đã lưu trong sổ kho',
  );
  assert(
    pastTxn?.conversionFactor === 24,
    'Hệ số quy đổi trong giao dịch quá khứ giữ nguyên 24 (không bị đổi thành 30)',
  );
  assert(
    pastTxn?.baseQuantityChange === 120,
    'Số lượng quy đổi quá khứ giữ nguyên 120 Lon (không bị tính lại thành 150)',
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Xuất kho theo quy cách mới (2 Thùng = 60 Lon)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 6. Xuất kho theo hệ số quy đổi mới ---');
  const currentProduct = await productsService.findById('LH-MILK-900G');
  const stockBeforeIssue = currentProduct.stockQuantity; // 460 Lon

  // Xuất kho 2 Thùng (hệ số mới 30 -> 60 lon)
  const adjustResult2 = await inventoryService.adjustStock(
    {
      productSku: 'LH-MILK-900G',
      quantityChange: -2,
      unitName: 'Thùng',
      reason: 'Xuất kho giao cho Đại lý An Bình',
    },
    'wh-user-02',
  );

  assert(
    adjustResult2.conversionFactor === 30,
    'Giao dịch mới áp dụng chính xác hệ số quy đổi mới (30 Lon/Thùng)',
  );
  assert(
    adjustResult2.baseQuantityChange === -60,
    'Số lượng trừ tồn kho cơ sở là -60 Lon (-2 * 30)',
  );
  assert(
    adjustResult2.newQuantity === stockBeforeIssue - 60,
    `Tồn kho sau xuất giảm từ ${stockBeforeIssue} xuống ${stockBeforeIssue - 60} Lon`,
  );

  // Kiểm tra lại cả 2 giao dịch trong sổ kho
  const allTxns = await inventoryService.getTransactions('LH-MILK-900G');
  assert(
    allTxns.length >= 2,
    'Sổ kho lưu đầy đủ lịch sử cả 2 đợt nhập và xuất',
  );

  console.log('\n======================================================');
  console.log(`KẾT QUẢ KIỂM THỬ: ${passedCount} PASSED | ${failedCount} FAILED`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runUnitConversionTests().catch((err) => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
