import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { SupplierStatus } from '../../common/enums/supplier-status.enum';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { GetSuppliersFilterDto } from './dto/get-suppliers-filter.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierEntity } from './entities/supplier.entity';
import { PaginatedSuppliersResponse } from './interfaces/paginated-suppliers.interface';

/**
 * Service Quản lý Nhà Cung Cấp (SN-25):
 * - Xử lý nghiệp vụ CRUD danh mục Nhà cung cấp
 * - Ràng buộc tính duy nhất của mã Nhà cung cấp (code uppercase, không khoảng trắng)
 * - RÀNG BUỘC TOÀN VẸN: Kiểm tra và chặn xóa Nhà cung cấp đã phát sinh Phiếu nhập kho (Import Receipt / Goods Receipt)
 * - Tìm kiếm đa trường (Mã, Tên, MST, SĐT, Email, Người liên hệ) và phân trang
 */
@Injectable()
export class SuppliersService implements OnModuleInit {
  private suppliers = new Map<string, SupplierEntity>();

  /**
   * Danh sách ID/Mã NCC đã phát sinh Phiếu nhập kho (Goods Receipts / Import Receipts)
   */
  private suppliersWithReceipts = new Set<string>([
    '22222222-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000002',
    'NCC-BEV-01',
    'NCC-AQUA-02',
  ]);

  constructor(@Optional() private readonly dbService?: DatabaseService) {
    this.seedInitialSuppliers();
  }

  async onModuleInit(): Promise<void> {
    if (this.suppliers.size === 0) {
      this.seedInitialSuppliers();
    }
    if (this.dbService?.isConnected()) {
      await this.loadSuppliersFromDatabase();
      await this.loadReceiptConstraintsFromDatabase();
    }
  }

  /**
   * Khởi tạo danh sách nhà cung cấp mẫu chuẩn hóa (tương thích seed data DB)
   */
  private seedInitialSuppliers(): void {
    const defaultSuppliers: SupplierEntity[] = [
      new SupplierEntity({
        id: '22222222-0000-0000-0000-000000000001',
        code: 'NCC-BEV-01',
        name: 'Công ty Cổ phần Nước giải khát LOHA Quốc Tế',
        taxCode: '0312345678',
        contactName: 'Ông Đỗ Quốc Tuấn',
        phone: '02838123456',
        email: 'supply@loha.vn',
        address: 'KCN Tân Bình, Tây Thạnh, Tân Phú, TP.HCM',
        paymentTerms: 'NET_45',
        status: SupplierStatus.ACTIVE,
        notes: 'Nhà cung cấp đồ uống và nguyên liệu nước giải khát chính thức',
        hasReceipts: true,
        createdAt: new Date('2026-01-10T08:00:00Z'),
        updatedAt: new Date('2026-01-10T08:00:00Z'),
      }),
      new SupplierEntity({
        id: '22222222-0000-0000-0000-000000000002',
        code: 'NCC-AQUA-02',
        name: 'Công ty TNHH Khai Thác Khoáng Tinh Khiết Aqua Life',
        taxCode: '0398765432',
        contactName: 'Bà Mai Thị Lan',
        phone: '02723789012',
        email: 'contact@aqualife.vn',
        address: 'Xã Long Hậu, Cần Giuộc, Long An',
        paymentTerms: 'NET_30',
        status: SupplierStatus.ACTIVE,
        notes: 'Chuyên cung cấp nước khoáng thiên nhiên đóng chai các loại',
        hasReceipts: true,
        createdAt: new Date('2026-01-15T09:30:00Z'),
        updatedAt: new Date('2026-01-15T09:30:00Z'),
      }),
      new SupplierEntity({
        id: '22222222-0000-0000-0000-000000000003',
        code: 'NCC-DAIRY-03',
        name: 'Công ty Cổ phần Sữa & Dinh Dưỡng Quốc Tế NutriPlus',
        taxCode: '0105678912',
        contactName: 'Bà Hoàng Thục Anh',
        phone: '02439876543',
        email: 'order@nutriplus.vn',
        address: 'Số 18 Hoàng Quốc Việt, Cầu Giấy, Hà Nội',
        paymentTerms: 'NET_15',
        status: SupplierStatus.ACTIVE,
        notes: 'Đơn vị sản xuất và phân phối sữa bột công thức, sữa hạt cao cấp',
        hasReceipts: false,
        createdAt: new Date('2026-02-01T10:00:00Z'),
        updatedAt: new Date('2026-02-01T10:00:00Z'),
      }),
      new SupplierEntity({
        id: '22222222-0000-0000-0000-000000000004',
        code: 'NCC-PACK-04',
        name: 'Nhà máy Bao Bì & Đóng Gói Tân Tiến Phát',
        taxCode: '0309876541',
        contactName: 'Ông Lê Thanh Hải',
        phone: '02837654321',
        email: 'kinhdoanh@tantienphat.com.vn',
        address: 'Lô B2 KCN Hiệp Phước, Nhà Bè, TP.HCM',
        paymentTerms: 'COD',
        status: SupplierStatus.ACTIVE,
        notes: 'Cung cấp bao bì thùng carton, màng co lốc và tem nhãn',
        hasReceipts: false,
        createdAt: new Date('2026-02-10T14:15:00Z'),
        updatedAt: new Date('2026-02-10T14:15:00Z'),
      }),
      new SupplierEntity({
        id: '22222222-0000-0000-0000-000000000005',
        code: 'NCC-OLD-05',
        name: 'Hợp tác xã Nông Sản Hữu Cơ Sạch Thảo Mộc Xanh',
        taxCode: '3701239876',
        contactName: 'Ông Phạm Văn Hùng',
        phone: '02743890123',
        email: 'thaomocxanh.coop@gmail.com',
        address: 'Phường Lái Thiêu, TP. Thuận An, Bình Dương',
        paymentTerms: 'NET_30',
        status: SupplierStatus.INACTIVE,
        notes: 'Tạm ngừng hợp tác do chuyển đổi mô hình cung ứng vùng nguyên liệu',
        hasReceipts: false,
        createdAt: new Date('2026-01-05T07:45:00Z'),
        updatedAt: new Date('2026-02-20T16:00:00Z'),
      }),
    ];

    for (const sup of defaultSuppliers) {
      this.suppliers.set(sup.id, sup);
    }
  }

