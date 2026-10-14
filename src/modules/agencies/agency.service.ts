import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { OrdersService } from "../orders/orders.service";
import { CreateAgencyDto, QueryAgencyDto, UpdateAgencyDto } from "./dto";
import { AgencyEntity } from "./entities/agency.entity";
import { AgencyStatus } from "./enums/agency-status.enum";

/**
 * Service Quản lý Hồ sơ Đại lý (JIRA SN-30)
 *
 * Nghiệp vụ cốt lõi:
 * - CRUD hồ sơ đại lý chuẩn hóa cho Kế toán công nợ & Quản lý bán hàng.
 * - Ràng buộc duy nhất: Mã đại lý (agencyCode) là duy nhất trên toàn hệ thống.
 * - Ràng buộc toàn vẹn dữ liệu: Đại lý đã phát sinh giao dịch (orders) thì KHÔNG ĐƯỢC XÓA khỏi database,
 *   thay vào đó tự động chuyển trạng thái sang INACTIVE (Ngừng giao dịch).
 * - Tương thích lưu trữ kép: Hỗ trợ Database PostgreSQL thực tế kèm cơ chế in-memory fallback thông minh.
 */
@Injectable()
export class AgencyService implements OnModuleInit {
  private readonly logger = new Logger(AgencyService.name);
  private readonly agencies = new Map<string, AgencyEntity>();

  /**
   * Tập hợp ID và mã đại lý đã phát sinh đơn hàng / giao dịch
   */
  private readonly agenciesWithOrders = new Set<string>([
    "cust-dl-0001",
    "cust-dl-0002",
    "cust-dl-0003",
    "cust-001",
    "cust-002",
    "DL-0001",
    "DL-0002",
    "DL-0003",
    "DL-HCM-001",
    "DL-HCM-002",
  ]);

  constructor(
    @Optional() private readonly dbService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService?: OrdersService,
  ) {
    this.seedInitialAgencies();
  }

  async onModuleInit(): Promise<void> {
    if (this.agencies.size === 0) {
      this.seedInitialAgencies();
    }

    if (this.dbService?.isConnected()) {
      await this.initDatabaseTable();
      await this.syncOrdersConstraintFromDatabase();
      await this.loadAgenciesFromDatabase();
    }
  }

  /**
   * Khởi tạo bảng agencies trên PostgreSQL nếu chưa tồn tại
   */
  private async initDatabaseTable(): Promise<void> {
    try {
      await this.dbService!.query(`
        CREATE TABLE IF NOT EXISTS agencies (
          id VARCHAR(100) PRIMARY KEY,
          agency_code VARCHAR(50) NOT NULL UNIQUE,
          name VARCHAR(255) NOT NULL,
          tax_code VARCHAR(50),
          customer_group_id VARCHAR(50) NOT NULL,
          region VARCHAR(100),
          assigned_user VARCHAR(150),
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          phone VARCHAR(20),
          email VARCHAR(150),
          address TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_agencies_code ON agencies(LOWER(agency_code));
        CREATE INDEX IF NOT EXISTS idx_agencies_group ON agencies(customer_group_id);
        CREATE INDEX IF NOT EXISTS idx_agencies_status ON agencies(status);
      `);
      this.logger.log(
        "[Agencies] Đã kiểm tra/khởi tạo bảng agencies trong PostgreSQL thành công",
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[Agencies] Không thể khởi tạo bảng trong PostgreSQL: ${msg}`,
      );
    }
  }

  /**
   * Tải danh sách đại lý đã phát sinh đơn hàng từ bảng orders trong database
   */
  private async syncOrdersConstraintFromDatabase(): Promise<void> {
    try {
      const rows = await this.dbService!.query<{ customer_id: string }>(`
        SELECT DISTINCT customer_id FROM orders WHERE customer_id IS NOT NULL;
      `);
      for (const row of rows) {
        if (row.customer_id) {
          this.agenciesWithOrders.add(row.customer_id);
        }
      }
    } catch {
      // Tiếp tục dùng in-memory tracking
    }
  }

  /**
   * Tải dữ liệu đại lý từ PostgreSQL vào bộ nhớ đệm
   */
  private async loadAgenciesFromDatabase(): Promise<void> {
    try {
      const rows = await this.dbService!.query<{
        id: string;
        agency_code: string;
        name: string;
        tax_code: string;
        customer_group_id: string;
        region: string;
        assigned_user: string;
        status: AgencyStatus;
        phone?: string;
        email?: string;
        address?: string;
        created_at: Date;
        updated_at: Date;
      }>(`
        SELECT id, agency_code, name, tax_code, customer_group_id, region, assigned_user, status, phone, email, address, created_at, updated_at
        FROM agencies
        ORDER BY created_at DESC;
      `);

      for (const r of rows) {
        const agency = new AgencyEntity({
          id: r.id,
          agencyCode: r.agency_code,
          name: r.name,
          taxCode: r.tax_code,
          customerGroupId: r.customer_group_id,
          region: r.region,
          assignedUser: r.assigned_user,
          status: r.status,
          phone: r.phone,
          email: r.email,
          address: r.address,
          hasOrders:
            this.agenciesWithOrders.has(r.id) ||
            this.agenciesWithOrders.has(r.agency_code),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        });
        this.agencies.set(agency.id, agency);
      }
      this.logger.log(`[Agencies] Đã tải ${rows.length} đại lý từ PostgreSQL`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[Agencies] Tải dữ liệu từ DB thất bại: ${msg}`);
    }
  }

