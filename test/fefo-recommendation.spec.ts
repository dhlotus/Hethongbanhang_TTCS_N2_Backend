import * as assert from 'node:assert';
import { InventoryFefoService } from '../src/modules/inventory/inventory-fefo.service';
import { DEFAULT_WAREHOUSE_ID } from '../src/modules/warehouses/warehouse.constants';

/**
 * Unit Test kiểm thử chức năng Gợi ý Lô xuất theo nguyên tắc FEFO (SN-187)
 * Tiêu chí:
 * 1. Gợi ý theo hạn sử dụng gần nhất nhưng vẫn đủ số lượng
 * 2. Lô khác bắt buộc phải nhập lý do
 * 3. Trừ tồn kho của đúng lô đã chọn
 */
async function runFefoTests(): Promise<void> {
  console.log('=== BẮT ĐẦU TEST CHỨC NĂNG GỢI Ý LÔ XUẤT FEFO (SN-187) ===\n');

  const fefoService = new InventoryFefoService();
  await fefoService.onModuleInit();

  // TEST CASE 1: Lấy danh sách lô sắp xếp theo FEFO (HSD tăng dần)
  console.log('--- TEST 1: Kiểm tra thứ tự Lô sắp xếp theo FEFO (Expiry Date ASC) ---');
  const batches = await fefoService.getBatchesByProduct(DEFAULT_WAREHOUSE_ID, 'prod-milk-vnm');
  assert.ok(batches.length >= 3, 'Phải có ít nhất 3 lô hàng demo');
  for (let i = 0; i < batches.length - 1; i++) {
    const d1 = new Date(batches[i].expiryDate).getTime();
    const d2 = new Date(batches[i + 1].expiryDate).getTime();
    assert.ok(d1 <= d2, `Lô ${batches[i].batchNumber} phải có HSD sớm hơn hoặc bằng lô ${batches[i + 1].batchNumber}`);
  }
  console.log(`✓ Lô #1: ${batches[0].batchNumber} (HSD: ${batches[0].expiryDate}, Còn ${batches[0].daysUntilExpiry} ngày - ${batches[0].expiryStatus})`);
  console.log(`✓ Lô #2: ${batches[1].batchNumber} (HSD: ${batches[1].expiryDate}, Còn ${batches[1].daysUntilExpiry} ngày - ${batches[1].expiryStatus})`);
  console.log(`✓ Lô #3: ${batches[2].batchNumber} (HSD: ${batches[2].expiryDate}, Còn ${batches[2].daysUntilExpiry} ngày - ${batches[2].expiryStatus})`);
  console.log('✓ PASS Test 1\n');

  // TEST CASE 2: Gợi ý phân bổ đủ số lượng từ lô cận date nhất
  console.log('--- TEST 2: Thuật toán gợi ý đủ số lượng (Ưu tiên lô cận date trước) ---');
  // Cần xuất 20 thùng: Lô 1 có 15 thùng -> Phải gợi ý lấy 15 từ Lô 1, và 5 từ Lô 2
  const recResult = await fefoService.getFefoRecommendation({
    warehouseId: DEFAULT_WAREHOUSE_ID,
    productId: 'prod-milk-vnm',
    requiredQuantity: 20,
  });

  assert.strictEqual(recResult.isFullySatisfied, true, 'Phải đáp ứng đủ 20 thùng');
  assert.strictEqual(recResult.totalSuggestedQuantity, 20, 'Tổng số lượng gợi ý phải là 20');
  
  const b1 = recResult.batches.find((b) => b.batchNumber === 'LOT-VNM-2601');
  const b2 = recResult.batches.find((b) => b.batchNumber === 'LOT-VNM-2602');
  const b3 = recResult.batches.find((b) => b.batchNumber === 'LOT-VNM-2603');

  assert.strictEqual(b1?.suggestedQuantity, 15, 'Lô 1 cận date phải được lấy hết 15 thùng');
  assert.strictEqual(b2?.suggestedQuantity, 5, 'Lô 2 phải được lấy tiếp 5 thùng bù vào');
  assert.strictEqual(b3?.suggestedQuantity, 0, 'Lô 3 date xa chưa cần lấy');
  console.log(`✓ Phân bổ tự động: Lô 1 (${b1?.batchNumber}) lấy 15 | Lô 2 (${b2?.batchNumber}) lấy 5`);
  console.log('✓ PASS Test 2\n');

  // TEST CASE 3: Ràng buộc chọn lô khác BẮT BUỘC NHẬP LÝ DO
  console.log('--- TEST 3: Ràng buộc bắt buộc nhập lý do khi chọn lô khác (Override) ---');
  await assert.rejects(
    async () => {
      await fefoService.confirmFefoDispatch({
        warehouseId: DEFAULT_WAREHOUSE_ID,
        productId: 'prod-milk-vnm',
        selectedBatches: [{ batchId: 'batch-vnm-003', batchNumber: 'LOT-VNM-2603', quantity: 10 }],
        isOverride: true, // Chọn lô 3 date xa thay vì lô 1
        overrideReason: '', // Bỏ trống lý do -> Bắt buộc ném lỗi!
      });
    },
    /Bắt buộc phải nhập lý do/,
    'Hệ thống phải chặn không cho xuất kho nếu chọn lô khác mà không có lý do giải trình',
  );
  console.log('✓ Chặn thành công khi chọn lô khác mà bỏ trống lý do giải trình');
  console.log('✓ PASS Test 3\n');

  // TEST CASE 4: Xuất kho thành công và tự động trừ tồn của đúng lô đã chọn
  console.log('--- TEST 4: Xuất kho trừ tồn của đúng Lô đã chọn ---');
  const initBatches = await fefoService.getBatchesByProduct(DEFAULT_WAREHOUSE_ID, 'prod-milk-vnm');
  const initialQtyB1 = initBatches.find((b) => b.batchNumber === 'LOT-VNM-2601')!.availableQuantity;

  const dispatchRes = await fefoService.confirmFefoDispatch({
    warehouseId: DEFAULT_WAREHOUSE_ID,
    productId: 'prod-milk-vnm',
    selectedBatches: [{ batchId: 'batch-vnm-001', batchNumber: 'LOT-VNM-2601', quantity: 5 }],
    isOverride: false,
  });

  assert.strictEqual(dispatchRes.success, true);
  assert.strictEqual(dispatchRes.totalDispatchedQuantity, 5);

  const afterBatches = await fefoService.getBatchesByProduct(DEFAULT_WAREHOUSE_ID, 'prod-milk-vnm');
  const afterQtyB1 = afterBatches.find((b) => b.batchNumber === 'LOT-VNM-2601')!.availableQuantity;
  assert.strictEqual(afterQtyB1, initialQtyB1 - 5, 'Tồn của Lô 1 phải giảm đi đúng 5 thùng');
  console.log(`✓ Lô 1 trước xuất: ${initialQtyB1} -> Sau xuất: ${afterQtyB1} (Đã trừ đúng 5)`);
  console.log('✓ PASS Test 4\n');

  console.log('=== TẤT CẢ 4/4 TEST CASES FEFO ĐÃ PASS 100%! ===');
}

runFefoTests().catch((err) => {
  console.error('Test thất bại:', err);
  process.exit(1);
});
