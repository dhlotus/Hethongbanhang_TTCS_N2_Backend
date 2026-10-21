import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  ConfirmFefoDispatchDto,
  FefoBatchDetail,
  FefoRecommendationResult,
  QueryFefoRecommendationDto,
} from './dto/fefo-recommendation.dto';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { DEFAULT_WAREHOUSE_ID } from '../warehouses/warehouse.constants';

/**
 * Service Quản lý Lô Hàng & Gợi ý xuất kho theo nguyên tắc FEFO (First Expired, First Out)
 * Tuân thủ quy chuẩn CODE_CONVENTION.docx:
 * - Tên hàm camelCase bắt đầu bằng động từ.
 * - Tuyệt đối không dùng kiểu any, Interface / DTO rõ ràng.
 * - Ràng buộc: Chọn lô khác bắt buộc phải nhập lý do.
 * - Tự động trừ tồn kho của lô đã chọn.
 */
@Injectable()
export class InventoryFefoService implements OnModuleInit {
  private readonly memoryBatches = new Map<string, FefoBatchDetail[]>();

  constructor(@Optional() private readonly databaseService?: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    this.seedInitialMemoryBatches();
    if (this.databaseService?.isConnected()) {
      await this.ensureBatchesTable();
    }
  }

  /**
   * Khởi tạo bảng inventory_batches nếu chưa tồn tại
   */
  async ensureBatchesTable(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS inventory_batches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        batch_number VARCHAR(50) NOT NULL,
        product_id UUID NOT NULL,
        warehouse_id UUID NOT NULL,
        location_id UUID,
        mfg_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        quantity NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        allocated_quantity NUMERIC(15, 2) NOT NULL DEFAULT 0,
        cost_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'HOLD', 'DEPLETED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_wh_product_batch UNIQUE (warehouse_id, product_id, batch_number)
      );
      CREATE INDEX IF NOT EXISTS idx_batches_fefo_sort 
      ON inventory_batches(product_id, warehouse_id, expiry_date ASC) 
      WHERE status = 'ACTIVE' AND quantity > 0;
    `);
  }

  /**
   * Seed dữ liệu mẫu các Lô hàng với nhiều mốc Hạn sử dụng (FEFO demo)
   */
  private seedInitialMemoryBatches(): void {
    const today = new Date();
    
    // Helper tính ngày tương đối
    const addDays = (days: number): string => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return d.toISOString().split('T')[0];
    };
    const subDays = (days: number): string => {
      const d = new Date(today);
      d.setDate(d.getDate() - days);
      return d.toISOString().split('T')[0];
    };

    const initialList: FefoBatchDetail[] = [
      // Sữa Tươi Tiệt Trùng Vinamilk
      {
        id: 'batch-vnm-001',
        batchNumber: 'LOT-VNM-2601',
        productId: 'prod-milk-vnm',
        productName: 'Sữa Tươi Tiệt Trùng Vinamilk 100% Có Đường (Thùng 48 hộp)',
        warehouseId: DEFAULT_WAREHOUSE_ID,
        locationCode: 'A-01-R01-T1-B01',
        mfgDate: subDays(150),
        expiryDate: addDays(25), // Cận date (< 30 ngày) -> Ưu tiên FEFO số 1
        daysUntilExpiry: 25,
        expiryStatus: 'CRITICAL',
        availableQuantity: 15,
        allocatedQuantity: 0,
        costPrice: 320000,
        suggestedQuantity: 0,
        isFefoRecommended: false,
      },
      {
        id: 'batch-vnm-002',
        batchNumber: 'LOT-VNM-2602',
        productId: 'prod-milk-vnm',
        productName: 'Sữa Tươi Tiệt Trùng Vinamilk 100% Có Đường (Thùng 48 hộp)',
        warehouseId: DEFAULT_WAREHOUSE_ID,
        locationCode: 'A-01-R02-T2-B02',
        mfgDate: subDays(90),
        expiryDate: addDays(75), // HSD trung bình (< 90 ngày) -> Ưu tiên FEFO số 2
        daysUntilExpiry: 75,
        expiryStatus: 'WARNING',
        availableQuantity: 40,
        allocatedQuantity: 0,
        costPrice: 320000,
        suggestedQuantity: 0,
        isFefoRecommended: false,
      },
      {
        id: 'batch-vnm-003',
        batchNumber: 'LOT-VNM-2603',
        productId: 'prod-milk-vnm',
        productName: 'Sữa Tươi Tiệt Trùng Vinamilk 100% Có Đường (Thùng 48 hộp)',
        warehouseId: DEFAULT_WAREHOUSE_ID,
        locationCode: 'A-01-R03-T1-B03',
        mfgDate: subDays(30),
        expiryDate: addDays(180), // HSD dài (> 90 ngày)
        daysUntilExpiry: 180,
        expiryStatus: 'GOOD',
        availableQuantity: 100,
        allocatedQuantity: 0,
        costPrice: 320000,
        suggestedQuantity: 0,
        isFefoRecommended: false,
      },

      // Nước ngọt Cola lon
      {
        id: 'batch-cola-001',
        batchNumber: 'LOT-COLA-2026A',
        productId: '33333333-0000-0000-0000-000000000001',
        productName: 'Nước Ngọt Cola Loha Lon 330ml',
        warehouseId: DEFAULT_WAREHOUSE_ID,
        locationCode: 'A-02-R01-T1-B01',
        mfgDate: subDays(200),
        expiryDate: addDays(45), // Cận date hơn -> FEFO ưu tiên số 1
        daysUntilExpiry: 45,
        expiryStatus: 'WARNING',
        availableQuantity: 50,
        allocatedQuantity: 0,
        costPrice: 6500,
        suggestedQuantity: 0,
        isFefoRecommended: false,
      },
      {
        id: 'batch-cola-002',
        batchNumber: 'LOT-COLA-2026B',
        productId: '33333333-0000-0000-0000-000000000001',
        productName: 'Nước Ngọt Cola Loha Lon 330ml',
        warehouseId: DEFAULT_WAREHOUSE_ID,
        locationCode: 'A-02-R02-T3-B02',
        mfgDate: subDays(60),
        expiryDate: addDays(210),
        daysUntilExpiry: 210,
        expiryStatus: 'GOOD',
        availableQuantity: 120,
        allocatedQuantity: 0,
        costPrice: 6500,
        suggestedQuantity: 0,
        isFefoRecommended: false,
      },

      // Cà phê sữa đóng lon
      {
        id: 'batch-coffee-001',
        batchNumber: 'LOT-CF-2601',
        productId: 'prod-coffee-can',
        productName: 'Cà Phê Sữa Đóng Lon Loha Classic 240ml',
        warehouseId: DEFAULT_WAREHOUSE_ID,
        locationCode: 'A-01-R05-T1-B01',
        mfgDate: subDays(120),
        expiryDate: addDays(30),
        daysUntilExpiry: 30,
        expiryStatus: 'CRITICAL',
        availableQuantity: 20,
        allocatedQuantity: 0,
        costPrice: 12000,
        suggestedQuantity: 0,
        isFefoRecommended: false,
      },
      {
        id: 'batch-coffee-002',
        batchNumber: 'LOT-CF-2602',
        productId: 'prod-coffee-can',
        productName: 'Cà Phê Sữa Đóng Lon Loha Classic 240ml',
        warehouseId: DEFAULT_WAREHOUSE_ID,
        locationCode: 'A-01-R05-T2-B02',
        mfgDate: subDays(30),
        expiryDate: addDays(150),
        daysUntilExpiry: 150,
        expiryStatus: 'GOOD',
        availableQuantity: 80,
        allocatedQuantity: 0,
        costPrice: 12000,
        suggestedQuantity: 0,
        isFefoRecommended: false,
      },
    ];

    for (const b of initialList) {
      const key = `${b.warehouseId}_${b.productId}`;
      const existing = this.memoryBatches.get(key) || [];
      existing.push(b);
      this.memoryBatches.set(key, existing);
    }
  }

  /**
   * Tính toán trạng thái hạn dùng và số ngày còn lại
   */
  private calculateExpiryMeta(expiryDateStr: string): {
    daysUntilExpiry: number;
    expiryStatus: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'GOOD';
  } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp = new Date(expiryDateStr);
    exp.setHours(0, 0, 0, 0);

    const diffTime = exp.getTime() - today.getTime();
    const daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    let expiryStatus: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'GOOD' = 'GOOD';
    if (daysUntilExpiry <= 0) {
      expiryStatus = 'EXPIRED';
    } else if (daysUntilExpiry <= 30) {
      expiryStatus = 'CRITICAL';
    } else if (daysUntilExpiry <= 90) {
      expiryStatus = 'WARNING';
    }

    return { daysUntilExpiry, expiryStatus };
  }

  /**
   * Lấy danh sách các lô hàng của sản phẩm tại kho
   */
  async getBatchesByProduct(
    warehouseId: string,
    productId: string,
  ): Promise<FefoBatchDetail[]> {
    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<{
          id: string;
          batch_number: string;
          product_id: string;
          warehouse_id: string;
          location_code?: string;
          mfg_date: string;
          expiry_date: string;
          quantity: string;
          allocated_quantity: string;
          cost_price: string;
          status: string;
        }>(
          `SELECT b.id, b.batch_number, b.product_id, b.warehouse_id, l.code as location_code,
                  b.mfg_date, b.expiry_date, b.quantity, b.allocated_quantity, b.cost_price, b.status
           FROM inventory_batches b
           LEFT JOIN warehouse_locations l ON l.id = b.location_id
           WHERE (b.warehouse_id = $1::uuid OR b.warehouse_id::text = $1)
             AND (b.product_id = $2::uuid OR b.product_id::text = $2)
             AND b.quantity > 0
             AND b.status = 'ACTIVE'
           ORDER BY b.expiry_date ASC`,
          [warehouseId, productId],
        );

        if (rows.length > 0) {
          return rows.map((r) => {
            const meta = this.calculateExpiryMeta(r.expiry_date);
            return {
              id: r.id,
              batchNumber: r.batch_number,
              productId: r.product_id,
              warehouseId: r.warehouse_id,
              locationCode: r.location_code || 'Chưa định vị',
              mfgDate: r.mfg_date,
              expiryDate: r.expiry_date,
              daysUntilExpiry: meta.daysUntilExpiry,
              expiryStatus: meta.expiryStatus,
              availableQuantity: Number(r.quantity) - Number(r.allocated_quantity || 0),
              allocatedQuantity: Number(r.allocated_quantity || 0),
              costPrice: Number(r.cost_price || 0),
              suggestedQuantity: 0,
              isFefoRecommended: false,
            };
          });
        }
      } catch {
        // Fallback to memory store below
      }
    }

    // Memory Store Fallback
    const key = `${warehouseId}_${productId}`;
    const list = this.memoryBatches.get(key) || [];
    
    // Cập nhật lại số ngày còn lại theo thời gian thực
    return list.map((b) => {
      const meta = this.calculateExpiryMeta(b.expiryDate);
      return {
        ...b,
        daysUntilExpiry: meta.daysUntilExpiry,
        expiryStatus: meta.expiryStatus,
      };
    }).sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
  }

  /**
   * Thuật toán Gợi ý Lô xuất kho theo nguyên tắc FEFO (First Expired, First Out)
   * Tiêu chí đề bài:
   * 1. Ưu tiên lô có hạn sử dụng gần nhất trước.
   * 2. Đảm bảo phân bổ đủ số lượng yêu cầu xuất.
   * 3. Sắp xếp lô theo ngày hết hạn tăng dần.
   */
  async getFefoRecommendation(
    query: QueryFefoRecommendationDto,
  ): Promise<FefoRecommendationResult> {
    const { warehouseId, productId, requiredQuantity } = query;
    const allBatches = await this.getBatchesByProduct(warehouseId, productId);

    // Lọc các lô còn hạn dùng hợp lệ (bỏ qua lô đã hết hạn)
    const validBatches = allBatches.filter((b) => b.daysUntilExpiry > 0 && b.availableQuantity > 0);

    let remainingNeeded = requiredQuantity;
    let totalSuggested = 0;

    const batchesWithRecommendation: FefoBatchDetail[] = validBatches.map((batch) => {
      let suggestedQty = 0;
      let isRecommended = false;

      if (remainingNeeded > 0) {
        suggestedQty = Math.min(batch.availableQuantity, remainingNeeded);
        remainingNeeded -= suggestedQty;
        totalSuggested += suggestedQty;
        isRecommended = suggestedQty > 0;
      }

      return {
        ...batch,
        suggestedQuantity: suggestedQty,
        isFefoRecommended: isRecommended,
      };
    });

    const isFullySatisfied = totalSuggested >= requiredQuantity;

    return {
      productId,
      warehouseId,
      requiredQuantity,
      totalSuggestedQuantity: totalSuggested,
      isFullySatisfied,
      batches: batchesWithRecommendation,
    };
  }

  /**
   * Xác nhận xuất kho theo Lô đã chọn (SN-187)
   * Tiêu chí đề bài:
   * 1. Nếu chọn lô khác gợi ý FEFO: BẮT BUỘC NHẬP LÝ DO.
   * 2. Xuất kho tự động trừ số lượng tồn của đúng Lô đã chọn.
   */
  async confirmFefoDispatch(
    dto: ConfirmFefoDispatchDto,
    currentUser?: ICurrentUser,
  ): Promise<{
    success: boolean;
    message: string;
    totalDispatchedQuantity: number;
    dispatchedBatches: {
      batchId: string;
      batchNumber: string;
      quantity: number;
      remainingInBatch: number;
    }[];
  }> {
    const { warehouseId, productId, selectedBatches, isOverride, overrideReason } = dto;

    if (!selectedBatches || selectedBatches.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất 1 lô hàng để xuất kho');
    }

    // RÀNG BUỘC NGHIỆP VỤ BẮT BUỘC: Đổi lô phải có lý do giải trình
    if (isOverride) {
      if (!overrideReason || !overrideReason.trim()) {
        throw new BadRequestException(
          'Bạn đang chọn xuất lô khác với nguyên tắc FEFO. Bắt buộc phải nhập lý do giải trình!',
        );
      }
    }

    const dispatchedBatches: {
      batchId: string;
      batchNumber: string;
      quantity: number;
      remainingInBatch: number;
    }[] = [];

    let totalDispatched = 0;

    // Duyệt qua từng lô được chọn để kiểm tra và trừ tồn
    for (const item of selectedBatches) {
      const qtyToDeduct = Number(item.quantity);
      if (qtyToDeduct <= 0) continue;

      if (this.databaseService?.isConnected()) {
        try {
          // 1. Kiểm tra tồn kho thực tế của lô trong database
          const batchRows = await this.databaseService.query<{
            id: string;
            batch_number: string;
            quantity: string;
          }>(
            `SELECT id, batch_number, quantity FROM inventory_batches WHERE id = $1::uuid OR id::text = $1`,
            [item.batchId],
          );

          if (batchRows.length === 0) {
            throw new NotFoundException(`Không tìm thấy lô hàng với mã: ${item.batchNumber}`);
          }

          const currentQty = Number(batchRows[0].quantity);
          if (currentQty < qtyToDeduct) {
            throw new BadRequestException(
              `Lô hàng ${item.batchNumber} không đủ số lượng (Tồn: ${currentQty}, Yêu cầu xuất: ${qtyToDeduct})`,
            );
          }

          const newBatchQty = currentQty - qtyToDeduct;

          // 2. Trừ tồn của Lô đã chọn
          await this.databaseService.query(
            `UPDATE inventory_batches 
             SET quantity = $1, 
                 status = CASE WHEN $1 = 0 THEN 'DEPLETED' ELSE status END,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $2::uuid OR id::text = $2`,
            [newBatchQty, item.batchId],
          );

          // 3. Trừ tồn tổng hợp trong bảng inventories
          await this.databaseService.query(
            `UPDATE inventories 
             SET on_hand = GREATEST(0, on_hand - $1), updated_at = CURRENT_TIMESTAMP 
             WHERE (warehouse_id = $2::uuid OR warehouse_id::text = $2)
               AND (product_id = $3::uuid OR product_id::text = $3)`,
            [qtyToDeduct, warehouseId, productId],
          );

          dispatchedBatches.push({
            batchId: item.batchId,
            batchNumber: item.batchNumber,
            quantity: qtyToDeduct,
            remainingInBatch: newBatchQty,
          });

          totalDispatched += qtyToDeduct;
          continue;
        } catch (err) {
          if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
          // Fallback memory
        }
      }

      // Memory Store Update
      const key = `${warehouseId}_${productId}`;
      const batchList = this.memoryBatches.get(key) || [];
      const batchIndex = batchList.findIndex((b) => b.id === item.batchId || b.batchNumber === item.batchNumber);

      if (batchIndex === -1) {
        throw new NotFoundException(`Không tìm thấy lô hàng ${item.batchNumber} trong kho`);
      }

      const targetBatch = batchList[batchIndex];
      if (targetBatch.availableQuantity < qtyToDeduct) {
        throw new BadRequestException(
          `Lô hàng ${item.batchNumber} không đủ số lượng (Tồn: ${targetBatch.availableQuantity}, Yêu cầu: ${qtyToDeduct})`,
        );
      }

      targetBatch.availableQuantity -= qtyToDeduct;
      dispatchedBatches.push({
        batchId: targetBatch.id,
        batchNumber: targetBatch.batchNumber,
        quantity: qtyToDeduct,
        remainingInBatch: targetBatch.availableQuantity,
      });

      totalDispatched += qtyToDeduct;
    }

    const pickerName = currentUser?.username || currentUser?.email || 'Thủ kho';
    const overrideLog = isOverride ? ` (Lý do chọn lô khác: ${overrideReason?.trim()})` : ' (Theo gợi ý FEFO chuẩn)';

    return {
      success: true,
      message: `Đã xuất kho thành công ${totalDispatched} sản phẩm từ ${dispatchedBatches.length} lô hàng${overrideLog}. Người thực hiện: ${pickerName}`,
      totalDispatchedQuantity: totalDispatched,
      dispatchedBatches,
    };
  }
}