  /**
   * Dữ liệu mẫu hồ sơ đại lý chuẩn hệ thống theo JIRA SN-30 & SN-31
   */
  private seedInitialAgencies(): void {
    const seedData: AgencyEntity[] = [
      new AgencyEntity({
        id: "cust-dl-0001",
        agencyCode: "DL-0001",
        name: "Công Ty TNHH Thương Mại & Phân Phối Minh Khang",
        taxCode: "0316789001",
        customerGroupId: "AGENT_LEVEL_1",
        region: "Miền Nam",
        assignedUser: "Trần Văn Long",
        status: AgencyStatus.ACTIVE,
        phone: "0901234561",
        email: "minhkhang.dist@lohasales.vn",
        address: "123 Nguyễn Trọng Tuyển, P.8, Q.Phú Nhuận, TP.HCM",
        hasOrders: true,
        createdAt: new Date("2026-01-10T08:00:00Z"),
        updatedAt: new Date("2026-01-10T08:00:00Z"),
      }),
      new AgencyEntity({
        id: "cust-dl-0002",
        agencyCode: "DL-0002",
        name: "Tổng Đại Lý Phân Phối Thực Phẩm Toàn Cầu",
        taxCode: "0316789002",
        customerGroupId: "AGENT_LEVEL_1",
        region: "Miền Nam",
        assignedUser: "Trần Văn Long",
        status: AgencyStatus.ACTIVE,
        phone: "0901234562",
        email: "toancau.food@lohasales.vn",
        address: "456 Xô Viết Nghệ Tĩnh, P.25, Q.Bình Thạnh, TP.HCM",
        hasOrders: true,
        createdAt: new Date("2026-01-12T09:30:00Z"),
        updatedAt: new Date("2026-01-12T09:30:00Z"),
      }),
      new AgencyEntity({
        id: "cust-dl-0003",
        agencyCode: "DL-0003",
        name: "Chuỗi Bán Lẻ & Siêu Thị Mini Phương Nam Mart",
        taxCode: "0318903456",
        customerGroupId: "RETAIL",
        region: "Miền Nam",
        assignedUser: "Nguyễn Thị Hằng",
        status: AgencyStatus.ACTIVE,
        phone: "0923456789",
        email: "phuongnammart@gmail.com",
        address: "789 Hoàng Văn Thụ, P.4, Q.Tân Bình, TP.HCM",
        hasOrders: true,
        createdAt: new Date("2026-01-15T10:15:00Z"),
        updatedAt: new Date("2026-01-15T10:15:00Z"),
      }),
      new AgencyEntity({
        id: "cust-dl-0004",
        agencyCode: "DL-0004",
        name: "Công Ty CP Bách Hóa Tiện Lợi Sao Mai",
        taxCode: "0319882211",
        customerGroupId: "AGENT_LEVEL_2",
        region: "Miền Trung",
        assignedUser: "Lê Hoàng Nam",
        status: AgencyStatus.ACTIVE,
        phone: "0909554433",
        email: "saomai.convenience@gmail.com",
        address: "88 Nguyễn Văn Linh, P. Nam Dương, Q. Hải Châu, TP. Đà Nẵng",
        hasOrders: false,
        createdAt: new Date("2026-02-01T14:00:00Z"),
        updatedAt: new Date("2026-02-01T14:00:00Z"),
      }),
      new AgencyEntity({
        id: "cust-dl-0005",
        agencyCode: "DL-0005",
        name: "Đại Lý Thực Phẩm Tiêu Dùng Hà Thành",
        taxCode: "0109923344",
        customerGroupId: "AGENT_LEVEL_2",
        region: "Miền Bắc",
        assignedUser: "Phạm Minh Tuấn",
        status: AgencyStatus.ACTIVE,
        phone: "0912887766",
        email: "hathanh.foods@hanoi.vn",
        address: "15 Kim Mã, P. Kim Mã, Q. Ba Đình, TP. Hà Nội",
        hasOrders: false,
        createdAt: new Date("2026-02-05T11:20:00Z"),
        updatedAt: new Date("2026-02-05T11:20:00Z"),
      }),
      new AgencyEntity({
        id: "cust-dl-0006",
        agencyCode: "DL-0006",
        name: "Cửa Hàng Thực Phẩm Đông Hải (Tạm Ngừng)",
        taxCode: "0315556677",
        customerGroupId: "RETAIL",
        region: "Miền Nam",
        assignedUser: "Trần Văn Long",
        status: AgencyStatus.INACTIVE,
        phone: "0933445566",
        email: "donghai.mart@gmail.com",
        address: "22 Võ Văn Ngân, TP. Thủ Đức, TP.HCM",
        hasOrders: false,
        createdAt: new Date("2026-01-05T08:00:00Z"),
        updatedAt: new Date("2026-02-10T16:00:00Z"),
      }),
    ];

    for (const a of seedData) {
      this.agencies.set(a.id, a);
    }
  }

