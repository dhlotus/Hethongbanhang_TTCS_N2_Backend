import { BadRequestException, Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { QueryGoodsReceiptsDto } from './dto/query-goods-receipts.dto';
import { GoodsReceiptEntity, GoodsReceiptItemEntity, GoodsReceiptStatus, ReceiptType } from './entities/goods-receipt.entity';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { DEFAULT_WAREHOUSE_ID } from '../warehouses/warehouse.constants';

@Injectable()
export class GoodsReceiptsService implements OnModuleInit {
  private readonly logger = new Logger(GoodsReceiptsService.name);

  private readonly productMap: Record<string, { name: string; sku: string }> = {
    'prod-001': { name: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g', sku: 'LH-MILK-900G' },
    'prod-002': { name: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml', sku: 'LH-NUT-180ML' },
    'prod-003': { name: 'Nước Yến Sào Cao Cấp Loha Nest 70ml', sku: 'LH-NEST-70ML' },
    'prod-004': { name: 'Ngũ Cốc Dinh Dưỡng Hạt Loha Cereal 500g', sku: 'LH-CEREAL-500G' },
    'prod-005': { name: 'Nước Uống Collagen Trắng Da Loha Beauty 50ml', sku: 'LH-COLLAGEN-50ML' },
    'prod-006': { name: 'Trà Thảo Mộc Thanh Nhiệt Loha Herbal Tea 240ml', sku: 'LH-TEA-240ML' },
  };

  private readonly supplierMap: Record<string, string> = {
    '22222222-0000-0000-0000-000000000001': 'Công ty Cổ phần Nước giải khát LOHA Quốc Tế',
    '22222222-0000-0000-0000-000000000002': 'Công ty TNHH Khai Thác Khoáng Tinh Khiết Aqua Life',
    '22222222-0000-0000-0000-000000000003': 'Công ty Cổ phần Sữa & Dinh Dưỡng Quốc Tế NutriPlus',
  };

  private fallbackReceipts: GoodsReceiptEntity[] = [
    {
      id: 'receipt-001',
      code: 'PN2603150001',
      warehouseId: DEFAULT_WAREHOUSE_ID,
      warehouseName: 'Kho Tổng Miền Nam - LOHA WH01',
      supplierId: '22222222-0000-0000-0000-000000000001',
      supplierName: 'Công ty Cổ phần Nước giải khát LOHA Quốc Tế',
      receiptType: ReceiptType.PURCHASE_RECEIPT,
      referenceDocument: 'HD-2026-0315',
      status: GoodsReceiptStatus.CONFIRMED,
      totalCost: 19000000,
      notes: 'Nhập hàng định kỳ tháng 3 theo hợp đồng',
      createdBy: '00000000-0000-0000-0000-000000000004',
      createdByName: 'Nhân viên kho',
      receivedBy: '00000000-0000-0000-0000-000000000004',
      receivedAt: new Date('2026-03-15T10:30:00Z'),
      createdAt: new Date('2026-03-15T08:00:00Z'),
      updatedAt: new Date('2026-03-15T10:30:00Z'),
      items: [
        {
          id: 'item-001',
          receiptId: 'receipt-001',
          productId: 'prod-001',
          productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
          productCode: 'LH-MILK-900G',
          unitId: 'unit-thung',
          unitName: 'Thùng',
          packageQuantity: 50,
          conversionFactor: 24,
          baseQuantity: 1200,
          unitCost: 380000,
          totalCost: 19000000,
          batchNumber: 'LOT-2026-03A',
          mfgDate: new Date('2026-03-01'),
          expiryDate: new Date('2028-03-01'),
          notes: 'Đầy đủ tem niêm phong và CO/CQ',
          createdAt: new Date('2026-03-15T08:00:00Z'),
        },
      ],
    },
    {
      id: 'receipt-002',
      code: 'PN2604010002',
      warehouseId: DEFAULT_WAREHOUSE_ID,
      warehouseName: 'Kho Tổng Miền Nam - LOHA WH01',
      supplierId: '22222222-0000-0000-0000-000000000002',
      supplierName: 'Công ty TNHH Khai Thác Khoáng Tinh Khiết Aqua Life',
      receiptType: ReceiptType.PURCHASE_RECEIPT,
      referenceDocument: 'BB-GN-8842',
      status: GoodsReceiptStatus.DRAFT,
      totalCost: 12500000,
      notes: 'Hàng vừa cập cảng/kho, đang chờ kiểm đếm số lượng',
      createdBy: '00000000-0000-0000-0000-000000000004',
      createdByName: 'Nhân viên kho',
      receivedAt: new Date('2026-04-01T09:00:00Z'),
      createdAt: new Date('2026-04-01T09:00:00Z'),
      updatedAt: new Date('2026-04-01T09:00:00Z'),
      items: [
        {
          id: 'item-002',
          receiptId: 'receipt-002',
          productId: 'prod-002',
          productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
          productCode: 'LH-NUT-180ML',
          unitId: 'unit-loc',
          unitName: 'Lốc',
          packageQuantity: 100,
          conversionFactor: 6,
          baseQuantity: 600,
          unitCost: 125000,
          totalCost: 12500000,
          batchNumber: 'LOT-AL-2026',
          mfgDate: new Date('2026-03-10'),
          expiryDate: new Date('2027-03-10'),
          notes: 'Ngoại quan nguyên vẹn',
          createdAt: new Date('2026-04-01T09:00:00Z'),
        },
      ],
    },
  ];

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

      // Đảm bảo kho mặc định WH01 tồn tại với UUID v4 chuẩn
      await this.db.query(`
        INSERT INTO warehouses (id, code, name, address, phone, status)
        VALUES ('${DEFAULT_WAREHOUSE_ID}', 'WH01', 'Kho Tổng Miền Nam - LOHA WH01', 'Số 18 Đại lộ Độc Lập, KCN Sóng Thần 1, Dĩ An, Bình Dương', '0274379001', 'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET code = 'WH01', name = 'Kho Tổng Miền Nam - LOHA WH01';
      `);

      // Chuẩn hóa dữ liệu cũ nếu warehouse_id đang lưu chuỗi 'WH01'
      await this.db.query(`
        UPDATE goods_receipts 
        SET warehouse_id = '${DEFAULT_WAREHOUSE_ID}' 
        WHERE warehouse_id = 'WH01' OR warehouse_id = '11111111-0000-0000-0000-000000000001';
      `);

      this.logger.log('Đã tạo xong các bảng cho goods_receipts và đồng bộ kho mặc định.');
    } catch (err) {
      this.logger.warn(`Không thể khởi tạo bảng goods_receipts: ${err instanceof Error ? err.message : err}`);
    }
  }

  async create(dto: CreateGoodsReceiptDto, user: ICurrentUser): Promise<{ id: string }> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Phiếu nhập phải có ít nhất 1 mặt hàng');
    }

    if (!this.db?.isConnected()) {
      const now = new Date();
      const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '');
      const code = `PN${dateStr}${String(this.fallbackReceipts.length + 1).padStart(4, '0')}`;
      const totalCost = dto.items.reduce((sum, item) => sum + (item.packageQuantity * (item.unitCost || 0)), 0);
      const newId = `receipt-mock-${Date.now()}`;

      const receiptItems: GoodsReceiptItemEntity[] = dto.items.map((it, idx) => ({
        id: `item-mock-${Date.now()}-${idx}`,
        receiptId: newId,
        productId: it.productId,
        unitId: it.unitId,
        packageQuantity: Number(it.packageQuantity),
        conversionFactor: Number(it.conversionFactor),
        baseQuantity: Number(it.packageQuantity) * Number(it.conversionFactor),
        unitCost: Number(it.unitCost || 0),
        totalCost: Number(it.packageQuantity) * Number(it.unitCost || 0),
        batchNumber: it.batchNumber || '',
        mfgDate: it.mfgDate ? new Date(it.mfgDate) : undefined,
        expiryDate: it.expiryDate ? new Date(it.expiryDate) : new Date(),
        notes: it.notes,
        createdAt: now,
        productName: this.productMap[it.productId]?.name || it.productId,
        productCode: this.productMap[it.productId]?.sku || it.productId,
        unitName: it.unitId,
      }));

      const newReceipt: GoodsReceiptEntity = {
        id: newId,
        code,
        warehouseId: dto.warehouseId || DEFAULT_WAREHOUSE_ID,
        warehouseName: 'Kho Tổng Miền Nam - LOHA WH01',
        supplierId: dto.supplierId,
        supplierName: dto.supplierId ? (this.supplierMap[dto.supplierId] || 'Nhà cung cấp') : undefined,
        receiptType: ReceiptType.PURCHASE_RECEIPT,
        referenceDocument: dto.referenceDocument,
        status: GoodsReceiptStatus.DRAFT,
        totalCost,
        notes: dto.notes,
        createdBy: user?.userId || '00000000-0000-0000-0000-000000000004',
        createdByName: user?.username || 'Nhân viên kho',
        receivedAt: dto.receiptDate ? new Date(dto.receiptDate) : now,
        createdAt: now,
        updatedAt: now,
        items: receiptItems,
      };

      this.fallbackReceipts.unshift(newReceipt);
      return { id: newId };
    }

    const client = await this.db.getClient();
    await client.query('BEGIN');
    try {
      // 1. Generate code
      const codeRes = await client.query(`SELECT 'PN' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || LPAD((COALESCE(MAX(SUBSTRING(code FROM 9)), '0')::INT + 1)::TEXT, 4, '0') AS next_code FROM goods_receipts WHERE code LIKE 'PN' || TO_CHAR(CURRENT_DATE, 'YYMMDD') || '%'`);
      const code = codeRes.rows[0].next_code;

      const totalCost = dto.items.reduce((sum, item) => sum + (item.packageQuantity * (item.unitCost || 0)), 0);

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const creatorId = user?.userId && uuidRegex.test(user.userId)
        ? user.userId
        : '00000000-0000-0000-0000-000000000004';

      let warehouseId = dto.warehouseId;
      if (!uuidRegex.test(warehouseId)) {
        const whRes = await client.query('SELECT id FROM warehouses WHERE code = $1 OR id::text = $1 LIMIT 1', [warehouseId]);
        warehouseId = whRes.rows.length > 0 ? whRes.rows[0].id : DEFAULT_WAREHOUSE_ID;
      }

      let supplierId = dto.supplierId;
      if (supplierId && !uuidRegex.test(supplierId)) {
        const supRes = await client.query('SELECT id FROM suppliers WHERE code = $1 OR id::text = $1 LIMIT 1', [supplierId]);
        supplierId = supRes.rows.length > 0 ? supRes.rows[0].id : null;
      }

      const receiptRes = await client.query(
        `INSERT INTO goods_receipts (
          code, warehouse_id, supplier_id, receipt_type, reference_document, 
          status, total_cost, notes, created_by, received_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`,
        [
          code, warehouseId, supplierId || null, ReceiptType.PURCHASE_RECEIPT, 
          dto.referenceDocument, GoodsReceiptStatus.DRAFT, totalCost, 
          dto.notes, creatorId, dto.receiptDate || null
        ]
      );
      
      const receiptId = receiptRes.rows[0].id;

      for (const item of dto.items) {
        let productId = item.productId;
        if (!uuidRegex.test(productId)) {
          const prodRes = await client.query('SELECT id FROM products WHERE sku = $1 OR id::text = $1 LIMIT 1', [productId]);
          if (prodRes.rows.length > 0) {
            productId = prodRes.rows[0].id;
          }
        }

        const itemTotal = item.packageQuantity * (item.unitCost || 0);
        const baseQty = item.packageQuantity * item.conversionFactor;
        
        await client.query(
          `INSERT INTO goods_receipt_items (
            receipt_id, product_id, unit_id, package_quantity, conversion_factor, 
            base_quantity, unit_cost, total_cost, batch_number, mfg_date, expiry_date, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            receiptId, productId, item.unitId, item.packageQuantity, item.conversionFactor,
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

  private mapToCamelCase<T = Record<string, unknown>>(row: Record<string, unknown>): T {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      const camelKey = key.replace(/_([a-z])/g, (_, g: string) => g.toUpperCase());
      result[camelKey] = row[key];
    }
    return result as T;
  }

  async findAll(query: QueryGoodsReceiptsDto): Promise<{
    data: GoodsReceiptEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    if (!this.db?.isConnected()) {
      let filtered = [...this.fallbackReceipts];
      if (query.warehouseId) {
        filtered = filtered.filter(r => r.warehouseId === query.warehouseId);
      }
      if (query.supplierId) {
        filtered = filtered.filter(r => r.supplierId === query.supplierId);
      }
      if (query.status) {
        filtered = filtered.filter(r => r.status === query.status);
      }
      if (query.search) {
        const s = query.search.toLowerCase();
        filtered = filtered.filter(r =>
          r.code?.toLowerCase().includes(s) ||
          r.referenceDocument?.toLowerCase().includes(s) ||
          r.supplierName?.toLowerCase().includes(s)
        );
      }
      const limit = query.limit ? parseInt(query.limit as string, 10) : 20;
      const page = query.page ? parseInt(query.page as string, 10) : 1;
      const total = filtered.length;
      const offset = (page - 1) * limit;
      const data = filtered.slice(offset, offset + limit);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    }

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
      conditions.push(`(r.code ILIKE $${paramIndex} OR r.reference_document ILIKE $${paramIndex} OR s.name ILIKE $${paramIndex})`);
      params.push(`%${query.search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ? parseInt(query.limit as string, 10) : 20;
    const page = query.page ? parseInt(query.page as string, 10) : 1;
    const offset = (page - 1) * limit;

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) FROM goods_receipts r 
       LEFT JOIN suppliers s ON r.supplier_id::text = s.id::text
       ${whereClause}`,
      params
    );
    const total = parseInt(countRes[0]?.count || '0', 10);

    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT r.*, 
              COALESCE(w.name, 'Kho Tổng Miền Nam - LOHA WH01') as warehouse_name, 
              COALESCE(s.name, 'Nhà cung cấp') as supplier_name, 
              COALESCE(u.full_name, 'Người tạo') as created_by_name
       FROM goods_receipts r
       LEFT JOIN warehouses w ON r.warehouse_id::text = w.id::text
       LEFT JOIN suppliers s ON r.supplier_id::text = s.id::text
       LEFT JOIN users u ON r.created_by::text = u.id::text
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, limit, offset]
    );

    return {
      data: rows.map(r => this.mapToCamelCase<GoodsReceiptEntity>(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findOne(id: string): Promise<GoodsReceiptEntity> {
    if (!this.db?.isConnected()) {
      const found = this.fallbackReceipts.find(r => r.id === id || r.code === id);
      if (!found) {
        throw new NotFoundException('Không tìm thấy phiếu nhập');
      }
      return found;
    }

    const receiptRes = await this.db.query<Record<string, unknown>>(
      `SELECT r.*, 
              COALESCE(w.name, 'Kho Tổng Miền Nam - LOHA WH01') as warehouse_name, 
              COALESCE(s.name, 'Nhà cung cấp') as supplier_name, 
              COALESCE(u.full_name, 'Người tạo') as created_by_name
       FROM goods_receipts r
       LEFT JOIN warehouses w ON r.warehouse_id::text = w.id::text
       LEFT JOIN suppliers s ON r.supplier_id::text = s.id::text
       LEFT JOIN users u ON r.created_by::text = u.id::text
       WHERE r.id = $1`,
      [id]
    );

    if (receiptRes.length === 0) {
      throw new NotFoundException('Không tìm thấy phiếu nhập');
    }

    const itemsRes = await this.db.query<Record<string, unknown>>(
      `SELECT i.*, 
              p.name as product_name, 
              p.sku as product_code, 
              COALESCE(pu.unit_name, 'ĐVT') as unit_name
       FROM goods_receipt_items i
       LEFT JOIN products p ON i.product_id::text = p.id::text
       LEFT JOIN product_units pu ON i.unit_id::text = pu.id::text
       WHERE i.receipt_id = $1`,
      [id]
    );

    const receipt = this.mapToCamelCase<GoodsReceiptEntity>(receiptRes[0]);
    receipt.items = itemsRes.map(item => this.mapToCamelCase<GoodsReceiptItemEntity>(item));
    return receipt;
  }

  async confirm(id: string, user: ICurrentUser): Promise<{ success: boolean; message: string }> {
    if (!this.db?.isConnected()) {
      const receipt = this.fallbackReceipts.find(r => r.id === id || r.code === id);
      if (!receipt) {
        throw new NotFoundException('Không tìm thấy phiếu nhập');
      }
      if (receipt.status !== GoodsReceiptStatus.DRAFT) {
        throw new BadRequestException('Chỉ có thể xác nhận phiếu nhập ở trạng thái nháp');
      }
      receipt.status = GoodsReceiptStatus.CONFIRMED;
      receipt.receivedBy = user?.userId || '00000000-0000-0000-0000-000000000004';
      receipt.receivedAt = new Date();
      receipt.updatedAt = new Date();
      return { success: true, message: 'Xác nhận phiếu nhập kho thành công' };
    }

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

      // Đảm bảo warehouse_id là chuỗi UUID chuẩn trước khi ghi vào inventories
      let targetWarehouseId = receipt.warehouse_id;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(targetWarehouseId)) {
        const whRes = await client.query('SELECT id FROM warehouses WHERE code = $1 OR id::text = $1 LIMIT 1', [targetWarehouseId]);
        targetWarehouseId = whRes.rows.length > 0 ? whRes.rows[0].id : DEFAULT_WAREHOUSE_ID;
        await client.query('UPDATE goods_receipts SET warehouse_id = $1 WHERE id = $2', [targetWarehouseId, id]);
      }

      let transactionUserId: string | null = null;
      if (user?.userId && uuidRegex.test(user.userId)) {
        const userExists = await client.query('SELECT 1 FROM users WHERE id = $1', [user.userId]);
        if (userExists.rows.length > 0) {
          transactionUserId = user.userId;
        }
      }
      const receiverId = transactionUserId || (user?.userId ? user.userId : null);

      const itemsRes = await client.query(`SELECT * FROM goods_receipt_items WHERE receipt_id = $1`, [id]);
      const items = itemsRes.rows;

      let validUserId = null;
      if (user && user.userId) {
        try {
          const uCheck = await client.query(`SELECT id FROM users WHERE id = $1`, [user.userId]);
          if (uCheck.rows.length > 0) {
            validUserId = user.userId;
          }
        } catch {
          // Fallback if users check fails
        }
      }

      for (const item of items) {
        const baseQty = Number(item.base_quantity) || 1;
        const totalCost = Number(item.total_cost) || 0;
        const baseUnitCost = baseQty > 0 ? totalCost / baseQty : Number(item.unit_cost) || 0;

        // 1. Cập nhật tồn kho tổng (inventories)
        await client.query(
          `INSERT INTO inventories (warehouse_id, product_id, on_hand, created_at, updated_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (warehouse_id, product_id) 
           DO UPDATE SET on_hand = inventories.on_hand + $3, updated_at = CURRENT_TIMESTAMP`,
          [targetWarehouseId, item.product_id, baseQty]
        );

        let batchId = null;
        // 2. Cập nhật tồn kho theo lô (inventory_batches) nếu có lô
        const batchNum = item.batch_number ? String(item.batch_number).trim() : null;
        const mfgDate = item.mfg_date ? item.mfg_date : null;
        const expDate = item.expiry_date ? item.expiry_date : null;

        if (batchNum && expDate) {
          const batchRes = await client.query(
            `INSERT INTO inventory_batches (warehouse_id, product_id, batch_number, mfg_date, expiry_date, quantity, cost_price, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (warehouse_id, product_id, batch_number)
             DO UPDATE SET quantity = inventory_batches.quantity + $6, cost_price = $7, updated_at = CURRENT_TIMESTAMP
             RETURNING id`,
            [targetWarehouseId, item.product_id, batchNum, mfgDate, expDate, baseQty, baseUnitCost]
          );
          batchId = batchRes.rows[0].id;
        }

        // Lấy on_hand hiện tại sau khi cộng để ghi transaction
        const onHandRes = await client.query(
          `SELECT on_hand FROM inventories WHERE warehouse_id = $1 AND product_id = $2`,
          [targetWarehouseId, item.product_id]
        );
        const balanceAfter = onHandRes.rows[0]?.on_hand || baseQty;

        // 3. Ghi log giao dịch (inventory_transactions)
        await client.query(
          `INSERT INTO inventory_transactions (
            warehouse_id, product_id, batch_id, transaction_type, quantity_change, 
            balance_after, unit_cost, reference_type, reference_id, created_by, created_at
          ) VALUES ($1, $2, $3, 'IMPORT', $4, $5, $6, 'GOODS_RECEIPT', $7, $8, CURRENT_TIMESTAMP)`,
          [
            targetWarehouseId, item.product_id, batchId, baseQty,
            balanceAfter, baseUnitCost, receipt.code, receiverId
          ]
        );
      }

      // 4. Cập nhật trạng thái phiếu nhập
      await client.query(
        `UPDATE goods_receipts SET status = $1, received_by = $2, received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [GoodsReceiptStatus.CONFIRMED, receiverId, id]
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

  async update(id: string, dto: UpdateGoodsReceiptDto, user: ICurrentUser): Promise<{ success: boolean; message: string }> {
    if (!this.db?.isConnected()) {
      const receipt = this.fallbackReceipts.find(r => r.id === id || r.code === id);
      if (!receipt) {
        throw new NotFoundException('Không tìm thấy phiếu nhập');
      }
      if (receipt.status === GoodsReceiptStatus.CONFIRMED || receipt.status !== GoodsReceiptStatus.DRAFT) {
        throw new BadRequestException('Phiếu đã xác nhận không thể chỉnh sửa, vui lòng lập phiếu điều chỉnh');
      }
      if (dto.warehouseId) receipt.warehouseId = dto.warehouseId;
      if (dto.supplierId !== undefined) {
        receipt.supplierId = dto.supplierId;
        receipt.supplierName = dto.supplierId ? (this.supplierMap[dto.supplierId] || 'Nhà cung cấp') : undefined;
      }
      if (dto.referenceDocument !== undefined) receipt.referenceDocument = dto.referenceDocument;
      if (dto.notes !== undefined) receipt.notes = dto.notes;
      if (dto.receiptDate) receipt.receivedAt = new Date(dto.receiptDate);
      if (dto.items && dto.items.length > 0) {
        receipt.totalCost = dto.items.reduce((sum, item) => sum + (item.packageQuantity * (item.unitCost || 0)), 0);
        receipt.items = dto.items.map((it, idx) => ({
          id: `item-mock-${Date.now()}-${idx}`,
          receiptId: receipt.id,
          productId: it.productId,
          unitId: it.unitId,
          packageQuantity: Number(it.packageQuantity),
          conversionFactor: Number(it.conversionFactor),
          baseQuantity: Number(it.packageQuantity) * Number(it.conversionFactor),
          unitCost: Number(it.unitCost || 0),
          totalCost: Number(it.packageQuantity) * Number(it.unitCost || 0),
          batchNumber: it.batchNumber || '',
          mfgDate: it.mfgDate ? new Date(it.mfgDate) : undefined,
          expiryDate: it.expiryDate ? new Date(it.expiryDate) : new Date(),
          notes: it.notes,
          createdAt: new Date(),
          productName: this.productMap[it.productId]?.name || it.productId,
          productCode: this.productMap[it.productId]?.sku || it.productId,
          unitName: it.unitId,
        }));
      }
      receipt.updatedAt = new Date();
      return { success: true, message: 'Cập nhật phiếu nhập kho thành công' };
    }

    const client = await this.db.getClient();
    await client.query('BEGIN');
    try {
      const receiptRes = await client.query(`SELECT * FROM goods_receipts WHERE id = $1 FOR UPDATE`, [id]);
      if (receiptRes.rows.length === 0) {
        throw new NotFoundException('Không tìm thấy phiếu nhập');
      }

      const receipt = receiptRes.rows[0];
      if (receipt.status === GoodsReceiptStatus.CONFIRMED || receipt.status !== GoodsReceiptStatus.DRAFT) {
        throw new BadRequestException('Phiếu đã xác nhận không thể chỉnh sửa, vui lòng lập phiếu điều chỉnh');
      }

      let warehouseId = dto.warehouseId || receipt.warehouse_id;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(warehouseId)) {
        const whRes = await client.query('SELECT id FROM warehouses WHERE code = $1 OR id::text = $1 LIMIT 1', [warehouseId]);
        warehouseId = whRes.rows.length > 0 ? whRes.rows[0].id : DEFAULT_WAREHOUSE_ID;
      }

      const referenceDocument = dto.referenceDocument !== undefined ? dto.referenceDocument : receipt.reference_document;
      let supplierId = dto.supplierId !== undefined ? dto.supplierId : receipt.supplier_id;
      if (supplierId && !uuidRegex.test(supplierId)) {
        const supRes = await client.query('SELECT id FROM suppliers WHERE code = $1 OR id::text = $1 LIMIT 1', [supplierId]);
        supplierId = supRes.rows.length > 0 ? supRes.rows[0].id : null;
      }
      const notes = dto.notes !== undefined ? dto.notes : receipt.notes;
      const receivedAt = dto.receiptDate !== undefined ? dto.receiptDate : receipt.received_at;

      let totalCost = receipt.total_cost;
      if (dto.items && dto.items.length > 0) {
        totalCost = dto.items.reduce((sum, item) => sum + (item.packageQuantity * (item.unitCost || 0)), 0);

        await client.query(`DELETE FROM goods_receipt_items WHERE receipt_id = $1`, [id]);

        for (const item of dto.items) {
          let productId = item.productId;
          if (!uuidRegex.test(productId)) {
            const prodRes = await client.query('SELECT id FROM products WHERE sku = $1 OR id::text = $1 LIMIT 1', [productId]);
            if (prodRes.rows.length > 0) {
              productId = prodRes.rows[0].id;
            }
          }

          const itemTotal = item.packageQuantity * (item.unitCost || 0);
          const baseQty = item.packageQuantity * item.conversionFactor;

          await client.query(
            `INSERT INTO goods_receipt_items (
              receipt_id, product_id, unit_id, package_quantity, conversion_factor, 
              base_quantity, unit_cost, total_cost, batch_number, mfg_date, expiry_date, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              id, productId, item.unitId, item.packageQuantity, item.conversionFactor,
              baseQty, item.unitCost || 0, itemTotal, item.batchNumber || '', 
              item.mfgDate || null, item.expiryDate || null, item.notes
            ]
          );
        }
      }

      await client.query(
        `UPDATE goods_receipts 
         SET warehouse_id = $1, supplier_id = $2, reference_document = $3, 
             total_cost = $4, notes = $5, received_at = $6, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $7`,
        [warehouseId, supplierId, referenceDocument, totalCost, notes, receivedAt, id]
      );

      await client.query('COMMIT');
      return { success: true, message: 'Cập nhật phiếu nhập kho thành công' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    if (!this.db?.isConnected()) {
      const index = this.fallbackReceipts.findIndex(r => r.id === id || r.code === id);
      if (index === -1) {
        throw new NotFoundException('Không tìm thấy phiếu nhập');
      }
      if (this.fallbackReceipts[index].status === GoodsReceiptStatus.CONFIRMED || this.fallbackReceipts[index].status !== GoodsReceiptStatus.DRAFT) {
        throw new BadRequestException('Phiếu đã xác nhận không thể xóa, vui lòng lập phiếu điều chỉnh');
      }
      this.fallbackReceipts.splice(index, 1);
      return { success: true, message: 'Xóa phiếu nhập thành công' };
    }

    const client = await this.db.getClient();
    await client.query('BEGIN');
    try {
      const receiptRes = await client.query(`SELECT status FROM goods_receipts WHERE id = $1 FOR UPDATE`, [id]);
      if (receiptRes.rows.length === 0) {
        throw new NotFoundException('Không tìm thấy phiếu nhập');
      }

      if (receiptRes.rows[0].status === GoodsReceiptStatus.CONFIRMED || receiptRes.rows[0].status !== GoodsReceiptStatus.DRAFT) {
        throw new BadRequestException('Phiếu đã xác nhận không thể xóa, vui lòng lập phiếu điều chỉnh');
      }

      await client.query(`DELETE FROM goods_receipt_items WHERE receipt_id = $1`, [id]);
      await client.query(`DELETE FROM goods_receipts WHERE id = $1`, [id]);
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
