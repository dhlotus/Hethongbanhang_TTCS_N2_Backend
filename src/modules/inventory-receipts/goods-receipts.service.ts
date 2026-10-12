import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { QueryGoodsReceiptsDto } from './dto/query-goods-receipts.dto';
import { GoodsReceiptEntity, GoodsReceiptItemEntity, GoodsReceiptStatus, ReceiptType } from './entities/goods-receipt.entity';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

export interface PaginatedGoodsReceipts {
  data: GoodsReceiptEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class GoodsReceiptsService implements OnModuleInit {
  private readonly logger = new Logger(GoodsReceiptsService.name);

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    if (!this.db.isConnected()) {
      this.logger.warn('Chưa có kết nối DB PostgreSQL, bỏ qua khởi tạo bảng goods_receipts (chạy chế độ fallback)');
      return;
    }
    try {
      this.logger.log('Khởi tạo bảng goods_receipts và goods_receipt_items...');
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS goods_receipts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code VARCHAR(50) UNIQUE NOT NULL,
          warehouse_id VARCHAR(50) NOT NULL,
          supplier_id VARCHAR(50),
          receipt_type VARCHAR(50) NOT NULL,
          reference_document VARCHAR(100),
          document_url VARCHAR(255),
          status VARCHAR(50) DEFAULT 'DRAFT',
          total_cost DECIMAL(15, 2) DEFAULT 0,
          notes TEXT,
          created_by VARCHAR(50),
          received_by VARCHAR(50),
          received_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await this.db.query(`
        CREATE TABLE IF NOT EXISTS goods_receipt_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          receipt_id UUID REFERENCES goods_receipts(id) ON DELETE CASCADE,
          product_id VARCHAR(50) NOT NULL,
          unit_id VARCHAR(50) NOT NULL,
          package_quantity DECIMAL(15, 2) NOT NULL,
          conversion_factor DECIMAL(10, 2) NOT NULL,
          base_quantity DECIMAL(15, 2) NOT NULL,
          unit_cost DECIMAL(15, 2) NOT NULL,
          total_cost DECIMAL(15, 2) NOT NULL,
          batch_number VARCHAR(50),
          mfg_date DATE,
          expiry_date DATE,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await this.db.query(`
        INSERT INTO warehouses (id, code, name, address, phone, status)
        VALUES ('11111111-0000-0000-0000-000000000001', 'WH01', 'Kho Tổng Miền Nam - LOHA WH01', 'Hồ Chí Minh', '02743790001', 'ACTIVE')
        ON CONFLICT (id) DO NOTHING;
      `);

      await this.db.query(`
        INSERT INTO suppliers (id, code, name, tax_code, contact_name, phone, email, address, payment_terms)
        VALUES 
          ('22222222-0000-0000-0000-000000000001', 'NCC-BEV-01', 'Công ty Cổ phần Nước giải khát LOHA Quốc Tế', '0312345678', 'Ông Đỗ Quốc Tuấn', '02838123456', 'supply@loha.vn', 'KCN Tân Bình, Tây Thạnh, Tân Phú, TP.HCM', 'NET_45'),
          ('22222222-0000-0000-0000-000000000002', 'NCC-AQUA-02', 'Công ty TNHH Khai Thác Khoáng Tinh Khiết Aqua Life', '0398765432', 'Bà Mai Thị Lan', '02723789012', 'contact@aqualife.vn', 'Xã Long Hậu, Cần Giuộc, Long An', 'NET_30')
        ON CONFLICT (id) DO NOTHING;
      `);
      this.logger.log('Đã tạo xong các bảng và dữ liệu mẫu cho goods_receipts.');
    } catch (err) {
      this.logger.warn(`Không thể khởi tạo bảng goods_receipts: ${err instanceof Error ? err.message : err}`);
    }
  }

  async create(dto: CreateGoodsReceiptDto, user: ICurrentUser): Promise<{ id: string }> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Phiếu nhập phải có ít nhất 1 mặt hàng');
    }

    const client = await this.db.getClient();
    await client.query('BEGIN');
    try {
      // 1. Generate code
      const codeRes = await client.query(`SELECT 'PN' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || LPAD((COALESCE(MAX(SUBSTRING(code FROM 9)), '0')::INT + 1)::TEXT, 4, '0') AS next_code FROM goods_receipts WHERE code LIKE 'PN' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || '%'`);
      const code = codeRes.rows[0].next_code;

      const totalCost = dto.items.reduce((sum, item) => sum + (item.packageQuantity * (item.unitCost || 0)), 0);

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const targetWarehouseId = dto.warehouseId && uuidRegex.test(dto.warehouseId)
        ? dto.warehouseId
        : '11111111-0000-0000-0000-000000000001';

      await client.query(`
        INSERT INTO warehouses (id, code, name, address, phone, status)
        VALUES ($1, 'WH01', 'Kho Tổng Miền Nam - LOHA WH01', 'Số 18 Đại lộ Độc Lập, KCN Sóng Thần 1, Dĩ An, Bình Dương', '02743790001', 'ACTIVE')
        ON CONFLICT (id) DO NOTHING;
      `, [targetWarehouseId]);

      let targetSupplierId: string | null = null;
      if (dto.supplierId && uuidRegex.test(dto.supplierId)) {
        const supCheck = await client.query(`SELECT id FROM suppliers WHERE id = $1`, [dto.supplierId]);
        if (supCheck.rows.length > 0) {
          targetSupplierId = dto.supplierId;
        }
      }

      let creatorId: string | null = null;
      if (user?.userId && uuidRegex.test(user.userId)) {
        const userCheck = await client.query(`SELECT id FROM users WHERE id = $1`, [user.userId]);
        if (userCheck.rows.length > 0) {
          creatorId = user.userId;
        }
      }

      const receiptRes = await client.query(
        `INSERT INTO goods_receipts (
          code, warehouse_id, supplier_id, receipt_type, reference_document, 
          status, total_cost, notes, created_by, received_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
        [
          code, targetWarehouseId, targetSupplierId, ReceiptType.PURCHASE_RECEIPT, 
          dto.referenceDocument || null, GoodsReceiptStatus.DRAFT, totalCost, 
          dto.notes || null, creatorId, dto.receiptDate || null
        ]
      );
      
      const receiptId = receiptRes.rows[0].id;

      for (const item of dto.items) {
        if (!uuidRegex.test(item.productId)) {
          throw new BadRequestException(`Mã sản phẩm "${item.productId}" không đúng định dạng UUID`);
        }

        const prodRes = await client.query(`SELECT id, name, base_unit FROM products WHERE id = $1`, [item.productId]);
        if (prodRes.rows.length === 0) {
          throw new NotFoundException(`Không tìm thấy sản phẩm có ID: ${item.productId}`);
        }
        const productBaseUnit = prodRes.rows[0].base_unit || 'ĐVT';

        const itemTotal = item.packageQuantity * (item.unitCost || 0);
        const baseQty = item.packageQuantity * item.conversionFactor;

        let unitId: string | null = null;
        if (item.unitId && uuidRegex.test(item.unitId)) {
          const unitCheck = await client.query(`SELECT id FROM product_units WHERE id = $1`, [item.unitId]);
          if (unitCheck.rows.length > 0) {
            unitId = unitCheck.rows[0].id;
          }
        }

        if (!unitId) {
          const unitRes = await client.query(`SELECT id FROM product_units WHERE product_id = $1 LIMIT 1`, [item.productId]);
          if (unitRes.rows.length > 0) {
            unitId = unitRes.rows[0].id;
          } else {
            const newUnitRes = await client.query(`
              INSERT INTO product_units (id, product_id, unit_name, conversion_factor, is_base_unit)
              VALUES (gen_random_uuid(), $1, $2, 1, true)
              RETURNING id
            `, [item.productId, productBaseUnit]);
            unitId = newUnitRes.rows[0].id;
          }
        }

        const batchNum = item.batchNumber || `LOT-${code}`;
        const expDate = item.expiryDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        
        await client.query(
          `INSERT INTO goods_receipt_items (
            receipt_id, product_id, unit_id, package_quantity, conversion_factor, 
            base_quantity, unit_cost, total_cost, batch_number, mfg_date, expiry_date, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            receiptId, item.productId, unitId, item.packageQuantity, item.conversionFactor,
            baseQty, item.unitCost || 0, itemTotal, batchNum, 
            item.mfgDate || null, expDate, item.notes || null
          ]
        );
      }

      await client.query('COMMIT');
      return { id: receiptId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findAll(query: QueryGoodsReceiptsDto): Promise<PaginatedGoodsReceipts> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (query.warehouseId) {
      conditions.push(`r.warehouse_id = $${paramIndex++}`);
      params.push(query.warehouseId);
    }
    if (query.supplierId) {
      conditions.push(`r.supplier_id = $${paramIndex++}`);
      params.push(query.supplierId);
    }
    if (query.status) {
      conditions.push(`r.status = $${paramIndex++}`);
      params.push(query.status);
    }
    if (query.search) {
      conditions.push(`(r.code ILIKE $${paramIndex} OR r.reference_document ILIKE $${paramIndex})`);
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ? parseInt(query.limit as string) : 20;
    const page = query.page ? parseInt(query.page as string) : 1;
    const offset = (page - 1) * limit;

    const countRes = await this.db.query(`SELECT COUNT(*) FROM goods_receipts r ${whereClause}`, params);
    const total = parseInt(countRes[0].count);

    const rows = await this.db.query(
      `SELECT r.*, 'Kho Tổng Miền Nam - LOHA WH01' as warehouse_name, 'Nhà cung cấp' as supplier_name, 'Người tạo' as created_by_name
       FROM goods_receipts r
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    const mapToCamelCase = <T = Record<string, unknown>>(row: Record<string, unknown>): T => {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
        result[camelKey] = row[key];
      }
      return result as T;
    };

    return {
      data: rows.map((row: Record<string, unknown>) => mapToCamelCase<GoodsReceiptEntity>(row)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<GoodsReceiptEntity> {
    const receiptRes = await this.db.query(
      `SELECT r.*, 'Kho Tổng Miền Nam - LOHA WH01' as warehouse_name, 'Nhà cung cấp' as supplier_name, 'Người tạo' as created_by_name
       FROM goods_receipts r
       WHERE r.id = $1`,
      [id]
    );

    if (receiptRes.length === 0) {
      throw new NotFoundException('Không tìm thấy phiếu nhập');
    }

    const itemsRes = await this.db.query(
      `SELECT i.*, p.name as product_name, p.sku as product_code, 'ĐVT' as unit_name
       FROM goods_receipt_items i
       LEFT JOIN products p ON i.product_id::text = p.id::text
       WHERE i.receipt_id = $1`,
      [id]
    );

    const mapToCamelCase = <T = Record<string, unknown>>(row: Record<string, unknown>): T => {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
        result[camelKey] = row[key];
      }
      return result as T;
    };

    const receipt = mapToCamelCase<GoodsReceiptEntity>(receiptRes[0]);
    receipt.items = itemsRes.map((item: Record<string, unknown>) => mapToCamelCase<GoodsReceiptItemEntity>(item));
    return receipt;
  }

  async confirm(id: string, user: ICurrentUser): Promise<{ success: boolean; message: string }> {
    const client = await this.db.getClient();
    await client.query('BEGIN');
    try {
      const receiptRes = await client.query(`SELECT * FROM goods_receipts WHERE id = $1 FOR UPDATE`, [id]);
      if (receiptRes.rows.length === 0) {
        throw new NotFoundException('Không tìm thấy phiếu nhập');
      }

      const receipt = receiptRes.rows[0];
      if (receipt.status !== GoodsReceiptStatus.DRAFT) {
        throw new BadRequestException('Chỉ có thể xác nhận phiếu nhập ở trạng thái nháp');
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const targetWarehouseId = receipt.warehouse_id && uuidRegex.test(receipt.warehouse_id)
        ? receipt.warehouse_id
        : '11111111-0000-0000-0000-000000000001';

      await client.query(`
        INSERT INTO warehouses (id, code, name, address, phone, status)
        VALUES ($1, 'WH01', 'Kho Tổng Miền Nam - LOHA WH01', 'Hồ Chí Minh', '02743790001', 'ACTIVE')
        ON CONFLICT (id) DO NOTHING;
      `, [targetWarehouseId]);

      let authorUserId: string | null = null;
      if (user?.userId && uuidRegex.test(user.userId)) {
        const userCheck = await client.query(`SELECT id FROM users WHERE id = $1`, [user.userId]);
        if (userCheck.rows.length > 0) {
          authorUserId = user.userId;
        }
      }

      const itemsRes = await client.query(`SELECT * FROM goods_receipt_items WHERE receipt_id = $1`, [id]);
      const items = itemsRes.rows;

      for (const item of items) {
        const validProductId = uuidRegex.test(item.product_id) ? item.product_id : null;
        if (!validProductId) continue;

        const prodCheck = await client.query(`SELECT id FROM products WHERE id = $1`, [validProductId]);
        if (prodCheck.rows.length === 0) continue;

        // 1. Cập nhật tồn kho tổng (inventories)
        await client.query(
          `INSERT INTO inventories (warehouse_id, product_id, on_hand, created_at, updated_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (warehouse_id, product_id) 
           DO UPDATE SET on_hand = inventories.on_hand + $3, updated_at = CURRENT_TIMESTAMP`,
          [targetWarehouseId, validProductId, item.base_quantity]
        );

        let batchId: string | null = null;
        // 2. Cập nhật tồn kho theo lô (inventory_batches)
        const batchNum = item.batch_number || `LOT-${receipt.code}`;
        const expDate = item.expiry_date || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const batchRes = await client.query(
          `INSERT INTO inventory_batches (warehouse_id, product_id, batch_number, mfg_date, expiry_date, quantity, cost_price, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (warehouse_id, product_id, batch_number)
           DO UPDATE SET quantity = inventory_batches.quantity + $6, updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [targetWarehouseId, validProductId, batchNum, item.mfg_date || null, expDate, item.base_quantity, item.unit_cost]
        );
        batchId = batchRes.rows[0].id;

        // Lấy on_hand hiện tại sau khi cộng để ghi transaction
        const onHandRes = await client.query(
          `SELECT on_hand FROM inventories WHERE warehouse_id = $1 AND product_id = $2`,
          [targetWarehouseId, validProductId]
        );
        const balanceAfter = onHandRes.rows[0].on_hand;

        // 3. Ghi log giao dịch (inventory_transactions)
        await client.query(
          `INSERT INTO inventory_transactions (
            warehouse_id, product_id, batch_id, transaction_type, quantity_change, 
            balance_after, unit_cost, reference_type, reference_id, created_by, created_at
          ) VALUES ($1, $2, $3, 'IMPORT', $4, $5, $6, 'GOODS_RECEIPT', $7, $8, CURRENT_TIMESTAMP)`,
          [
            targetWarehouseId, validProductId, batchId, item.base_quantity,
            balanceAfter, item.unit_cost, receipt.code, authorUserId
          ]
        );
      }

      // 4. Cập nhật trạng thái phiếu nhập
      await client.query(
        `UPDATE goods_receipts SET status = $1, received_by = $2, received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [GoodsReceiptStatus.CONFIRMED, authorUserId, id]
      );

      await client.query('COMMIT');
      return { success: true, message: 'Xác nhận phiếu nhập kho thành công' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const client = await this.db.getClient();
    await client.query('BEGIN');
    try {
      const receiptRes = await client.query(`SELECT status FROM goods_receipts WHERE id = $1 FOR UPDATE`, [id]);
      if (receiptRes.rows.length === 0) {
        throw new NotFoundException('Không tìm thấy phiếu nhập');
      }

      if (receiptRes.rows[0].status !== GoodsReceiptStatus.DRAFT) {
        throw new BadRequestException('Chỉ có thể xóa phiếu nhập ở trạng thái nháp');
      }

      await client.query(`DELETE FROM goods_receipts WHERE id = $1`, [id]); // items will cascade
      await client.query('COMMIT');
      return { success: true, message: 'Xóa phiếu nhập thành công' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