  /**
   * Kiểm tra tính duy nhất của mã đại lý (agencyCode)
   * @param agencyCode Mã đại lý cần kiểm tra
   * @param excludeId ID đại lý được loại trừ (dùng khi cập nhật)
   * @returns true nếu mã đã tồn tại, false nếu mã chưa tồn tại
   */
  async checkAgencyCode(
    agencyCode: string,
    excludeId?: string,
  ): Promise<boolean> {
    const normalized = agencyCode.trim().toUpperCase();

    // 1. Kiểm tra trong bộ nhớ in-memory
    const existsInMemory = Array.from(this.agencies.values()).some(
      (a) => a.agencyCode.toUpperCase() === normalized && a.id !== excludeId,
    );
    if (existsInMemory) {
      return true;
    }

    // 2. Kiểm tra trong PostgreSQL nếu có kết nối
    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<{ id: string }>(
          `SELECT id FROM agencies WHERE UPPER(agency_code) = $1 AND ($2::text IS NULL OR id != $2) LIMIT 1;`,
          [normalized, excludeId || null],
        );
        if (rows.length > 0) {
          return true;
        }
      } catch {
        // Fallback kiểm tra in-memory
      }
    }

    return false;
  }

  /**
   * Tạo mới hồ sơ đại lý (JIRA SN-30)
   * - Kiểm tra trùng mã agencyCode, nếu trùng bắn BadRequestException
   * - Lưu trữ an toàn vào database và bộ nhớ
   */
  async createAgency(dto: CreateAgencyDto): Promise<AgencyEntity> {
    const normalizedCode = dto.agencyCode.trim().toUpperCase();

    // 1. Kiểm tra trùng lặp mã đại lý
    const isDuplicate = await this.checkAgencyCode(normalizedCode);
    if (isDuplicate) {
      throw new BadRequestException(
        `Mã đại lý '${normalizedCode}' đã tồn tại trên hệ thống. Vui lòng sử dụng mã khác.`,
      );
    }

    // 2. Sinh ID định danh duy nhất
    const agencyId =
      dto.id?.trim() ||
      `agn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 3. Khởi tạo đối tượng AgencyEntity
    const newAgency = new AgencyEntity({
      id: agencyId,
      agencyCode: normalizedCode,
      name: dto.name.trim(),
      taxCode: dto.taxCode?.trim() || "",
      customerGroupId: dto.customerGroupId.trim(),
      region: dto.region?.trim() || "",
      assignedUser: dto.assignedUser?.trim() || "",
      status: dto.status || AgencyStatus.ACTIVE,
      phone: dto.phone?.trim(),
      email: dto.email?.trim(),
      address: dto.address?.trim(),
      hasOrders: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 4. Lưu vào cơ sở dữ liệu PostgreSQL nếu kết nối sẵn sàng
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `INSERT INTO agencies (id, agency_code, name, tax_code, customer_group_id, region, assigned_user, status, phone, email, address, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);`,
          [
            newAgency.id,
            newAgency.agencyCode,
            newAgency.name,
            newAgency.taxCode || null,
            newAgency.customerGroupId,
            newAgency.region || null,
            newAgency.assignedUser || null,
            newAgency.status,
            newAgency.phone || null,
            newAgency.email || null,
            newAgency.address || null,
            newAgency.createdAt,
            newAgency.updatedAt,
          ],
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[Agencies] Lưu DB thất bại: ${msg}`);
      }
    }

    // 5. Cập nhật vào bộ nhớ cache
    this.agencies.set(newAgency.id, newAgency);

    return newAgency;
  }

  /**
   * Lấy danh sách toàn bộ đại lý có hỗ trợ bộ lọc đa năng
   */
  async findAllAgencies(query?: QueryAgencyDto): Promise<AgencyEntity[]> {
    let list = Array.from(this.agencies.values());

    // 1. Tìm kiếm đa trường (mã, tên, MST, SĐT, người phụ trách)
    if (query?.search) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.agencyCode.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (a.taxCode && a.taxCode.toLowerCase().includes(q)) ||
          (a.phone && a.phone.includes(q)) ||
          (a.assignedUser && a.assignedUser.toLowerCase().includes(q)),
      );
    }

    // 2. Lọc theo nhóm khách hàng (bảng giá)
    if (query?.customerGroupId && query.customerGroupId !== "ALL") {
      list = list.filter((a) => a.customerGroupId === query.customerGroupId);
    }

    // 3. Lọc theo khu vực
    if (query?.region) {
      list = list.filter((a) => a.region === query.region);
    }

    // 4. Lọc theo trạng thái
    if (query?.status) {
      list = list.filter((a) => a.status === query.status);
    }

    // 5. Lọc theo người phụ trách
    if (query?.assignedUser) {
      list = list.filter((a) =>
        a.assignedUser
          .toLowerCase()
          .includes(query.assignedUser!.toLowerCase()),
      );
    }

    // 6. Cập nhật thông tin giao dịch thời gian thực
    for (const agency of list) {
      agency.hasOrders = await this.hasTransactions(
        agency.id,
        agency.agencyCode,
      );
    }

    // 7. Sắp xếp theo ngày tạo mới nhất lên đầu
    list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return list;
  }

  /**
   * Lấy danh sách đại lý có phân trang theo chuẩn hệ thống
   */
  async findAllPaginated(query?: QueryAgencyDto): Promise<{
    data: AgencyEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const list = await this.findAllAgencies(query);
    const total = list.length;
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Number(query?.limit) || 20);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const startIndex = (page - 1) * limit;
    const data = list.slice(startIndex, startIndex + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Lấy thông tin chi tiết đại lý theo ID hoặc Mã đại lý
   */
  async getAgencyById(idOrCode: string): Promise<AgencyEntity> {
    const trimmed = idOrCode.trim();
    let agency = this.agencies.get(trimmed);

    if (!agency) {
      agency = Array.from(this.agencies.values()).find(
        (a) =>
          a.agencyCode.toUpperCase() === trimmed.toUpperCase() ||
          a.id === trimmed,
      );
    }

    if (!agency) {
      throw new NotFoundException(
        `Không tìm thấy hồ sơ đại lý với mã hoặc ID '${idOrCode}'`,
      );
    }

    agency.hasOrders = await this.hasTransactions(agency.id, agency.agencyCode);
    return agency;
  }

  /**
   * Cập nhật thông tin hồ sơ đại lý (JIRA SN-30)
   * - Cho phép đổi mã agencyCode kèm kiểm tra trùng lặp với các đại lý khác
   */
  async updateAgency(id: string, dto: UpdateAgencyDto): Promise<AgencyEntity> {
    const agency = await this.getAgencyById(id);

    // 1. Kiểm tra trùng lặp nếu có thay đổi agencyCode
    if (dto.agencyCode) {
      const cleanCode = dto.agencyCode.trim().toUpperCase();
      if (cleanCode !== agency.agencyCode) {
        const isDuplicate = await this.checkAgencyCode(cleanCode, agency.id);
        if (isDuplicate) {
          throw new BadRequestException(
            `Mã đại lý '${cleanCode}' đã được sử dụng bởi một đại lý khác.`,
          );
        }
        agency.agencyCode = cleanCode;
      }
    }

    // 2. Cập nhật các trường thông tin
    if (dto.name !== undefined) agency.name = dto.name.trim();
    if (dto.taxCode !== undefined) agency.taxCode = dto.taxCode.trim();
    if (dto.customerGroupId !== undefined)
      agency.customerGroupId = dto.customerGroupId.trim();
    if (dto.region !== undefined) agency.region = dto.region.trim();
    if (dto.assignedUser !== undefined)
      agency.assignedUser = dto.assignedUser.trim();
    if (dto.status !== undefined) agency.status = dto.status;
    if (dto.phone !== undefined) agency.phone = dto.phone?.trim();
    if (dto.email !== undefined) agency.email = dto.email?.trim();
    if (dto.address !== undefined) agency.address = dto.address?.trim();

    agency.updatedAt = new Date();

    // 3. Đồng bộ vào PostgreSQL
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE agencies
           SET agency_code = $1, name = $2, tax_code = $3, customer_group_id = $4,
               region = $5, assigned_user = $6, status = $7, phone = $8, email = $9,
               address = $10, updated_at = $11
           WHERE id = $12;`,
          [
            agency.agencyCode,
            agency.name,
            agency.taxCode || null,
            agency.customerGroupId,
            agency.region || null,
            agency.assignedUser || null,
            agency.status,
            agency.phone || null,
            agency.email || null,
            agency.address || null,
            agency.updatedAt,
            agency.id,
          ],
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[Agencies] Cập nhật DB thất bại: ${msg}`);
      }
    }

    // 4. Lưu lại bộ nhớ
    this.agencies.set(agency.id, agency);

    agency.hasOrders = await this.hasTransactions(agency.id, agency.agencyCode);
    return agency;
  }

  /**
   * Kiểm tra xem đại lý đã phát sinh giao dịch đơn hàng (orders) hay chưa
   * @param agencyId ID đại lý
   * @param agencyCode Mã đại lý
   */
  async hasTransactions(
    agencyId: string,
    agencyCode?: string,
  ): Promise<boolean> {
    // 1. Kiểm tra danh sách đã xác định trong bộ nhớ
    if (this.agenciesWithOrders.has(agencyId)) {
      return true;
    }
    if (agencyCode && this.agenciesWithOrders.has(agencyCode)) {
      return true;
    }

    // 2. Kiểm tra qua OrdersService nếu được tiêm phụ thuộc
    if (this.ordersService) {
      try {
        const ordersByCust = await this.ordersService.findAllOrders({
          customerId: agencyId,
        });
        if (ordersByCust.data && ordersByCust.data.length > 0) {
          this.agenciesWithOrders.add(agencyId);
          return true;
        }

        if (agencyCode) {
          const ordersBySearch = await this.ordersService.findAllOrders({
            search: agencyCode,
          });
          const match = ordersBySearch.data.some(
            (o) =>
              o.customerCode.toUpperCase() === agencyCode.toUpperCase() ||
              o.customerId === agencyId,
          );
          if (match) {
            this.agenciesWithOrders.add(agencyId);
            this.agenciesWithOrders.add(agencyCode);
            return true;
          }
        }
      } catch {
        // Tiếp tục kiểm tra bước kế tiếp
      }
    }

    // 3. Kiểm tra qua truy vấn bảng orders trong PostgreSQL
    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<{ total: number }>(
          `SELECT COUNT(*)::int AS total
           FROM orders o
           WHERE o.customer_id = $1
              OR o.customer_id = (SELECT id FROM customers WHERE UPPER(code) = UPPER($2) LIMIT 1);`,
          [agencyId, agencyCode || agencyId],
        );
        if (rows[0] && Number(rows[0].total) > 0) {
          this.agenciesWithOrders.add(agencyId);
          if (agencyCode) this.agenciesWithOrders.add(agencyCode);
          return true;
        }
      } catch {
        // Fallback
      }
    }

    return false;
  }

  /**
   * Xóa hoặc Ngừng giao dịch đại lý (JIRA SN-30):
   *
   * RÀNG BUỘC TOÀN VẸN:
   * - Nếu đại lý ĐÃ PHÁT SINH GIAO DỊCH (orders):
   *   -> TUYỆT ĐỐI KHÔNG XÓA KHỎI DATABASE.
   *   -> TỰ ĐỘNG CHUYỂN TRẠNG THÁI SANG 'INACTIVE' (Ngừng giao dịch).
   * - Nếu đại lý CHƯA PHÁT SINH GIAO DỊCH:
   *   -> Cho phép xóa hoàn toàn khỏi cơ sở dữ liệu và bộ nhớ.
   */
  async deleteAgency(idOrCode: string): Promise<{
    success: boolean;
    message: string;
    data?: AgencyEntity;
    isDeactivated: boolean;
    isDeleted: boolean;
  }> {
    const agency = await this.getAgencyById(idOrCode);
    const hasOrders = await this.hasTransactions(agency.id, agency.agencyCode);

    // TRƯỜNG HỢP 1: Đại lý đã phát sinh giao dịch đơn hàng -> KHÔNG ĐƯỢC XÓA, TỰ ĐỘNG CHUYỂN SANG INACTIVE
    if (hasOrders) {
      agency.status = AgencyStatus.INACTIVE;
      agency.updatedAt = new Date();

      if (this.dbService?.isConnected()) {
        try {
          await this.dbService.query(
            `UPDATE agencies SET status = 'INACTIVE', updated_at = $1 WHERE id = $2;`,
            [agency.updatedAt, agency.id],
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `[Agencies] Cập nhật trạng thái ngừng giao dịch DB thất bại: ${msg}`,
          );
        }
      }

      this.agencies.set(agency.id, agency);
      agency.hasOrders = true;

      return {
        success: true,
        message: `Đại lý [${agency.agencyCode}] đã phát sinh giao dịch đơn hàng. Để bảo toàn lịch sử kế toán, hệ thống KHÔNG XÓA khỏi cơ sở dữ liệu mà TỰ ĐỘNG CHUYỂN TRẠNG THÁI sang INACTIVE (Ngừng giao dịch).`,
        data: agency,
        isDeactivated: true,
        isDeleted: false,
      };
    }

    // TRƯỜNG HỢP 2: Đại lý chưa có bất kỳ giao dịch nào -> Cho phép xóa an toàn
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(`DELETE FROM agencies WHERE id = $1;`, [
          agency.id,
        ]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[Agencies] Xóa DB thất bại: ${msg}`);
      }
    }

    this.agencies.delete(agency.id);

    return {
      success: true,
      message: `Đã xóa thành công hồ sơ đại lý [${agency.agencyCode}] - ${agency.name} khỏi hệ thống.`,
      isDeactivated: false,
      isDeleted: true,
    };
  }

  /**
   * Ngừng giao dịch đại lý thủ công (chuyển trạng thái sang INACTIVE)
   */
  async deactivateAgency(idOrCode: string): Promise<AgencyEntity> {
    const agency = await this.getAgencyById(idOrCode);
    agency.status = AgencyStatus.INACTIVE;
    agency.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE agencies SET status = 'INACTIVE', updated_at = $1 WHERE id = $2;`,
          [agency.updatedAt, agency.id],
        );
      } catch {
        // Fallback
      }
    }

    this.agencies.set(agency.id, agency);
    return agency;
  }
}

export { AgencyService as AgenciesService };
