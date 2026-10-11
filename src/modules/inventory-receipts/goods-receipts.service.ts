import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { QueryGoodsReceiptsDto } from './dto/query-goods-receipts.dto';
import { GoodsReceiptEntity, GoodsReceiptItemEntity, GoodsReceiptStatus, ReceiptType } from './entities/goods-receipt.entity';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';

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
      this.logger.log('Đã tạo xong các bảng cho goods_receipts.');
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
      const codeRes = await client.query(`SELECT 'PN' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || LPAD(COALESCE(MAX(SUBSTRING(code FROM 9)), '0')::INT + 1, 4, '0') AS next_code FROM goods_receipts WHERE code LIKE 'PN' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || '%'`);
      const code = codeRes.rows[0].next_code;

      const totalCost = dto.items.reduce((sum, item) => sum + (item.packageQuantity * (item.unitCost || 0)), 0);

      const receiptRes = await client.query(
        `INSERT INTO goods_receipts (
          code, warehouse_id, supplier_id, receipt_type, reference_document, 
          status, total_cost, notes, created_by, received_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
        [
          code, dto.warehouseId, dto.supplierId || null, ReceiptType.PURCHASE_RECEIPT, 
          dto.referenceDocument, GoodsReceiptStatus.DRAFT, totalCost, 
          dto.notes, user.userId, dto.receiptDate || null
        ]
      );
      
      const receiptId = receiptRes.rows[0].id;

      for (const item of dto.items) {
        const itemTotal = item.packageQuantity * (item.unitCost || 0);
        const baseQty = item.packageQuantity * item.conversionFactor;
        
        await client.query(
          `INSERT INTO goods_receipt_items (
            receipt_id, product_id, unit_id, package_quantity, conversion_factor, 
            base_quantity, unit_cost, total_cost, batch_number, mfg_date, expiry_date, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            receiptId, item.productId, item.unitId, item.packageQuantity, item.conversionFactor,
            baseQty, item.unitCost || 0, itemTotal, item.batchNumber || '', 
            item.mfgDate || null, item.expiryDate || null, item.notes
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

  async findAll(query: QueryGoodsReceiptsDto): Promise<any> {
    const conditions: string[] = [];
    const params: any[] = [];
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

    const mapToCamelCase = (row: any) => {
      const result: any = {};
      for (const key of Object.keys(row)) {
        const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        result[camelKey] = row[key];
      }
      return result;
    };

    return {
      data: rows.map(mapToCamelCase),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<any> {
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
       LEFT JOIN products p ON i.product_id = p.id
       WHERE i.receipt_id = $1`,
      [id]
    );

    const mapToCamelCase = (row: any) => {
      const result: any = {};
      for (const key of Object.keys(row)) {
        const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        result[camelKey] = row[key];
      }
      return result;
    };

    return {
      ...mapToCamelCase(receiptRes[0]),
      items: itemsRes.map(mapToCamelCase),
    };
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

      const itemsRes = await client.query(`SELECT * FROM goods_receipt_items WHERE receipt_id = $1`, [id]);
      const items = itemsRes.rows;

      for (const item of items) {
        // 1. Cập nhật tồn kho tổng (inventories)
        await client.query(
          `INSERT INTO inventories (warehouse_id, product_id, on_hand, created_at, updated_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (warehouse_id, product_id) 
           DO UPDATE SET on_hand = inventories.on_hand + $3, updated_at = CURRENT_TIMESTAMP`,
          [receipt.warehouse_id, item.product_id, item.base_quantity]
        );

        let batchId = null;
        // 2. Cập nhật tồn kho theo lô (inventory_batches) nếu có lô
        if (item.batch_number && item.expiry_date) {
          const batchRes = await client.query(
            `INSERT INTO inventory_batches (warehouse_id, product_id, batch_number, mfg_date, expiry_date, quantity, cost_price, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (warehouse_id, product_id, batch_number)
             DO UPDATE SET quantity = inventory_batches.quantity + $6, updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [receipt.warehouse_id, item.product_id, item.batch_number, item.mfg_date, item.expiry_date, item.base_quantity, item.unit_cost]
          );
          batchId = batchRes.rows[0].id;
        }

        // Lấy on_hand hiện tại sau khi cộng để ghi transaction
        const onHandRes = await client.query(
          `SELECT on_hand FROM inventories WHERE warehouse_id = $1 AND product_id = $2`,
          [receipt.warehouse_id, item.product_id]
        );
        const balanceAfter = onHandRes.rows[0].on_hand;

        // 3. Ghi log giao dịch (inventory_transactions)
        await client.query(
          `INSERT INTO inventory_transactions (
            warehouse_id, product_id, batch_id, transaction_type, quantity_change, 
            balance_after, unit_cost, reference_type, reference_id, created_by, created_at
          ) VALUES ($1, $2, $3, 'IMPORT', $4, $5, $6, 'GOODS_RECEIPT', $7, $8, CURRENT_TIMESTAMP)`,
          [
            receipt.warehouse_id, item.product_id, batchId, item.base_quantity,
            balanceAfter, item.unit_cost, receipt.code, user.userId
          ]
        );
      }

      // 4. Cập nhật trạng thái phiếu nhập
      await client.query(
        `UPDATE goods_receipts SET status = $1, received_by = $2, received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [GoodsReceiptStatus.CONFIRMED, user.userId, id]
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
