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
      `);
      this.logger.log('Đã kiểm tra và đồng bộ cấu trúc bảng route_collections');
    } catch (err) {
      this.logger.warn(`Lỗi khởi tạo bảng route_collections: ${err}`);
    }
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
      createdAt: now,
      updatedAt: now,
    });

    if (this.databaseService?.isConnected()) {
      await this.databaseService.query(
        `INSERT INTO route_collections (
          id, code, agency_id, agency_name, sales_rep_id, sales_rep_name,
          amount, payment_method, receipt_image_url, status, collection_date,
          note, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14);`,
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
      records = (rows || []).map(
        (r) =>
          new RouteCollectionEntity({
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
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
          }),
      );
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
        const r = rows[0];
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
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
        });
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
    if (dto.status === 'APPROVED' && this.customersService && collection.agencyId) {
      try {
        await this.customersService.adjustCustomerDebt(collection.agencyId, -Number(collection.amount));
        this.logger.log(
          `[Gạch nợ tự động] Đã giảm ${collection.amount.toLocaleString('vi-VN')} đ cho đại lý ${collection.agencyName} (${collection.agencyId}) từ phiếu thu ${collection.code}`,
        );
      } catch (err) {
        this.logger.warn(`Lỗi khi tự động gạch nợ đại lý ${collection.agencyId}: ${err}`);
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
