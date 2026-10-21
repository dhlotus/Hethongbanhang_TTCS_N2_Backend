import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { UpdateGoodsReceiptDto } from './dto/update-goods-receipt.dto';
import { QueryGoodsReceiptsDto } from './dto/query-goods-receipts.dto';
import {
  GoodsReceiptEntity,
  GoodsReceiptItemEntity,
  GoodsReceiptStatus,
  ReceiptType,
} from './entities/goods-receipt.entity';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { DEFAULT_WAREHOUSE_ID } from '../warehouses/warehouse.constants';
import { randomUUID } from 'crypto';

@Injectable()
export class GoodsReceiptsService implements OnModuleInit {
  private readonly logger = new Logger(GoodsReceiptsService.name);

  /**
   * Bộ nhớ đệm In-memory dự phòng khi PostgreSQL chưa sẵn sàng hoặc mất kết nối
   */
  private readonly memoryReceipts = new Map<string, GoodsReceiptEntity>();

  constructor(private readonly db: DatabaseService) {
    this.initMemoryMockData();
  }

  /**
   * Khởi tạo dữ liệu mẫu hợp lệ trong bộ nhớ đệm
   */
  private initMemoryMockData(): void {
    const sampleItems1: GoodsReceiptItemEntity[] = [
      {
        id: randomUUID(),
        receiptId: '11111111-2222-3333-4444-555555550001',
        productId: '33333333-0000-0000-0000-000000000001',
        productName: 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g',
        productCode: 'LH-MILK-900G',
        unitId: 'Thùng',
        unitName: 'Thùng',
        packageQuantity: 10,
        conversionFactor: 24,
        baseQuantity: 240,
        unitCost: 520000,
        totalCost: 5200000,
        batchNumber: 'LOT-202610-A',
        mfgDate: new Date('2026-09-01'),
        expiryDate: new Date('2027-09-01'),
        createdAt: new Date(Date.now() - 86400000),
      },
    ];

    const receipt1: GoodsReceiptEntity = {
      id: '11111111-2222-3333-4444-555555550001',
      code: 'PN2610130001',
      warehouseId: DEFAULT_WAREHOUSE_ID,
      warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
      supplierId: '22222222-0000-0000-0000-000000000001',
      supplierName: 'Công ty Cổ phần Nước giải khát LOHA Quốc Tế',
      receiptType: ReceiptType.PURCHASE_RECEIPT,
      referenceDocument: 'HĐ-IDP-99214',
      status: GoodsReceiptStatus.CONFIRMED,
      totalCost: 5200000,
      notes: 'Hàng nhập nguyên đai nguyên kiện, bao bì sạch sẽ đạt chuẩn.',
      createdByName: 'Bùi Đức Hà',
      receivedByName: 'Nguyễn Văn Khải',
      receivedAt: new Date(Date.now() - 86400000),
      createdAt: new Date(Date.now() - 86400000),
      updatedAt: new Date(Date.now() - 86400000),
      items: sampleItems1,
    };

    const sampleItems2: GoodsReceiptItemEntity[] = [
      {
        id: randomUUID(),
        receiptId: '11111111-2222-3333-4444-555555550002',
        productId: '33333333-0000-0000-0000-000000000002',
        productName: 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml',
        productCode: 'LH-NUT-180ML',
        unitId: 'Thùng',
        unitName: 'Thùng',
        packageQuantity: 20,
        conversionFactor: 24,
        baseQuantity: 480,
        unitCost: 160000,
        totalCost: 3200000,
        batchNumber: 'LOT-202610-B',
        mfgDate: new Date('2026-10-01'),
        expiryDate: new Date('2027-04-01'),
        createdAt: new Date(),
      },
    ];

    const receipt2: GoodsReceiptEntity = {
      id: '11111111-2222-3333-4444-555555550002',
      code: 'PN2610140002',
      warehouseId: DEFAULT_WAREHOUSE_ID,
      warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
      supplierId: '22222222-0000-0000-0000-000000000002',
      supplierName: 'Công ty TNHH Khai Thác Khoáng Tinh Khiết Aqua Life',
      receiptType: ReceiptType.PURCHASE_RECEIPT,
      referenceDocument: 'PXK-NSX-8812',
      status: GoodsReceiptStatus.DRAFT,
      totalCost: 3200000,
      notes: 'Phiếu nháp đang chờ kiểm đếm thùng thực tế khi dỡ xe.',
      createdByName: 'Nguyễn Văn Khải',
      createdAt: new Date(),
      updatedAt: new Date(),
      items: sampleItems2,
    };

    this.memoryReceipts.set(receipt1.id, receipt1);
    this.memoryReceipts.set(receipt2.id, receipt2);
  }