  /**
   * Tải danh sách nhà cung cấp từ PostgreSQL (nếu database kết nối)
   */
  private async loadSuppliersFromDatabase(): Promise<void> {
    try {
      const rows = await this.dbService!.query<{
        id: string;
        code: string;
        name: string;
        tax_code?: string;
        contact_name?: string;
        phone?: string;
        email?: string;
        address?: string;
        payment_terms?: string;
        status: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, code, name, tax_code, contact_name, phone, email, address, payment_terms, status, created_at, updated_at
         FROM suppliers;`,
      );

      for (const row of rows) {
        const entity = new SupplierEntity({
          id: row.id,
          code: row.code,
          name: row.name,
          taxCode: row.tax_code,
          contactName: row.contact_name,
          phone: row.phone,
          email: row.email,
          address: row.address,
          paymentTerms: row.payment_terms,
          status:
            row.status === 'INACTIVE'
              ? SupplierStatus.INACTIVE
              : SupplierStatus.ACTIVE,
          hasReceipts:
            this.suppliersWithReceipts.has(row.id) ||
            this.suppliersWithReceipts.has(row.code),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });

        this.suppliers.set(entity.id, entity);
      }
    } catch {
      // Fallback in-memory
    }
  }

  /**
   * Kiểm tra ràng buộc phiếu nhập kho từ CSDL
   */
  private async loadReceiptConstraintsFromDatabase(): Promise<void> {
    try {
      const rows = await this.dbService!.query<{ supplier_id: string }>(
        `SELECT DISTINCT supplier_id FROM goods_receipts WHERE supplier_id IS NOT NULL;`,
      );
      for (const row of rows) {
        if (row.supplier_id) {
          this.suppliersWithReceipts.add(row.supplier_id);
          const found = this.suppliers.get(row.supplier_id);
          if (found) {
            found.hasReceipts = true;
          }
        }
      }
    } catch {
      // Fallback
    }
  }

  /**
   * Lấy danh sách tất cả nhà cung cấp (hỗ trợ phân trang, lọc và tìm kiếm)
   */
  async findAllPaginated(
    filterDto: GetSuppliersFilterDto,
  ): Promise<PaginatedSuppliersResponse> {
    let list = Array.from(this.suppliers.values());

    // 1. Đồng bộ trạng thái hasReceipts
    list.forEach((s) => {
      s.hasReceipts =
        this.suppliersWithReceipts.has(s.id) ||
        this.suppliersWithReceipts.has(s.code);
    });

    // 2. Tìm kiếm đa trường (Mã, Tên, MST, Người liên hệ, SĐT, Email)
    if (filterDto.search && filterDto.search.trim().length > 0) {
      const q = filterDto.search.trim().toLowerCase();
      list = list.filter((s) => {
        return (
          s.code.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.taxCode && s.taxCode.toLowerCase().includes(q)) ||
          (s.contactName && s.contactName.toLowerCase().includes(q)) ||
          (s.phone && s.phone.toLowerCase().includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q))
        );
      });
    }

    // 3. Lọc theo trạng thái
    if (filterDto.status) {
      list = list.filter((s) => s.status === filterDto.status);
    }

    // 4. Sắp xếp giảm dần theo thời gian tạo
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // 5. Phân trang
    const total = list.length;
    const page = Math.max(1, Number(filterDto.page) || 1);
    const limit = Math.max(1, Number(filterDto.limit) || 20);
    const totalPages = Math.ceil(total / limit) || 1;
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
   * Lấy chi tiết nhà cung cấp theo ID hoặc Mã
   */
  async findById(idOrCode: string): Promise<SupplierEntity> {
    const trimmed = idOrCode.trim();
    let supplier = this.suppliers.get(trimmed);

    if (!supplier) {
      supplier = Array.from(this.suppliers.values()).find(
        (s) =>
          s.code.toUpperCase() === trimmed.toUpperCase() || s.id === trimmed,
      );
    }

    if (!supplier) {
      throw new NotFoundException(
        `Không tìm thấy nhà cung cấp với mã hoặc ID '${idOrCode}'`,
      );
    }

    supplier.hasReceipts =
      this.suppliersWithReceipts.has(supplier.id) ||
      this.suppliersWithReceipts.has(supplier.code);

    return supplier;
  }

  /**
   * Thêm mới nhà cung cấp
   */
  async create(dto: CreateSupplierDto): Promise<SupplierEntity> {
    // 1. Xử lý mã NCC: Nếu không nhập thì tự động sinh theo mẫu NCC-xxx
    let code = dto.code ? dto.code.trim().toUpperCase() : '';
    if (!code) {
      const nextNum = this.suppliers.size + 1;
      code = `NCC-${String(nextNum).padStart(3, '0')}`;
    }

    // 2. Chặn trùng lặp mã NCC
    const existing = Array.from(this.suppliers.values()).find(
      (s) => s.code.toUpperCase() === code.toUpperCase(),
    );
    if (existing) {
      throw new BadRequestException(
        `Mã nhà cung cấp '${code}' đã tồn tại trên hệ thống`,
      );
    }

    // 3. Khởi tạo entity mới
    const id = `sup-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const newSupplier = new SupplierEntity({
      id,
      code,
      name: dto.name.trim(),
      taxCode: dto.taxCode?.trim(),
      contactName: dto.contactName?.trim(),
      phone: dto.phone?.trim(),
      email: dto.email?.trim(),
      address: dto.address?.trim(),
      paymentTerms: dto.paymentTerms?.trim() || 'NET_30',
      status: dto.status || SupplierStatus.ACTIVE,
      notes: dto.notes?.trim(),
      hasReceipts: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 4. Lưu vào cơ sở dữ liệu nếu có kết nối
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `INSERT INTO suppliers (id, code, name, tax_code, contact_name, phone, email, address, payment_terms, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`,
          [
            newSupplier.id,
            newSupplier.code,
            newSupplier.name,
            newSupplier.taxCode || null,
            newSupplier.contactName || null,
            newSupplier.phone || null,
            newSupplier.email || null,
            newSupplier.address || null,
            newSupplier.paymentTerms || null,
            newSupplier.status,
            newSupplier.createdAt,
            newSupplier.updatedAt,
          ],
        );
      } catch {
        // Tiếp tục lưu in-memory
      }
    }

    this.suppliers.set(newSupplier.id, newSupplier);
    return newSupplier;
  }

  /**
   * Cập nhật thông tin nhà cung cấp
   */
  async update(id: string, dto: UpdateSupplierDto): Promise<SupplierEntity> {
    const supplier = await this.findById(id);

    // Kiểm tra trùng lặp mã nếu thay đổi code
    if (dto.code) {
      const cleanCode = dto.code.trim().toUpperCase();
      const existing = Array.from(this.suppliers.values()).find(
        (s) =>
          s.id !== supplier.id &&
          s.code.toUpperCase() === cleanCode.toUpperCase(),
      );
      if (existing) {
        throw new BadRequestException(
          `Mã nhà cung cấp '${cleanCode}' đã tồn tại trên hệ thống`,
        );
      }
      supplier.code = cleanCode;
    }

    if (dto.name !== undefined) supplier.name = dto.name.trim();
    if (dto.taxCode !== undefined) supplier.taxCode = dto.taxCode?.trim();
    if (dto.contactName !== undefined)
      supplier.contactName = dto.contactName?.trim();
    if (dto.phone !== undefined) supplier.phone = dto.phone?.trim();
    if (dto.email !== undefined) supplier.email = dto.email?.trim();
    if (dto.address !== undefined) supplier.address = dto.address?.trim();
    if (dto.paymentTerms !== undefined)
      supplier.paymentTerms = dto.paymentTerms?.trim();
    if (dto.status !== undefined) supplier.status = dto.status;
    if (dto.notes !== undefined) supplier.notes = dto.notes?.trim();

    supplier.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE suppliers
           SET code = $1, name = $2, tax_code = $3, contact_name = $4, phone = $5,
               email = $6, address = $7, payment_terms = $8, status = $9, updated_at = $10
           WHERE id = $11;`,
          [
            supplier.code,
            supplier.name,
            supplier.taxCode || null,
            supplier.contactName || null,
            supplier.phone || null,
            supplier.email || null,
            supplier.address || null,
            supplier.paymentTerms || null,
            supplier.status,
            supplier.updatedAt,
            supplier.id,
          ],
        );
      } catch {
        // In-memory update
      }
    }

    return supplier;
  }

  /**
   * Chuyển đổi nhanh trạng thái Active / Inactive
   */
  async updateStatus(
    id: string,
    newStatus?: SupplierStatus,
  ): Promise<SupplierEntity> {
    const supplier = await this.findById(id);

    const targetStatus =
      newStatus !== undefined
        ? newStatus
        : supplier.status === SupplierStatus.ACTIVE
          ? SupplierStatus.INACTIVE
          : SupplierStatus.ACTIVE;

    supplier.status = targetStatus;
    supplier.updatedAt = new Date();

    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(
          `UPDATE suppliers SET status = $1, updated_at = $2 WHERE id = $3;`,
          [supplier.status, supplier.updatedAt, supplier.id],
        );
      } catch {
        // In-memory update
      }
    }

    return supplier;
  }

  /**
   * Xóa nhà cung cấp - RÀNG BUỘC PHIẾU NHẬP KHO (Import Receipt Constraint):
   * Nếu đã phát sinh phiếu nhập kho, từ chối xóa và ném lỗi HTTP 400 Bad Request.
   * Nếu chưa từng có phiếu nhập kho, cho phép xóa vật lý.
   */
  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const supplier = await this.findById(id);

    // 1. Kiểm tra trong Set in-memory
    const hasReceiptInMemory =
      this.suppliersWithReceipts.has(supplier.id) ||
      this.suppliersWithReceipts.has(supplier.code);

    // 2. Kiểm tra trong cơ sở dữ liệu nếu kết nối
    let hasReceiptInDb = false;
    if (this.dbService?.isConnected()) {
      try {
        const rows = await this.dbService.query<{ count: string | number }>(
          `SELECT COUNT(*) as count FROM goods_receipts WHERE supplier_id = $1;`,
          [supplier.id],
        );
        if (rows.length > 0 && Number(rows[0].count) > 0) {
          hasReceiptInDb = true;
          this.suppliersWithReceipts.add(supplier.id);
        }
      } catch {
        // Fallback
      }
    }

    if (hasReceiptInMemory || hasReceiptInDb) {
      throw new BadRequestException(
        'Nhà cung cấp đã phát sinh phiếu nhập kho. Không thể xóa, vui lòng chuyển trạng thái sang Ngừng hoạt động (Inactive).',
      );
    }

    // 3. Thực hiện xóa an toàn
    if (this.dbService?.isConnected()) {
      try {
        await this.dbService.query(`DELETE FROM suppliers WHERE id = $1;`, [
          supplier.id,
        ]);
      } catch {
        // In-memory delete
      }
    }

    this.suppliers.delete(supplier.id);

    return {
      success: true,
      message: `Đã xóa nhà cung cấp '${supplier.name}' (${supplier.code}) thành công`,
    };
  }
}
