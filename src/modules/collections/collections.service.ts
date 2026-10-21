import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from '../../database/database.service';
import { CustomersService } from '../customers/customers.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { RouteCollectionEntity, CollectionStatus, PaymentMethod } from './entities/collection.entity';
import { CreateCollectionDto, UpdateCollectionStatusDto, QueryCollectionDto } from './dto';

export interface ReconciliationRow {
  salesRepId: string;
  salesRepName: string;
  collectionDate: string;
  totalRecords: number;
  totalAmount: number;
  approvedAmount: number;
  pendingAmount: number;
  rejectedAmount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  fulfillmentRate: number; // Tỷ lệ đã duyệt (%)
}

export interface CollectionSummary {
  totalAmount: number;
  pendingAmount: number;
  approvedAmount: number;
  rejectedAmount: number;
  totalCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
}

@Injectable()
export class CollectionsService implements OnModuleInit {
  private readonly logger = new Logger(CollectionsService.name);
  private readonly inMemoryCollections = new Map<string, RouteCollectionEntity>();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService?: CustomersService,
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
    await this.seedInitialCollections();
  }

  /**
   * Tạo bảng route_collections nếu chưa tồn tại trong PostgreSQL
   */
  async ensureTable(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS route_collections (
          id VARCHAR(100) PRIMARY KEY,
          code VARCHAR(50) UNIQUE,
          agency_id VARCHAR(100) NOT NULL,
          agency_name VARCHAR(255),
          sales_rep_id VARCHAR(100) NOT NULL,
          sales_rep_name VARCHAR(255),
          amount NUMERIC(15, 2) NOT NULL,
          payment_method VARCHAR(50) DEFAULT 'CASH',
          receipt_image_url TEXT NOT NULL,
          status VARCHAR(20) DEFAULT 'PENDING',
          collection_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          note TEXT,
          approved_by VARCHAR(100),
          approved_by_name VARCHAR(255),
          approved_at TIMESTAMPTZ,
          rejection_reason TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_route_collections_sales_rep ON route_collections(sales_rep_id);
        CREATE INDEX IF NOT EXISTS idx_route_collections_agency ON route_collections(agency_id);
        CREATE INDEX IF NOT EXISTS idx_route_collections_status ON route_collections(status);
        CREATE INDEX IF NOT EXISTS idx_route_collections_date ON route_collections(collection_date);

        ALTER TABLE route_collections ADD COLUMN IF NOT EXISTS order_codes JSONB;
        ALTER TABLE route_collections ADD COLUMN IF NOT EXISTS order_details JSONB;
      `);
      this.logger.log('Đã kiểm tra và đồng bộ cấu trúc bảng route_collections');
    } catch (err) {
      this.logger.warn(`Lỗi khởi tạo bảng route_collections: ${err}`);
    }
  }

  /**
   * Helper ánh xạ dữ liệu DB row sang RouteCollectionEntity
   */
  private mapDbRowToEntity(r: any): RouteCollectionEntity {
    let orderCodes: string[] = [];
    if (Array.isArray(r.order_codes)) {
      orderCodes = r.order_codes;
    } else if (typeof r.order_codes === 'string') {
      try {
        orderCodes = JSON.parse(r.order_codes);
      } catch {
        orderCodes = [];
      }
    }

    let orderDetails: any[] = [];
    if (Array.isArray(r.order_details)) {
      orderDetails = r.order_details;
    } else if (typeof r.order_details === 'string') {
      try {
        orderDetails = JSON.parse(r.order_details);
      } catch {
        orderDetails = [];
      }
    }

    return new RouteCollectionEntity({
      id: r.id,
      code: r.code,
      agencyId: r.agency_id,
      agencyName: r.agency_name,
      salesRepId: r.sales_rep_id,
      salesRepName: r.sales_rep_name,
      amount: Number(r.amount),
      paymentMethod: r.payment_method,
      receiptImageUrl: r.receipt_image_url,
      status: r.status,
      collectionDate: new Date(r.collection_date),
      note: r.note,
      approvedBy: r.approved_by,
      approvedByName: r.approved_by_name,
      approvedAt: r.approved_at ? new Date(r.approved_at) : undefined,
      rejectionReason: r.rejection_reason,
      orderCodes,
      orderDetails,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    });
  }

  /**
   * Khởi tạo dữ liệu mẫu thực tế cho bảng route_collections nếu chưa có
   */
  private async seedInitialCollections(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      const check = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM route_collections;`,
      );
      if (Number(check?.[0]?.count || 0) > 0) return;

      const seeds: RouteCollectionEntity[] = [
        new RouteCollectionEntity({
          id: 'col-001',
          code: 'PT-2610-001',
          agencyId: 'cust-001',
          agencyName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
          salesRepId: 'usr-sale-01',
          salesRepName: 'Hoàng Minh Tuấn',
          amount: 15500000,
          paymentMethod: 'CASH',
          receiptImageUrl: '/uploads/receipts/seed-receipt-01.jpg',
          status: 'PENDING',
          collectionDate: new Date(Date.now() - 3600000 * 2),
          note: 'Thu tiền mặt đợt 1 theo chuyến giao hàng',
          createdAt: new Date(Date.now() - 3600000 * 2),
          updatedAt: new Date(Date.now() - 3600000 * 2),
        }),
        new RouteCollectionEntity({
          id: 'col-002',
          code: 'PT-2610-002',
          agencyId: 'cust-003',
          agencyName: 'Công Ty TNHH Thương Mại & Phân Phối Minh Khang',
          salesRepId: 'usr-sale-01',
          salesRepName: 'Hoàng Minh Tuấn',
          amount: 28000000,
          paymentMethod: 'BANK_TRANSFER',
          receiptImageUrl: '/uploads/receipts/seed-receipt-02.jpg',
          status: 'PENDING',
          collectionDate: new Date(Date.now() - 3600000 * 4),
          note: 'Đại lý chuyển khoản thanh toán đơn DH2610-56482',
          createdAt: new Date(Date.now() - 3600000 * 4),
          updatedAt: new Date(Date.now() - 3600000 * 4),
        }),
        new RouteCollectionEntity({
          id: 'col-003',
          code: 'PT-2610-003',
          agencyId: 'cust-004',
          agencyName: 'Đại Lý Thực Phẩm Sạch Thăng Long',
          salesRepId: 'usr-sale-01',
          salesRepName: 'Hoàng Minh Tuấn',
          amount: 12000000,
          paymentMethod: 'CASH',
          receiptImageUrl: '/uploads/receipts/seed-receipt-03.jpg',
          status: 'APPROVED',
          collectionDate: new Date(Date.now() - 86400000),
          note: 'Thu công nợ tuần 41',
          approvedBy: 'usr-acc-01',
          approvedByName: 'Kế toán Công nợ (Trần Thu Hà)',
          approvedAt: new Date(Date.now() - 80000000),
          createdAt: new Date(Date.now() - 86400000),
          updatedAt: new Date(Date.now() - 80000000),
        }),
        new RouteCollectionEntity({
          id: 'col-004',
          code: 'PT-2610-004',
          agencyId: 'cust-002',
          agencyName: 'Đại lý Tạp hóa Hưng Yên',
          salesRepId: 'usr-sale-02',
          salesRepName: 'Nguyễn Văn An',
          amount: 8500000,
          paymentMethod: 'CASH',
          receiptImageUrl: '/uploads/receipts/seed-receipt-04.jpg',
          status: 'APPROVED',
          collectionDate: new Date(Date.now() - 86400000 * 2),
          note: 'Thu tiền mặt tại cửa hàng',
          approvedBy: 'usr-acc-01',
          approvedByName: 'Kế toán Công nợ (Trần Thu Hà)',
          approvedAt: new Date(Date.now() - 86400000 * 2 + 1000000),
          createdAt: new Date(Date.now() - 86400000 * 2),
          updatedAt: new Date(Date.now() - 86400000 * 2 + 1000000),
        }),
      ];

      for (const s of seeds) {
        await this.databaseService.query(
          `INSERT INTO route_collections (
            id, code, agency_id, agency_name, sales_rep_id, sales_rep_name,
            amount, payment_method, receipt_image_url, status, collection_date,
            note, approved_by, approved_by_name, approved_at, rejection_reason,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (id) DO NOTHING;`,
          [
            s.id,
            s.code,
            s.agencyId,
            s.agencyName,
            s.salesRepId,
            s.salesRepName,
            s.amount,
            s.paymentMethod,
            s.receiptImageUrl,
            s.status,
            s.collectionDate,
            s.note || null,
            s.approvedBy || null,
            s.approvedByName || null,
            s.approvedAt || null,
            s.rejectionReason || null,
            s.createdAt,
            s.updatedAt,
          ],
        );
      }
      this.logger.log('Đã tạo 4 phiếu thu tiền tuyến mẫu thực tế');
    } catch (err) {
      this.logger.warn(`Lỗi tạo seed route_collections: ${err}`);
    }
  }

  /**
   * Tạo phiếu thu tiền mới (POST /api/collections)
   */
  async create(
    dto: CreateCollectionDto,
    file?: Express.Multer.File,
    currentUser?: ICurrentUser,
  ): Promise<RouteCollectionEntity> {
    if (!dto.amount || Number(dto.amount) <= 0) {
      throw new BadRequestException('Số tiền thu phải lớn hơn 0');
    }

    // 1. Xác định ảnh biên lai
    let receiptUrl = dto.receipt_image_url;
    if (file) {
      const ext = path.extname(file.originalname) || '.jpg';
      const filename = `receipt_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}${ext}`;
      const uploadDir = path.join(process.cwd(), 'uploads', 'receipts');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      fs.writeFileSync(path.join(uploadDir, filename), file.buffer);
      receiptUrl = `/uploads/receipts/${filename}`;
    }

    if (!receiptUrl) {
      receiptUrl = '/uploads/receipts/default-receipt.png';
    }

    // 2. Tìm tên đại lý nếu chưa có
    let agencyName = dto.agency_name;
    if (!agencyName && this.customersService) {
      const cust = await this.customersService.getCustomerById(dto.agency_id).catch(() => null);
      if (cust) {
        agencyName = cust.name;
      }
    }
    agencyName = agencyName || `Đại lý ${dto.agency_id}`;

    // 3. Nhân viên thu
    const salesRepId = currentUser?.userId || currentUser?.username || 'usr-sales-01';
    const salesRepName = (currentUser as any)?.fullName || currentUser?.username || 'Nhân viên kinh doanh';

    // 4. Sinh mã phiếu thu: PT-YYMM-XXXX
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const code = `PT-${yy}${mm}-${randSuffix}`;
    const id = `col-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    const collectionDate = dto.collection_date ? new Date(dto.collection_date) : now;

    // Bóc tách danh sách đơn hàng được gán kèm phiếu thu
    let orderCodes: string[] = [];
    if (Array.isArray(dto.order_codes)) {
      orderCodes = dto.order_codes;
    } else if (typeof dto.order_codes === 'string') {
      try {
        orderCodes = JSON.parse(dto.order_codes);
      } catch {
        orderCodes = dto.order_codes ? [dto.order_codes] : [];
      }
    }

    let orderDetails: any[] = [];
    if (Array.isArray(dto.order_details)) {
      orderDetails = dto.order_details;
    } else if (typeof dto.order_details === 'string') {
      try {
        orderDetails = JSON.parse(dto.order_details);
      } catch {
        orderDetails = [];
      }
    }

    let orderIds: string[] = [];
    if (Array.isArray(dto.order_ids)) {
      orderIds = dto.order_ids;
    } else if (typeof dto.order_ids === 'string') {
      try {
        orderIds = JSON.parse(dto.order_ids);
      } catch {
        orderIds = dto.order_ids ? [dto.order_ids] : [];
      }
    }

    const newRecord = new RouteCollectionEntity({
      id,
      code,
      agencyId: dto.agency_id,
      agencyName,
      salesRepId,
      salesRepName,
      amount: Number(dto.amount),
      paymentMethod: (dto.payment_method as PaymentMethod) || 'CASH',
      receiptImageUrl: receiptUrl,
      status: 'PENDING',
      collectionDate,
      note: dto.note || '',
      orderCodes,
      orderIds,
      orderDetails,
      createdAt: now,
      updatedAt: now,
    });

    if (this.databaseService?.isConnected()) {
      await this.databaseService.query(
        `INSERT INTO route_collections (
          id, code, agency_id, agency_name, sales_rep_id, sales_rep_name,
          amount, payment_method, receipt_image_url, status, collection_date,
          note, order_codes, order_details, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15, $16);`,
        [
          newRecord.id,
          newRecord.code,
          newRecord.agencyId,
          newRecord.agencyName,
          newRecord.salesRepId,
          newRecord.salesRepName,
          newRecord.amount,
          newRecord.paymentMethod,
          newRecord.receiptImageUrl,
          newRecord.status,
          newRecord.collectionDate,
          newRecord.note || null,
          JSON.stringify(orderCodes),
          JSON.stringify(orderDetails),
          newRecord.createdAt,
          newRecord.updatedAt,
        ],
      );
    } else {
      this.inMemoryCollections.set(id, newRecord);
    }

    // SN-205: Gửi thông báo chuông tới Admin, Kế toán, Quản lý kinh doanh, Nhân viên thu, Đại lý
    if (this.notificationsService) {
      this.notificationsService
        .notifyCollectionCreated({
          id: newRecord.id,
          code: newRecord.code,
          agencyId: newRecord.agencyId,
          agencyName: newRecord.agencyName,
          salesRepId: newRecord.salesRepId,
          salesRepName: newRecord.salesRepName,
          amount: newRecord.amount,
          paymentMethod: newRecord.paymentMethod,
          status: newRecord.status,
        })
        .catch((err) => {
          this.logger.warn(`Lỗi gửi thông báo phiếu thu: ${err}`);
        });
    }

    return newRecord;
  }

  /**
   * Lấy danh sách phiếu thu (GET /api/collections)
   */
  async findAll(
    query?: QueryCollectionDto,
    currentUser?: ICurrentUser,
  ): Promise<{ data: RouteCollectionEntity[]; summary: CollectionSummary }> {
    let records: RouteCollectionEntity[] = [];

    if (this.databaseService?.isConnected()) {
      const rows = await this.databaseService.query<any>(
        `SELECT * FROM route_collections ORDER BY collection_date DESC, created_at DESC;`,
      );
      records = (rows || []).map((r) => this.mapDbRowToEntity(r));
    } else {
      records = Array.from(this.inMemoryCollections.values());
    }

    // Phân quyền Data Scope:
    // Sales Rep chỉ xem phiếu thu của chính mình
    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r).toUpperCase());
      const isAccountantOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.ACCOUNTANT) ||
        roles.includes('ACCOUNTANT_DEBT') ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER');

      if (!isAccountantOrAdmin && roles.includes(UserRole.SALES_REP)) {
        const myId = currentUser.userId;
        const myName = ((currentUser as any)?.fullName || currentUser.username || '').toLowerCase();
        records = records.filter(
          (r) =>
            r.salesRepId === myId ||
            (r.salesRepName && myName && r.salesRepName.toLowerCase().includes(myName)),
        );
      }
    }

    // Áp dụng bộ lọc
    if (query?.sales_rep_id && query.sales_rep_id !== 'ALL') {
      records = records.filter((r) => r.salesRepId === query.sales_rep_id);
    }
    if (query?.agency_id && query.agency_id !== 'ALL') {
      records = records.filter((r) => r.agencyId === query.agency_id);
    }
    if (query?.status && query.status !== 'ALL') {
      records = records.filter((r) => r.status === query.status);
    }
    if (query?.from_date) {
      const from = new Date(query.from_date);
      records = records.filter((r) => new Date(r.collectionDate) >= from);
    }
    if (query?.to_date) {
      const to = new Date(query.to_date);
      to.setHours(23, 59, 59, 999);
      records = records.filter((r) => new Date(r.collectionDate) <= to);
    }
    if (query?.search) {
      const s = query.search.toLowerCase().trim();
      records = records.filter(
        (r) =>
          r.code?.toLowerCase().includes(s) ||
          r.agencyName?.toLowerCase().includes(s) ||
          r.salesRepName?.toLowerCase().includes(s) ||
          r.note?.toLowerCase().includes(s),
      );
    }

    // Thống kê nhanh summary
    const summary: CollectionSummary = {
      totalAmount: records.reduce((sum, r) => sum + r.amount, 0),
      pendingAmount: records.filter((r) => r.status === 'PENDING').reduce((sum, r) => sum + r.amount, 0),
      approvedAmount: records.filter((r) => r.status === 'APPROVED').reduce((sum, r) => sum + r.amount, 0),
      rejectedAmount: records.filter((r) => r.status === 'REJECTED').reduce((sum, r) => sum + r.amount, 0),
      totalCount: records.length,
      pendingCount: records.filter((r) => r.status === 'PENDING').length,
      approvedCount: records.filter((r) => r.status === 'APPROVED').length,
      rejectedCount: records.filter((r) => r.status === 'REJECTED').length,
    };

    return {
      data: records,
      summary,
    };
  }

  /**
   * Chi tiết phiếu thu (GET /api/collections/:id)
   */
  async findById(id: string): Promise<RouteCollectionEntity> {
    if (this.databaseService?.isConnected()) {
      const rows = await this.databaseService.query<any>(
        `SELECT * FROM route_collections WHERE id = $1 OR code = $1 LIMIT 1;`,
        [id],
      );
      if (rows && rows.length > 0) {
        return this.mapDbRowToEntity(rows[0]);
      }
    } else {
      const found = this.inMemoryCollections.get(id);
      if (found) return found;
    }

    throw new NotFoundException(`Không tìm thấy phiếu thu tiền "${id}"`);
  }

  /**
   * Kế toán duyệt hoặc từ chối phiếu thu (PATCH /api/collections/:id/status)
   * Nghiệp vụ: Nếu APPROVED -> Tự động gạch nợ vào công nợ đại lý
   */
  async updateStatus(
    id: string,
    dto: UpdateCollectionStatusDto,
    currentUser?: ICurrentUser,
  ): Promise<RouteCollectionEntity> {
    const collection = await this.findById(id);

    if (collection.status !== 'PENDING') {
      throw new BadRequestException(
        `Phiếu thu ${collection.code} đã được xử lý (trạng thái hiện tại: ${collection.status}), không thể thay đổi lại`,
      );
    }

    const approverId = currentUser?.userId || currentUser?.username || 'accountant';
    const approverName = (currentUser as any)?.fullName || currentUser?.username || 'Kế toán công nợ';
    const now = new Date();

    collection.status = dto.status;
    collection.approvedBy = approverId;
    collection.approvedByName = approverName;
    collection.approvedAt = now;
    collection.updatedAt = now;

    if (dto.status === 'REJECTED') {
      collection.rejectionReason = dto.rejection_reason || dto.note || 'Biên lai không hợp lệ hoặc số tiền không khớp';
    }

    // 1. Cập nhật Database
    if (this.databaseService?.isConnected()) {
      await this.databaseService.query(
        `UPDATE route_collections
         SET status = $1,
             approved_by = $2,
             approved_by_name = $3,
             approved_at = $4,
             rejection_reason = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $6;`,
        [
          collection.status,
          collection.approvedBy,
          collection.approvedByName,
          collection.approvedAt,
          collection.rejectionReason || null,
          collection.id,
        ],
      );
    } else {
      this.inMemoryCollections.set(collection.id, collection);
    }

    // 2. Nghiệp vụ ERP quan trọng: Gạch nợ tự động cho đại lý khi duyệt thành công
    if (dto.status === 'APPROVED') {
      if (this.customersService && collection.agencyId) {
        try {
          await this.customersService.adjustCustomerDebt(collection.agencyId, -Number(collection.amount));
          this.logger.log(
            `[Gạch nợ tự động] Đã giảm ${collection.amount.toLocaleString('vi-VN')} đ cho đại lý ${collection.agencyName} (${collection.agencyId}) từ phiếu thu ${collection.code}`,
          );
        } catch (err) {
          this.logger.warn(`Lỗi khi tự động gạch nợ đại lý ${collection.agencyId}: ${err}`);
        }
      }

      // 2b. Ghi nhận giao dịch vào Sổ cái công nợ đại lý (customer_debt_ledger)
      if (this.databaseService?.isConnected()) {
        try {
          await this.databaseService.query(
            `INSERT INTO customer_debt_ledger (
               customer_id, transaction_type, reference_type, reference_id,
               credit_amount, debit_amount, notes, created_by, created_at
             ) VALUES (
               $1, 'ROUTE_COLLECTION', 'ROUTE_COLLECTION', $2,
               $3, 0, $4, $5, NOW()
             );`,
            [
              collection.agencyId,
              collection.code,
              collection.amount,
              `Thu tiền theo tuyến qua phiếu ${collection.code} (NVKD: ${collection.salesRepName})`,
              collection.approvedBy || 'accountant',
            ],
          );
        } catch (e: any) {
          this.logger.warn(`Lỗi ghi sổ cái công nợ: ${e.message}`);
        }

        // 2c. Cấn trừ nợ vào các đơn hàng đã được chọn (nếu có)
        const orderCodes = collection.orderCodes || [];
        if (orderCodes.length > 0) {
          try {
            let remainingToAllocate = Number(collection.amount);
            for (const ordCode of orderCodes) {
              if (remainingToAllocate <= 0) break;

              // Cập nhật app_order_records
              const appRes = await this.databaseService.query<any>(
                `SELECT id, payload FROM app_order_records WHERE order_code = $1 LIMIT 1;`,
                [ordCode],
              );
              if (appRes && appRes[0]) {
                const p = appRes[0].payload || {};
                const grandTotal = Number(p.grandTotal || p.totalAmount || 0);
                const prevPaid = Number(p.paidAmount || 0);
                const curRemaining = Math.max(0, grandTotal - prevPaid);
                const allocated = Math.min(curRemaining, remainingToAllocate);

                const newPaid = prevPaid + allocated;
                const newRemaining = Math.max(0, grandTotal - newPaid);
                const paymentStatus = newRemaining <= 0 ? 'PAID' : 'PARTIAL';

                p.paidAmount = newPaid;
                p.remainingAmount = newRemaining;
                p.paymentStatus = paymentStatus;
                p.lastCollectionCode = collection.code;

                await this.databaseService.query(
                  `UPDATE app_order_records SET payload = $1, updated_at = NOW() WHERE order_code = $2;`,
                  [JSON.stringify(p), ordCode],
                );
                remainingToAllocate -= allocated;
              }

              // Cập nhật invoices nếu có
              await this.databaseService.query(
                `UPDATE invoices 
                 SET paid_amount = paid_amount + $1,
                     remaining_amount = GREATEST(0, remaining_amount - $1),
                     payment_status = CASE WHEN remaining_amount - $1 <= 0 THEN 'PAID' ELSE 'PARTIAL' END,
                     updated_at = NOW()
                 WHERE code = $2 OR order_id = (SELECT id::text FROM orders WHERE code = $2 LIMIT 1);`,
                [Number(collection.amount), ordCode],
              ).catch(() => {});
            }
          } catch (err: any) {
            this.logger.warn(`Lỗi cấn trừ đơn hàng khi duyệt phiếu thu: ${err.message}`);
          }
        }
      }
    }

    // SN-205: Gửi thông báo chuông kết quả duyệt/từ chối tới Admin, Sales Manager, Sales Rep
    if (this.notificationsService) {
      this.notificationsService
        .notifyCollectionStatusUpdated({
          id: collection.id,
          code: collection.code,
          agencyId: collection.agencyId,
          agencyName: collection.agencyName,
          salesRepId: collection.salesRepId,
          salesRepName: collection.salesRepName,
          amount: collection.amount,
          paymentMethod: collection.paymentMethod,
          status: collection.status as 'APPROVED' | 'REJECTED',
          approverName,
          rejectionReason: collection.rejectionReason,
        })
        .catch((err) => {
          this.logger.warn(`Lỗi gửi thông báo trạng thái phiếu thu: ${err}`);
        });
    }

    return collection;
  }

  /**
   * Lấy danh sách các đơn hàng đủ điều kiện thu tiền theo tuyến của đại lý (SN-205)
   * Trạng thái: Đã giao (DELIVERED) hoặc Đang đi giao (SHIPPED / DELIVERING)
   */
  async getEligibleOrders(
    agencyId?: string,
    currentUser?: ICurrentUser,
  ): Promise<any[]> {
    if (!agencyId) return [];

    const ordersMap = new Map<string, any>();

    // 1. Phân giải các alias của đại lý
    const aliases = [agencyId];
    if (agencyId.startsWith('cust-dl-')) {
      aliases.push('DL-' + agencyId.replace('cust-dl-', ''));
    } else if (agencyId.startsWith('cust-')) {
      aliases.push('DL-' + agencyId.replace('cust-', ''));
    }
    if (agencyId === 'cust-dl-0001' || agencyId === 'DL-0001') {
      aliases.push('cust-001', 'DL-MK-001', '55555555-0000-0000-0000-000000000001');
    } else if (agencyId === 'cust-dl-0002' || agencyId === 'DL-0002') {
      aliases.push('cust-002', 'DL-AB-002', '55555555-0000-0000-0000-000000000002');
    } else if (agencyId === 'cust-dl-0003' || agencyId === 'DL-0003') {
      aliases.push('cust-003', 'DL-HT-003', '55555555-0000-0000-0000-000000000003');
    }

    if (this.databaseService?.isConnected()) {
      try {
        // 2. Thu thập danh sách các đơn hàng ĐÃ TẠO PHIẾU THU (ở trạng thái PENDING hoặc APPROVED)
        const collectedCodes = new Set<string>();
        const collectedIds = new Set<string>();

        const existingCols = await this.databaseService.query<any>(
          `SELECT order_codes, order_details FROM route_collections WHERE status IN ('PENDING', 'APPROVED');`,
        );
        for (const col of existingCols || []) {
          let codes: string[] = [];
          if (Array.isArray(col.order_codes)) {
            codes = col.order_codes;
          } else if (typeof col.order_codes === 'string') {
            try {
              codes = JSON.parse(col.order_codes);
            } catch {
              codes = [];
            }
          }
          codes.forEach((c) => c && collectedCodes.add(String(c).trim().toUpperCase()));

          let details: any[] = [];
          if (Array.isArray(col.order_details)) {
            details = col.order_details;
          } else if (typeof col.order_details === 'string') {
            try {
              details = JSON.parse(col.order_details);
            } catch {
              details = [];
            }
          }
          details.forEach((d: any) => {
            if (d?.orderCode) collectedCodes.add(String(d.orderCode).trim().toUpperCase());
            if (d?.order_code) collectedCodes.add(String(d.order_code).trim().toUpperCase());
            if (d?.orderId) collectedIds.add(String(d.orderId).trim());
            if (d?.order_id) collectedIds.add(String(d.order_id).trim());
          });
        }

        // Bổ sung từ memory cache
        for (const col of this.inMemoryCollections.values()) {
          if (col.status === 'PENDING' || col.status === 'APPROVED') {
            col.orderCodes?.forEach((c: string) => c && collectedCodes.add(String(c).trim().toUpperCase()));
            col.orderIds?.forEach((id: string) => id && collectedIds.add(String(id).trim()));
            col.orderDetails?.forEach((d: any) => {
              if (d?.orderCode) collectedCodes.add(String(d.orderCode).trim().toUpperCase());
              if (d?.orderId) collectedIds.add(String(d.orderId).trim());
            });
          }
        }

        // Nguồn 1: app_order_records
        const appOrdersRes = await this.databaseService.query<any>(
          `SELECT id, order_code, payload, created_at
           FROM app_order_records
           WHERE (
             payload->>'customerId' = ANY($1)
             OR payload->>'customerId' ILIKE $2
           )
           AND UPPER(COALESCE(payload->>'status', '')) IN ('DELIVERED', 'SHIPPED', 'COMPLETED', 'DELIVERING')
           ORDER BY created_at DESC;`,
          [aliases, `%${agencyId}%`],
        );

        for (const row of appOrdersRes || []) {
          const p = row.payload || {};
          const code = row.order_code || p.orderCode || p.code || row.id;
          const total = Number(p.grandTotal ?? p.totalAmount ?? p.subtotal ?? 0);
          const rawStatus = (p.status || 'DELIVERED').toUpperCase();
          const status = rawStatus === 'SHIPPED' ? 'SHIPPED' : 'DELIVERED';
          const statusLabel = status === 'DELIVERED' ? 'Đã giao hàng' : 'Đang đi giao';
          const paid = Number(p.paidAmount ?? 0);
          const remaining = Math.max(0, total - paid);

          const upperCode = code ? String(code).trim().toUpperCase() : '';
          const upperRowCode = row.order_code ? String(row.order_code).trim().toUpperCase() : '';
          const upperPayloadCode = p.orderCode ? String(p.orderCode).trim().toUpperCase() : '';
          const rowId = String(row.id).trim();

          // LOẠI BỎ: Nếu đơn hàng đã tạo phiếu thu rồi (PENDING hoặc APPROVED) hoặc đã thu đủ tiền
          if (
            collectedCodes.has(upperCode) ||
            (upperRowCode && collectedCodes.has(upperRowCode)) ||
            (upperPayloadCode && collectedCodes.has(upperPayloadCode)) ||
            collectedIds.has(rowId) ||
            p.lastCollectionCode ||
            (p.paymentStatus || '').toUpperCase() === 'PAID' ||
            remaining <= 0
          ) {
            continue;
          }

          const orderDate = p.orderDate || p.createdAt || p.deliveryDate || row.created_at;
          ordersMap.set(code, {
            id: row.id,
            orderId: row.id,
            order_id: row.id,
            orderCode: code,
            order_code: code,
            code: code,
            customerId: p.customerId || agencyId,
            customer_id: p.customerId || agencyId,
            customerName: p.customerName || 'Đại lý',
            customer_name: p.customerName || 'Đại lý',
            status,
            statusLabel,
            status_label: statusLabel,
            totalAmount: total,
            total_amount: total,
            paidAmount: paid,
            paid_amount: paid,
            remainingAmount: remaining,
            remaining_amount: remaining,
            issueDate: p.deliveryDate || p.createdAt || row.created_at,
            deliveryDate: p.deliveryDate || row.created_at,
            orderDate: orderDate,
            order_date: orderDate,
            created_at: row.created_at || p.createdAt,
          });
        }

        // Nguồn 2: Bảng orders & invoices kết hợp
        const dbOrdersRes = await this.databaseService.query<any>(
          `SELECT o.id, o.code, o.status, o.total_amount, o.final_amount, o.created_at,
                  c.name as customer_name, c.id as customer_id,
                  inv.id as invoice_id, inv.code as invoice_code,
                  COALESCE(inv.total_amount, o.final_amount, o.total_amount) as inv_total,
                  COALESCE(inv.paid_amount, 0) as inv_paid,
                  COALESCE(inv.remaining_amount, o.final_amount, o.total_amount) as inv_remaining
           FROM orders o
           LEFT JOIN customers c ON c.id = o.customer_id
           LEFT JOIN invoices inv ON inv.order_id = o.id
           WHERE (o.customer_id::text = ANY($1) OR c.code = ANY($1))
             AND UPPER(o.status) IN ('DELIVERED', 'SHIPPED', 'COMPLETED', 'DELIVERING')
           ORDER BY o.created_at DESC;`,
          [aliases],
        );

        for (const row of dbOrdersRes || []) {
          const code = row.code || row.id;
          const total = Number(row.inv_total || row.final_amount || row.total_amount || 0);
          const paid = Number(row.inv_paid || 0);
          const remaining = Number(row.inv_remaining || total - paid);

          const upperCode = code ? String(code).trim().toUpperCase() : '';
          const rowId = String(row.id).trim();

          // LOẠI BỎ: Nếu đơn hàng đã tạo phiếu thu rồi hoặc đã thu đủ tiền
          if (
            collectedCodes.has(upperCode) ||
            collectedIds.has(rowId) ||
            remaining <= 0
          ) {
            continue;
          }

          if (!ordersMap.has(code)) {
            const status = (row.status || 'DELIVERED').toUpperCase() === 'SHIPPED' ? 'SHIPPED' : 'DELIVERED';
            const statusLabel = status === 'DELIVERED' ? 'Đã giao hàng' : 'Đang đi giao';

            ordersMap.set(code, {
              id: row.id,
              orderId: row.id,
              order_id: row.id,
              orderCode: code,
              order_code: code,
              code: code,
              invoiceId: row.invoice_id,
              invoiceCode: row.invoice_code,
              customerId: row.customer_id || agencyId,
              customer_id: row.customer_id || agencyId,
              customerName: row.customer_name || 'Đại lý',
              customer_name: row.customer_name || 'Đại lý',
              status,
              statusLabel,
              status_label: statusLabel,
              totalAmount: total,
              total_amount: total,
              paidAmount: paid,
              paid_amount: paid,
              remainingAmount: remaining,
              remaining_amount: remaining,
              issueDate: row.created_at,
              deliveryDate: row.created_at,
              orderDate: row.created_at,
              order_date: row.created_at,
              created_at: row.created_at,
            });
          }
        }
      } catch (err: any) {
        this.logger.warn(`Lỗi lấy eligible orders: ${err.message}`);
      }
    }

    return Array.from(ordersMap.values());
  }

  /**
   * Lấy dữ liệu Bảng đối chiếu tổng hợp (GET /api/collections/reconciliation)
   * Gom nhóm theo Nhân viên x Ngày thu
   */
  async getReconciliation(
    query?: { date?: string; from_date?: string; to_date?: string; sales_rep_id?: string },
    currentUser?: ICurrentUser,
  ): Promise<{ rows: ReconciliationRow[]; summary: CollectionSummary }> {
    const listRes = await this.findAll(
      {
        sales_rep_id: query?.sales_rep_id,
        from_date: query?.from_date || (query?.date ? query.date : undefined),
        to_date: query?.to_date || (query?.date ? query.date : undefined),
      },
      currentUser,
    );

    const items = listRes.data;
    const groupMap = new Map<string, ReconciliationRow>();

    for (const it of items) {
      const dateStr = new Date(it.collectionDate).toISOString().split('T')[0];
      const key = `${it.salesRepId}_${dateStr}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          salesRepId: it.salesRepId,
          salesRepName: it.salesRepName || 'Nhân viên kinh doanh',
          collectionDate: dateStr,
          totalRecords: 0,
          totalAmount: 0,
          approvedAmount: 0,
          pendingAmount: 0,
          rejectedAmount: 0,
          approvedCount: 0,
          pendingCount: 0,
          rejectedCount: 0,
          fulfillmentRate: 0,
        });
      }

      const row = groupMap.get(key)!;
      row.totalRecords += 1;
      row.totalAmount += it.amount;

      if (it.status === 'APPROVED') {
        row.approvedAmount += it.amount;
        row.approvedCount += 1;
      } else if (it.status === 'PENDING') {
        row.pendingAmount += it.amount;
        row.pendingCount += 1;
      } else if (it.status === 'REJECTED') {
        row.rejectedAmount += it.amount;
        row.rejectedCount += 1;
      }
    }

    const rows = Array.from(groupMap.values()).map((r) => {
      r.fulfillmentRate = r.totalAmount > 0 ? Math.round((r.approvedAmount / r.totalAmount) * 100) : 0;
      return r;
    });

    // Sắp xếp ngày mới nhất lên đầu
    rows.sort((a, b) => b.collectionDate.localeCompare(a.collectionDate));

    return {
      rows,
      summary: listRes.summary,
    };
  }
}