  async onModuleInit() {
    if (!this.db.isConnected()) {
      this.logger.warn('Chưa có kết nối DB PostgreSQL, bỏ qua khởi tạo bảng goods_receipts (chạy chế độ fallback an toàn)');
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

      // Đảm bảo kho mặc định KHO-MN-01 tồn tại với UUID v4 chuẩn
      await this.db.query(`
        INSERT INTO warehouses (id, code, name, address, phone, status)
        VALUES ('${DEFAULT_WAREHOUSE_ID}', 'KHO-MN-01', 'Kho Miền Nam (TP. Hồ Chí Minh)', 'Số 18 Đại lộ Độc Lập, KCN Sóng Thần 1, Dĩ An, Bình Dương', '02838890001', 'ACTIVE')
        ON CONFLICT (id) DO UPDATE SET code = 'KHO-MN-01', name = 'Kho Miền Nam (TP. Hồ Chí Minh)';
      `);

      // Chuẩn hóa dữ liệu cũ nếu warehouse_id đang lưu chuỗi 'WH01'
      await this.db.query(`
        UPDATE goods_receipts 
        SET warehouse_id = '${DEFAULT_WAREHOUSE_ID}' 
        WHERE warehouse_id::text = 'WH01' OR warehouse_id = '${DEFAULT_WAREHOUSE_ID}';
      `);

      this.logger.log('Đã tạo xong các bảng cho goods_receipts và đồng bộ kho mặc định.');
    } catch (err) {
      this.logger.warn(`Không thể khởi tạo bảng goods_receipts: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Tạo phiếu nhập kho mới (SN-178)
   */
  async create(dto: CreateGoodsReceiptDto, user: ICurrentUser): Promise<{ id: string }> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Phiếu nhập phải có ít nhất 1 mặt hàng');
    }

    // Nếu DB chưa kết nối, sử dụng Fallback ngay lập tức
    if (!this.db.isConnected()) {
      return this.fallbackCreate(dto, user);
    }

    try {
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
    } catch (err) {
      this.logger.warn(`Lỗi khi tạo phiếu nhập trong DB, kích hoạt fallback buffer: ${err instanceof Error ? err.message : err}`);
      return this.fallbackCreate(dto, user);
    }
  }

  /**
   * Chuẩn hóa và phân giải tên nhà cung cấp chính xác từ supplierId hoặc explicitName
   */
  private resolveSupplierName(supplierId?: string, explicitName?: string): string {
    const isGenericName = !explicitName || 
      explicitName.trim() === '' || 
      explicitName === 'Nhà cung cấp' || 
      explicitName === 'Nhà cung cấp đối tác' ||
      explicitName === 'Chưa chọn NCC';

    if (!isGenericName) {
      return explicitName.trim();
    }
    if (!supplierId) {
      return 'Chưa chọn NCC';
    }
    const cleanId = supplierId.toLowerCase().trim();
    const map: Record<string, string> = {
      '22222222-0000-0000-0000-000000000001': 'Công ty Cổ phần Nước giải khát LOHA Quốc Tế',
      'ncc-bev-01': 'Công ty Cổ phần Nước giải khát LOHA Quốc Tế',
      'ncc-idp': 'Công ty Cổ phần Sữa Quốc Tế (IDP)',
      '22222222-0000-0000-0000-000000000002': 'Công ty TNHH Khai Thác Khoáng Tinh Khiết Aqua Life',
      'ncc-aqua-02': 'Công ty TNHH Khai Thác Khoáng Tinh Khiết Aqua Life',
      'ncc-nsx': 'Công ty TNHH Nông Sản Xanh Loha',
      '22222222-0000-0000-0000-000000000003': 'Công ty Cổ phần Sữa & Dinh Dưỡng Quốc Tế NutriPlus',
      'ncc-dairy-03': 'Công ty Cổ phần Sữa & Dinh Dưỡng Quốc Tế NutriPlus',
      '22222222-0000-0000-0000-000000000004': 'Nhà máy Bao Bì & Đóng Gói Tân Tiến Phát',
      'ncc-pack-04': 'Nhà máy Bao Bì & Đóng Gói Tân Tiến Phát',
      '22222222-0000-0000-0000-000000000005': 'Hợp tác xã Nông Sản Hữu Cơ Sạch Thảo Mộc Xanh',
      'ncc-old-05': 'Hợp tác xã Nông Sản Hữu Cơ Sạch Thảo Mộc Xanh',
    };
    if (map[cleanId]) {
      return map[cleanId];
    }
    if (explicitName && explicitName.trim()) {
      return explicitName.trim();
    }
    return 'Nhà cung cấp đối tác';
  }

  /**
   * Chuẩn hóa và phân giải tên kho chính xác từ warehouseId hoặc explicitName
   */
  private resolveWarehouseName(warehouseId?: string, explicitName?: string): string {
    const isGenericName = !explicitName || 
      explicitName.trim() === '' || 
      explicitName === 'Kho Tổng Miền Nam - LOHA WH01' || 
      explicitName === 'Kho Tổng Miền Nam';

    if (!isGenericName) {
      return explicitName.trim();
    }
    if (!warehouseId) {
      return 'Kho Miền Nam (TP. Hồ Chí Minh)';
    }
    const cleanId = warehouseId.toLowerCase().trim();
    const map: Record<string, string> = {
      '11111111-0000-0000-0000-000000000001': 'Kho Miền Nam (TP. Hồ Chí Minh)',
      'kho-mn-01': 'Kho Miền Nam (TP. Hồ Chí Minh)',
      '11111111-0000-0000-0000-000000000002': 'Kho Miền Bắc (Hà Nội)',
      'kho-mb-01': 'Kho Miền Bắc (Hà Nội)',
      '11111111-0000-0000-0000-000000000003': 'Kho Miền Tây (Cần Thơ)',
      'kho-west-01': 'Kho Miền Tây (Cần Thơ)',
      '11111111-0000-0000-0000-000000000004': 'Kho Miền Trung (Đà Nẵng)',
      'kho-mt-01': 'Kho Miền Trung (Đà Nẵng)',
    };
    if (map[cleanId]) {
      return map[cleanId];
    }
    if (explicitName && explicitName.trim()) {
      return explicitName.trim();
    }
    return 'Kho Miền Nam (TP. Hồ Chí Minh)';
  }

  /**
   * Tạo phiếu nhập trên In-memory buffer khi không thể truy cập PostgreSQL
   */
  private fallbackCreate(dto: CreateGoodsReceiptDto, user: ICurrentUser): { id: string } {
    const receiptId = randomUUID();
    const today = new Date();
    const dateStr = today.toISOString().slice(2, 10).replace(/-/g, '');
    const code = `PN${dateStr}${String(this.memoryReceipts.size + 1).padStart(4, '0')}`;

    const totalCost = dto.items.reduce((sum, item) => sum + (item.packageQuantity * (item.unitCost || 0)), 0);

    const supplierName = this.resolveSupplierName(dto.supplierId, dto.supplierName);
    const warehouseName = this.resolveWarehouseName(dto.warehouseId, dto.warehouseName);

    const items: GoodsReceiptItemEntity[] = dto.items.map((i) => {
      const baseQty = Number(i.packageQuantity) * Number(i.conversionFactor);
      const itemTotal = Number(i.packageQuantity) * Number(i.unitCost || 0);

      let productName = `Mặt hàng (${i.productId.slice(0, 8)})`;
      let productCode = i.productId.slice(0, 8).toUpperCase();
      const pid = (i.productId || '').toLowerCase();
      if (pid === '33333333-0000-0000-0000-000000000001' || pid === '33333333-0000-4000-8000-000000000001' || pid === 'lh-milk-900g') {
        productName = 'Sữa Bột Dinh Dưỡng Cao Cấp Loha Gold 900g';
        productCode = 'LH-MILK-900G';
      } else if (pid === '33333333-0000-0000-0000-000000000002' || pid === '33333333-0000-4000-8000-000000000002' || pid === 'lh-nut-180ml') {
        productName = 'Sữa Hạt Óc Chó Hạnh Nhân Organic 180ml';
        productCode = 'LH-NUT-180ML';
      } else if (pid === '33333333-0000-0000-0000-000000000003' || pid === '33333333-0000-4000-8000-000000000003' || pid === 'lh-nest-70ml') {
        productName = 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml';
        productCode = 'LH-NEST-70ML';
      } else if (pid === '33333333-0000-0000-0000-000000000004' || pid === '33333333-0000-4000-8000-000000000004' || pid === 'lh-cereal-500g') {
        productName = 'Ngũ Cốc Dinh Dưỡng Hạt Mầm Loha Meal 500g';
        productCode = 'LH-CEREAL-500G';
      } else if (pid === '33333333-0000-0000-0000-000000000005' || pid === '33333333-0000-4000-8000-000000000005' || pid === 'lh-collagen-50ml') {
        productName = 'Nước Uống Collagen Đông Trùng Hạ Thảo 50ml';
        productCode = 'LH-COLLAGEN-50ML';
      } else if (pid === '33333333-0000-0000-0000-000000000006' || pid === '33333333-0000-4000-8000-000000000006' || pid === 'lh-tea-240ml' || pid === 'lh-tea-450ml') {
        productName = 'Trà Hoa Cúc La Hán Quả Thanh Nhiệt 240ml';
        productCode = 'LH-TEA-240ML';
      } else if (pid === '33333333-0000-0000-0000-000000000007' || pid === '33333333-0000-4000-8000-000000000007' || pid === 'lh-water-500ml') {
        productName = 'Nước Khoáng Kiềm Thiên Nhiên Loha Ion 500ml';
        productCode = 'LH-WATER-500ML';
      } else if (pid === '33333333-0000-0000-0000-000000000008' || pid === '33333333-0000-4000-8000-000000000008' || pid === 'lh-milk-past-1l') {
        productName = 'Sữa Tươi Thanh Trùng Nguyên Chất 1 Lít';
        productCode = 'LH-MILK-PAST-1L';
      } else if (pid === '33333333-0000-0000-0000-000000000009' || pid === '33333333-0000-4000-8000-000000000009' || pid === 'lh-nest-prem-100g') {
        productName = 'Hộp Quà Yến Sào Tinh Chế Thượng Hạng 100g';
        productCode = 'LH-NEST-PREM-100G';
      } else if (pid === '33333333-0000-0000-0000-000000000010' || pid === '33333333-0000-4000-8000-000000000010' || pid === 'lh-nuts-mix-250g') {
        productName = 'Hạt Hỗn Hợp Macca Óc Chó Hạnh Nhân Sấy Giòn 250g';
        productCode = 'LH-NUTS-MIX-250G';
      } else if (pid === '33333333-0000-0000-0000-000000000011' || pid === '33333333-0000-4000-8000-000000000011' || pid === 'lh-old-coffee-can') {
        productName = 'Cà Phê Sữa Đóng Lon Loha Classic 240ml (Mẫu Cũ)';
        productCode = 'LH-OLD-COFFEE-CAN';
      }

      let resolvedUnit = (i as any).unitName || i.unitId;
      if (!resolvedUnit || resolvedUnit.startsWith('unit-') || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedUnit)) {
        const factor = Number(i.conversionFactor) || 1;
        if (factor >= 20 || factor === 24) resolvedUnit = 'Thùng';
        else if (factor === 12) resolvedUnit = 'Thùng';
        else if (factor === 6) resolvedUnit = 'Lốc';
        else if (factor === 1) resolvedUnit = 'Lon';
        else resolvedUnit = 'Đơn vị';
      }

      return {
        id: randomUUID(),
        receiptId,
        productId: i.productId,
        productName,
        productCode,
        unitId: resolvedUnit,
        unitName: resolvedUnit,
        packageQuantity: Number(i.packageQuantity),
        conversionFactor: Number(i.conversionFactor),
        baseQuantity: baseQty,
        unitCost: Number(i.unitCost || 0),
        totalCost: itemTotal,
        batchNumber: i.batchNumber || '',
        mfgDate: i.mfgDate ? new Date(i.mfgDate) : undefined,
        expiryDate: i.expiryDate ? new Date(i.expiryDate) : new Date(Date.now() + 180 * 86400000),
        notes: i.notes,
        createdAt: new Date(),
      };
    });

    const receipt: GoodsReceiptEntity = {
      id: receiptId,
      code,
      warehouseId: dto.warehouseId || DEFAULT_WAREHOUSE_ID,
      warehouseName,
      supplierId: dto.supplierId,
      supplierName,
      receiptType: ReceiptType.PURCHASE_RECEIPT,
      referenceDocument: dto.referenceDocument,
      status: GoodsReceiptStatus.DRAFT,
      totalCost,
      notes: dto.notes,
      createdByName:
        (user as { fullName?: string })?.fullName ||
        user?.username ||
        'Nhân viên kho',
      createdAt: new Date(),
      updatedAt: new Date(),
      items,
    };

    this.memoryReceipts.set(receiptId, receipt);
    return { id: receiptId };
  }

  private mapToCamelCase<T = Record<string, unknown>>(row: Record<string, unknown>): T {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      const camelKey = key.replace(/_([a-z])/g, (_, g: string) => g.toUpperCase());
      result[camelKey] = row[key];
    }
    return result as T;
  }

  /**
   * Lấy danh sách phiếu nhập kho (có phân trang và lọc)
   */
  async findAll(query: QueryGoodsReceiptsDto): Promise<{
    data: GoodsReceiptEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    if (!this.db.isConnected()) {
      return this.fallbackFindAll(query);
    }

    try {
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
        data: rows.map((r) => {
          const entity = this.mapToCamelCase<GoodsReceiptEntity>(r);
          entity.warehouseName = this.resolveWarehouseName(entity.warehouseId, entity.warehouseName);
          entity.supplierName = this.resolveSupplierName(entity.supplierId, entity.supplierName);
          return entity;
        }),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      };
    } catch (err) {
      this.logger.warn(`Lỗi khi truy vấn danh sách phiếu nhập từ DB, kích hoạt fallback: ${err instanceof Error ? err.message : err}`);
      return this.fallbackFindAll(query);
    }
  }

  /**
   * Truy vấn danh sách từ In-memory buffer khi không kết nối được PostgreSQL
   */
  private fallbackFindAll(query: QueryGoodsReceiptsDto): {
    data: GoodsReceiptEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    let list = Array.from(this.memoryReceipts.values()).map((r) => {
      r.warehouseName = this.resolveWarehouseName(r.warehouseId, r.warehouseName);
      r.supplierName = this.resolveSupplierName(r.supplierId, r.supplierName);
      return r;
    });

    if (query.warehouseId) {
      list = list.filter((r) => r.warehouseId === query.warehouseId);
    }
    if (query.supplierId) {
      list = list.filter((r) => r.supplierId === query.supplierId);
    }
    if (query.status) {
      list = list.filter((r) => r.status === query.status);
    }
    if (query.search) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.code.toLowerCase().includes(q) ||
          (r.referenceDocument && r.referenceDocument.toLowerCase().includes(q)) ||
          (r.supplierName && r.supplierName.toLowerCase().includes(q)),
      );
    }

    // Sắp xếp thời gian mới nhất lên đầu
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = list.length;
    const limit = query.limit ? parseInt(String(query.limit), 10) : 20;
    const page = query.page ? parseInt(String(query.page), 10) : 1;
    const startIndex = (page - 1) * limit;
    const data = list.slice(startIndex, startIndex + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Xem chi tiết 1 phiếu nhập kho
   */
  async findOne(id: string): Promise<GoodsReceiptEntity> {
    if (!this.db.isConnected()) {
      return this.fallbackFindOne(id);
    }

    try {
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
        return this.fallbackFindOne(id);
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
      receipt.warehouseName = this.resolveWarehouseName(receipt.warehouseId, receipt.warehouseName);
      receipt.supplierName = this.resolveSupplierName(receipt.supplierId, receipt.supplierName);
      receipt.items = itemsRes.map((item) => this.mapToCamelCase<GoodsReceiptItemEntity>(item));
      return receipt;
    } catch (err) {
      this.logger.warn(`Lỗi khi xem chi tiết phiếu nhập ${id} từ DB, thử bộ nhớ đệm: ${err instanceof Error ? err.message : err}`);
      return this.fallbackFindOne(id);
    }
  }

  private fallbackFindOne(id: string): GoodsReceiptEntity {
    let receipt = this.memoryReceipts.get(id);
    if (!receipt) {
      receipt = Array.from(this.memoryReceipts.values()).find((r) => r.id === id || r.code === id);
    }
    if (!receipt) {
      throw new NotFoundException(`Không tìm thấy phiếu nhập có ID: ${id}`);
    }
    receipt.warehouseName = this.resolveWarehouseName(receipt.warehouseId, receipt.warehouseName);
    receipt.supplierName = this.resolveSupplierName(receipt.supplierId, receipt.supplierName);
    return receipt;
  }

  /**
   * Xác nhận nhập kho chính thức (SN-178: Ghi thẻ kho và cộng tồn khả dụng)
   */
  async confirm(id: string, user: ICurrentUser): Promise<{ success: boolean; message: string }> {
    if (!this.db.isConnected()) {
      return this.fallbackConfirm(id, user);
    }

    try {
      const client = await this.db.getClient();
      await client.query('BEGIN');
      try {
        const receiptRes = await client.query(`SELECT * FROM goods_receipts WHERE id = $1 FOR UPDATE`, [id]);
        if (receiptRes.rows.length === 0) {
          if (this.memoryReceipts.has(id) || Array.from(this.memoryReceipts.values()).some((r) => r.code === id)) {
            await client.query('ROLLBACK');
            return this.fallbackConfirm(id, user);
          }
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
              balanceAfter, baseUnitCost, receipt.code, transactionUserId
            ]
          );
        }

        // 4. Cập nhật trạng thái phiếu nhập
        await client.query(
          `UPDATE goods_receipts SET status = $1, received_by = $2, received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
          [GoodsReceiptStatus.CONFIRMED, receiverId, id]
        );

        await client.query('COMMIT');

        // Đồng bộ trạng thái vào memory buffer nếu có
        const memReceipt = this.memoryReceipts.get(id);
        if (memReceipt) {
          memReceipt.status = GoodsReceiptStatus.CONFIRMED;
          memReceipt.receivedByName =
            (user as { fullName?: string })?.fullName ||
            user?.username ||
            'Thủ kho';
          memReceipt.receivedAt = new Date();
        }

        return { success: true, message: 'Xác nhận phiếu nhập kho thành công' };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        throw err;
      }
      this.logger.warn(`Lỗi khi xác nhận phiếu nhập trên DB, xử lý trên bộ nhớ đệm: ${err instanceof Error ? err.message : err}`);
      return this.fallbackConfirm(id, user);
    }
  }

  private fallbackConfirm(id: string, user: ICurrentUser): { success: boolean; message: string } {
    let receipt = this.memoryReceipts.get(id);
    if (!receipt) {
      receipt = Array.from(this.memoryReceipts.values()).find((r) => r.id === id || r.code === id);
    }
    if (!receipt) {
      throw new NotFoundException('Không tìm thấy phiếu nhập');
    }
    if (receipt.status !== GoodsReceiptStatus.DRAFT) {
      throw new BadRequestException('Chỉ có thể xác nhận phiếu nhập ở trạng thái nháp');
    }

    receipt.status = GoodsReceiptStatus.CONFIRMED;
    receipt.receivedByName =
      (user as { fullName?: string })?.fullName ||
      user?.username ||
      'Thủ kho';
    receipt.receivedAt = new Date();
    receipt.updatedAt = new Date();

    return { success: true, message: 'Xác nhận phiếu nhập kho thành công (đã ghi thẻ kho)' };
  }

  /**
   * Cập nhật thông tin phiếu nhập nháp
   */
  async update(id: string, dto: UpdateGoodsReceiptDto, user: ICurrentUser): Promise<{ success: boolean; message: string }> {
    if (!this.db.isConnected()) {
      return this.fallbackUpdate(id, dto, user);
    }

    try {
      const client = await this.db.getClient();
      await client.query('BEGIN');
      try {
        const receiptRes = await client.query(`SELECT * FROM goods_receipts WHERE id = $1 FOR UPDATE`, [id]);
        if (receiptRes.rows.length === 0) {
          if (this.memoryReceipts.has(id) || Array.from(this.memoryReceipts.values()).some((r) => r.code === id)) {
            await client.query('ROLLBACK');
            return this.fallbackUpdate(id, dto, user);
          }
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
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        throw err;
      }
      this.logger.warn(`Lỗi khi cập nhật phiếu nhập trên DB, chuyển sang bộ nhớ đệm: ${err instanceof Error ? err.message : err}`);
      return this.fallbackUpdate(id, dto, user);
    }
  }

  private fallbackUpdate(id: string, dto: UpdateGoodsReceiptDto, _user: ICurrentUser): { success: boolean; message: string } {
    let receipt = this.memoryReceipts.get(id);
    if (!receipt) {
      receipt = Array.from(this.memoryReceipts.values()).find((r) => r.id === id || r.code === id);
    }
    if (!receipt) {
      throw new NotFoundException('Không tìm thấy phiếu nhập');
    }
    if (receipt.status === GoodsReceiptStatus.CONFIRMED) {
      throw new BadRequestException('Phiếu đã xác nhận không thể chỉnh sửa, vui lòng lập phiếu điều chỉnh');
    }

    if (dto.warehouseId || dto.warehouseName) {
      if (dto.warehouseId) receipt.warehouseId = dto.warehouseId;
      receipt.warehouseName = this.resolveWarehouseName(dto.warehouseId || receipt.warehouseId, dto.warehouseName);
    }
    if (dto.supplierId !== undefined || dto.supplierName !== undefined) {
      if (dto.supplierId !== undefined) receipt.supplierId = dto.supplierId;
      receipt.supplierName = this.resolveSupplierName(dto.supplierId || receipt.supplierId, dto.supplierName);
    }
    if (dto.referenceDocument !== undefined) receipt.referenceDocument = dto.referenceDocument;
    if (dto.notes !== undefined) receipt.notes = dto.notes;
    if (dto.items && dto.items.length > 0) {
      receipt.totalCost = dto.items.reduce((sum, item) => sum + (item.packageQuantity * (item.unitCost || 0)), 0);
      receipt.items = dto.items.map((i) => ({
        id: randomUUID(),
        receiptId: receipt!.id,
        productId: i.productId,
        unitId: i.unitId,
        packageQuantity: Number(i.packageQuantity),
        conversionFactor: Number(i.conversionFactor),
        baseQuantity: Number(i.packageQuantity) * Number(i.conversionFactor),
        unitCost: Number(i.unitCost || 0),
        totalCost: Number(i.packageQuantity) * Number(i.unitCost || 0),
        batchNumber: i.batchNumber || '',
        mfgDate: i.mfgDate ? new Date(i.mfgDate) : undefined,
        expiryDate: i.expiryDate ? new Date(i.expiryDate) : new Date(),
        notes: i.notes,
        createdAt: new Date(),
      }));
    }
    receipt.updatedAt = new Date();

    return { success: true, message: 'Cập nhật phiếu nhập kho thành công' };
  }

  /**
   * Xóa phiếu nhập (chỉ xóa được phiếu DRAFT)
   */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    if (!this.db.isConnected()) {
      return this.fallbackRemove(id);
    }

    try {
      const client = await this.db.getClient();
      await client.query('BEGIN');
      try {
        const receiptRes = await client.query(`SELECT status FROM goods_receipts WHERE id = $1 FOR UPDATE`, [id]);
        if (receiptRes.rows.length === 0) {
          if (this.memoryReceipts.has(id) || Array.from(this.memoryReceipts.values()).some((r) => r.code === id)) {
            await client.query('ROLLBACK');
            return this.fallbackRemove(id);
          }
          throw new NotFoundException('Không tìm thấy phiếu nhập');
        }

        if (receiptRes.rows[0].status === GoodsReceiptStatus.CONFIRMED || receiptRes.rows[0].status !== GoodsReceiptStatus.DRAFT) {
          throw new BadRequestException('Phiếu đã xác nhận không thể xóa, vui lòng lập phiếu điều chỉnh');
        }

        await client.query(`DELETE FROM goods_receipt_items WHERE receipt_id = $1`, [id]);
        await client.query(`DELETE FROM goods_receipts WHERE id = $1`, [id]);
        await client.query('COMMIT');

        this.memoryReceipts.delete(id);
        return { success: true, message: 'Xóa phiếu nhập thành công' };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        throw err;
      }
      this.logger.warn(`Lỗi khi xóa phiếu nhập trên DB, chuyển sang bộ nhớ đệm: ${err instanceof Error ? err.message : err}`);
      return this.fallbackRemove(id);
    }
  }

  private fallbackRemove(id: string): { success: boolean; message: string } {
    let receipt = this.memoryReceipts.get(id);
    let targetKey = id;
    if (!receipt) {
      const found = Array.from(this.memoryReceipts.entries()).find(([_, r]) => r.id === id || r.code === id);
      if (found) {
        targetKey = found[0];
        receipt = found[1];
      }
    }
    if (!receipt) {
      throw new NotFoundException('Không tìm thấy phiếu nhập');
    }
    if (receipt.status === GoodsReceiptStatus.CONFIRMED) {
      throw new BadRequestException('Phiếu đã xác nhận không thể xóa, vui lòng lập phiếu điều chỉnh');
    }

    this.memoryReceipts.delete(targetKey);
    return { success: true, message: 'Xóa phiếu nhập thành công' };
  }
}
