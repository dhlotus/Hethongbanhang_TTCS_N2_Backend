import * as assert from 'node:assert';
import { InventoryFefoService } from '../src/modules/inventory/inventory-fefo.service';
import { DEFAULT_WAREHOUSE_ID } from '../src/modules/warehouses/warehouse.constants';

describe('InventoryFefoService (SN-187)', () => {
  let fefoService: InventoryFefoService;

  beforeAll(async () => {
    fefoService = new InventoryFefoService();
    await fefoService.onModuleInit();
  });

  it('TC1: Sắp xếp danh sách lô theo nguyên tắc FEFO (Hạn dùng tăng dần / Cận date lên đầu)', async () => {
    const batches = await fefoService.getBatchesByProduct(DEFAULT_WAREHOUSE_ID, 'prod-milk-vnm');
    expect(batches.length).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < batches.length - 1; i++) {
      const d1 = new Date(batches[i].expiryDate).getTime();
      const d2 = new Date(batches[i + 1].expiryDate).getTime();
      expect(d1).toBeLessThanOrEqual(d2);
    }

    expect(batches[0].batchNumber).toBe('LOT-VNM-2601');
    expect(batches[0].expiryStatus).toBe('CRITICAL');
  });

  it('TC2: Tự động phân bổ đủ số lượng theo FEFO (Ưu tiên lô cận date trước)', async () => {
    // Yêu cầu xuất 20 thùng: Lô 1 có 15 thùng -> Thuật toán gợi ý 15 từ Lô 1, 5 từ Lô 2
    const recResult = await fefoService.getFefoRecommendation({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      productId: 'prod-milk-vnm',
      requiredQuantity: 20,
    });

    expect(recResult.isFullySatisfied).toBe(true);
    expect(recResult.totalSuggestedQuantity).toBe(20);

    const b1 = recResult.batches.find((b) => b.batchNumber === 'LOT-VNM-2601');
    const b2 = recResult.batches.find((b) => b.batchNumber === 'LOT-VNM-2602');
    const b3 = recResult.batches.find((b) => b.batchNumber === 'LOT-VNM-2603');

    expect(b1?.suggestedQuantity).toBe(15);
    expect(b1?.isFefoRecommended).toBe(true);
    expect(b2?.suggestedQuantity).toBe(5);
    expect(b2?.isFefoRecommended).toBe(true);
    expect(b3?.suggestedQuantity).toBe(0);
    expect(b3?.isFefoRecommended).toBe(false);
  });

  it('TC3: Bắt buộc phải có lý do giải trình khi chọn lô khác (Override Validation)', async () => {
    await expect(
      fefoService.confirmFefoDispatch({
        warehouseId: DEFAULT_WAREHOUSE_ID,
        productId: 'prod-milk-vnm',
        selectedBatches: [{ batchId: 'batch-vnm-003', batchNumber: 'LOT-VNM-2603', quantity: 10 }],
        isOverride: true,
        overrideReason: '', // Không nhập lý do -> Bắt buộc ném lỗi BadRequestException
      }),
    ).rejects.toThrow(/Bắt buộc phải nhập lý do/);
  });

  it('TC4: Xuất kho thành công và tự động trừ tồn của đúng lô đã chọn', async () => {
    const initBatches = await fefoService.getBatchesByProduct(DEFAULT_WAREHOUSE_ID, 'prod-milk-vnm');
    const initialQtyB1 = initBatches.find((b) => b.batchNumber === 'LOT-VNM-2601')!.availableQuantity;

    const dispatchRes = await fefoService.confirmFefoDispatch({
      warehouseId: DEFAULT_WAREHOUSE_ID,
      productId: 'prod-milk-vnm',
      selectedBatches: [{ batchId: 'batch-vnm-001', batchNumber: 'LOT-VNM-2601', quantity: 5 }],
      isOverride: false,
    });

    expect(dispatchRes.success).toBe(true);
    expect(dispatchRes.totalDispatchedQuantity).toBe(5);

    const afterBatches = await fefoService.getBatchesByProduct(DEFAULT_WAREHOUSE_ID, 'prod-milk-vnm');
    const afterQtyB1 = afterBatches.find((b) => b.batchNumber === 'LOT-VNM-2601')!.availableQuantity;
    expect(afterQtyB1).toBe(initialQtyB1 - 5);
  });
});
