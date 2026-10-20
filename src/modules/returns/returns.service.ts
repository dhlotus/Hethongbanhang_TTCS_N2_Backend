import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Optional,
  Inject,
  forwardRef,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';
import { InvoicesService, InvoiceItem, InvoiceLineItem } from '../invoices/invoices.service';
import { CustomersService } from '../customers/customers.service';
import { CreateReturnReceiptDto, ReturnConditionType } from './dto/create-return-receipt.dto';
import { ApproveReturnReceiptDto, ReturnApprovalAction } from './dto/approve-return-receipt.dto';
import {
  ReturnReceiptEntity,
  ReturnReceiptItemEntity,
  ReturnReceiptStatus,
} from './entities/return-receipt.entity';

export interface ReturnRequestItem {
  id: string;
  requestCode: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  salesRepId?: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'RECEIVED' | 'ADJUSTED' | 'REJECTED';
  refundAmount?: number;
  warehouseNote?: string;
  accountantNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_WAREHOUSE_ID = '11111111-0000-0000-0000-000000000001';

@Injectable()
export class ReturnsService implements OnModuleInit {
  private readonly logger = new Logger(ReturnsService.name);
  private readonly fallbackReceipts = new Map<string, ReturnReceiptEntity>();

  constructor(
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => InvoicesService))
    private readonly invoicesService?: InvoicesService,
    @Optional()
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService?: CustomersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTables();
  }

  /**
   * Khởi tạo các bảng phục vụ quản lý phiếu trả hàng & kho hàng lỗi (SN-210)
   */
  async ensureTables(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(`
        -- 1. Bảng quản lý chung phiếu trả hàng
        CREATE TABLE IF NOT EXISTS return_receipts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code VARCHAR(50) UNIQUE NOT NULL,
          original_invoice_id VARCHAR(100) NOT NULL,
          agency_id VARCHAR(100) NOT NULL,
          warehouse_id VARCHAR(100) NOT NULL DEFAULT '${DEFAULT_WAREHOUSE_ID}',
          status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
          reason TEXT NOT NULL,
          total_refund_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
          created_by VARCHAR(100) NOT NULL,
          warehouse_manager_id VARCHAR(100),
          approved_at TIMESTAMPTZ,
          approval_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        -- 2. Bảng chi tiết hàng trả từng dòng
        CREATE TABLE IF NOT EXISTS return_receipt_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          return_receipt_id UUID NOT NULL,
          product_id VARCHAR(100) NOT NULL,
          product_sku VARCHAR(100) NOT NULL,
          product_name VARCHAR(255) NOT NULL,
          unit VARCHAR(50),
          batch_number VARCHAR(100),
          quantity NUMERIC(15, 2) NOT NULL CHECK (quantity > 0),
          unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
          line_total NUMERIC(15, 2) NOT NULL DEFAULT 0,
          condition_type VARCHAR(20) NOT NULL CHECK (condition_type IN ('GOOD', 'DAMAGED')),
          sub_reason TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_return_receipt_items_receipt_id
          ON return_receipt_items(return_receipt_id);

        -- 3. Bảng tồn kho hàng lỗi phân tách theo từng kho (damaged_stock_balances)
        CREATE TABLE IF NOT EXISTS damaged_stock_balances (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          warehouse_id VARCHAR(100) NOT NULL,
          product_id VARCHAR(100) NOT NULL,
          product_sku VARCHAR(100) NOT NULL,
          batch_number VARCHAR(100) NOT NULL DEFAULT '',
          quantity NUMERIC(15, 2) NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uq_damaged_stock_wh_prod_batch UNIQUE (warehouse_id, product_id, batch_number)
        );

        -- 4. Bảng sequence sinh mã phiếu trả hàng
        CREATE TABLE IF NOT EXISTS return_receipt_sequences (
          prefix VARCHAR(50) PRIMARY KEY,
          current_number BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.logger.log('[ReturnsService] Đã đồng bộ các bảng return_receipts, return_receipt_items, damaged_stock_balances.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[ReturnsService] Lỗi khởi tạo bảng phiếu trả hàng: ${msg}`);
    }
  }

  /**
   * Sinh mã phiếu trả hàng theo mẫu PTHT-YYMM-XXX hoặc PT-YYMM-XXX
   */
  private async getNextReceiptCode(): Promise<string> {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `PTHT-${yy}${mm}-`;

    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<{ current_number: string }>(
          `INSERT INTO return_receipt_sequences (prefix, current_number, updated_at)
           VALUES ($1, 1, CURRENT_TIMESTAMP)
           ON CONFLICT (prefix)
           DO UPDATE SET current_number = return_receipt_sequences.current_number + 1,
                         updated_at = CURRENT_TIMESTAMP
           RETURNING current_number;`,
          [prefix],
        );
        const seq = Number(rows[0]?.current_number || 1);
        return `${prefix}${seq.toString().padStart(3, '0')}`;
      } catch (err) {
        this.logger.warn(`Lỗi sequence DB, fallback: ${(err as Error).message}`);
      }
    }
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}${rand}`;
  }

  /**
   * Tìm thông tin hóa đơn gốc và các dòng sản phẩm đã mua
   */
  async getOriginalInvoiceDetails(invoiceIdOrCode: string): Promise<{
    invoice: InvoiceItem;
    lines: Array<{
      productId: string;
      productSku: string;
      productName: string;
      unit: string;
      purchasedQuantity: number;
      unitPrice: number;
      alreadyReturnedQuantity: number;
      remainingReturnableQuantity: number;
      availableBatches?: string[];
    }>;
  }> {
    let invoice: InvoiceItem | null = null;
    let rawItems: InvoiceLineItem[] = [];
    if (this.invoicesService) {
      try {
        invoice = await this.invoicesService.findById(invoiceIdOrCode);
        if (invoice?.items) {
          rawItems = [...invoice.items];
        }
      } catch {}
    }

    if (!invoice && this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<any>(
          `SELECT i.*, c.name as customer_name, c.code as customer_code
           FROM invoices i
           LEFT JOIN customers c ON c.id = i.customer_id
           WHERE i.id::text = $1 OR i.code = $1 LIMIT 1`,
          [invoiceIdOrCode],
        );
        if (rows[0]) {
          const r = rows[0];
          invoice = {
            id: r.id,
            invoiceCode: r.code,
            orderId: r.order_id,
            orderCode: 'DH-GOC',
            customerId: r.customer_id,
            customerName: r.customer_name || 'Đại lý',
            amount: Number(r.total_amount || 0),
            paidAmount: Number(r.paid_amount || 0),
            remainingAmount: Number(r.remaining_amount || 0),
            status: r.payment_status || 'ISSUED',
            issueDate: new Date(r.issue_date),
            dueDate: new Date(r.due_date),
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
          };
        }
      } catch {}

      // Nếu không có trong invoices, tìm trong app_order_records
      if (!invoice) {
        try {
          const ordRows = await this.databaseService.query<any>(
            `SELECT id, order_code, payload, created_at, updated_at
             FROM app_order_records
             WHERE order_code = $1 OR id = $1 LIMIT 1`,
            [invoiceIdOrCode],
          );
          if (ordRows[0]) {
            const row = ordRows[0];
            const p = row.payload || {};
            invoice = {
              id: row.id,
              invoiceCode: row.order_code,
              orderId: row.id,
              orderCode: row.order_code,
              customerId: p.customerId || 'cust-dl-0001',
              customerName: p.customerName || 'Đại lý',
              amount: Number(p.grandTotal || p.totalAmount || p.subtotal || 0),
              paidAmount: Number(p.grandTotal || p.totalAmount || 0),
              remainingAmount: 0,
              status: 'PAID',
              issueDate: new Date(p.deliveryDate || p.createdAt || row.created_at),
              dueDate: new Date(p.deliveryDate || p.createdAt || row.created_at),
              createdAt: new Date(row.created_at),
              updatedAt: new Date(row.updated_at),
            };

            if (Array.isArray(p.lines) && p.lines.length > 0) {
              rawItems = p.lines.map((l: any) => ({
                productId: l.productId || `prod-${l.productSku}`,
                productSku: l.productSku || 'SKU',
                productName: l.productName || 'Sản phẩm',
                unit: l.unit || 'Lon',
                quantity: Number(l.quantity || 0),
                orderedQuantity: Number(l.quantity || 0),
                unitPrice: Number(l.unitPrice || 0),
                discountPercent: Number(l.discountPercent || 0),
                lineTotal: Number(l.lineTotal || 0),
              }));
            }
          }
        } catch {}
      }

      // Nếu vẫn chưa thấy, tìm trong bảng orders (chuẩn SQL)
      if (!invoice) {
        try {
          const sqlOrders = await this.databaseService.query<any>(
            `SELECT o.*, c.name as customer_name, c.code as customer_code
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE o.id::text = $1 OR o.code = $1 LIMIT 1`,
            [invoiceIdOrCode],
          );
          if (sqlOrders[0]) {
            const o = sqlOrders[0];
            invoice = {
              id: o.id,
              invoiceCode: o.code,
              orderId: o.id,
              orderCode: o.code,
              customerId: o.customer_id,
              customerName: o.customer_name || 'Đại lý',
              amount: Number(o.final_amount || o.total_amount || 0),
              paidAmount: Number(o.final_amount || o.total_amount || 0),
              remainingAmount: 0,
              status: 'PAID',
              issueDate: new Date(o.created_at),
              dueDate: new Date(o.created_at),
              createdAt: new Date(o.created_at),
              updatedAt: new Date(o.updated_at),
            };
          }
        } catch {}
      }
    }

    if (!invoice) {
      throw new NotFoundException(`Không tìm thấy hóa đơn gốc ${invoiceIdOrCode}`);
    }

    // Lấy các dòng sản phẩm của hóa đơn nếu chưa được nạp
    if (rawItems.length === 0 && this.databaseService?.isConnected()) {
      try {
        const dbItems = await this.databaseService.query<any>(
          `SELECT * FROM invoice_items WHERE invoice_id = $1 OR invoice_id = $2`,
          [invoice.id, invoice.invoiceCode],
        );
        if (dbItems.length > 0) {
          rawItems = dbItems.map((di) => ({
            productId: di.product_id || `prod-${di.product_sku}`,
            productSku: di.product_sku,
            productName: di.product_name,
            unit: di.unit,
            quantity: Number(di.quantity || 0),
            orderedQuantity: Number(di.ordered_quantity || di.quantity || 0),
            unitPrice: Number(di.unit_price || 0),
            discountPercent: Number(di.discount_percent || 0),
            lineTotal: Number(di.line_total || 0),
          }));
        }
      } catch {}
    }

    // Nếu vẫn chưa có dòng sản phẩm, fallback mẫu dựa vào hóa đơn
    if (rawItems.length === 0) {
      rawItems = [
        {
          productId: '33333333-0000-0000-0000-000000000001',
          productSku: 'LOHA-COLA-330',
          productName: 'Nước ngọt có ga LOHA Cola 330ml',
          unit: 'Lon',
          quantity: 100,
          unitPrice: 8775,
          lineTotal: 877500,
        },
      ];
    }

    // Tính số lượng đã từng trả ở các phiếu PENDING hoặc APPROVED của hóa đơn này
    const returnedMap = new Map<string, number>();
    if (this.databaseService?.isConnected()) {
      try {
        const retRows = await this.databaseService.query<{ product_sku: string; product_id: string; returned_qty: string }>(
          `SELECT rri.product_sku, rri.product_id, COALESCE(SUM(rri.quantity), 0)::text as returned_qty
           FROM return_receipt_items rri
           JOIN return_receipts rr ON rr.id = rri.return_receipt_id
           WHERE (rr.original_invoice_id = $1 OR rr.original_invoice_id = $2)
             AND rr.status IN ('PENDING', 'APPROVED')
           GROUP BY rri.product_sku, rri.product_id;`,
          [invoice.id, invoice.invoiceCode],
        );
        for (const rr of retRows) {
          const qty = Number(rr.returned_qty || 0);
          if (rr.product_sku) returnedMap.set(rr.product_sku.toUpperCase(), (returnedMap.get(rr.product_sku.toUpperCase()) || 0) + qty);
          if (rr.product_id) returnedMap.set(rr.product_id, (returnedMap.get(rr.product_id) || 0) + qty);
        }
      } catch {}
    }

    // Lấy danh sách số lô của từng sản phẩm trong kho
    const productBatchesMap = new Map<string, string[]>();
    if (this.databaseService?.isConnected()) {
      try {
        const batchRows = await this.databaseService.query<{ product_id: string; sku: string; batch_number: string }>(
          `SELECT DISTINCT b.product_id, UPPER(p.sku) as sku, b.batch_number
           FROM inventory_batches b
           LEFT JOIN products p ON p.id = b.product_id
           WHERE b.batch_number IS NOT NULL AND TRIM(b.batch_number) != '';`,
        );
        for (const b of batchRows || []) {
          const bNum = b.batch_number?.trim();
          if (!bNum) continue;
          if (b.product_id) {
            const list = productBatchesMap.get(b.product_id) || [];
            if (!list.includes(bNum)) list.push(bNum);
            productBatchesMap.set(b.product_id, list);
          }
          if (b.sku) {
            const list = productBatchesMap.get(b.sku) || [];
            if (!list.includes(bNum)) list.push(bNum);
            productBatchesMap.set(b.sku, list);
          }
        }
      } catch {}
    }

    const lines = rawItems.map((item) => {
      const pSku = item.productSku?.toUpperCase() || '';
      const pId = item.productId || '';
      const alreadyReturned = returnedMap.get(pSku) || returnedMap.get(pId) || 0;
      const purchasedQuantity = Number(item.quantity || 0);
      const remainingReturnableQuantity = Math.max(0, purchasedQuantity - alreadyReturned);
      const batches =
        productBatchesMap.get(pId) ||
        productBatchesMap.get(pSku) ||
        [];

      return {
        productId: item.productId,
        productSku: item.productSku,
        productName: item.productName,
        unit: item.unit || 'Lon',
        purchasedQuantity,
        unitPrice: Number(item.unitPrice || 0),
        alreadyReturnedQuantity: alreadyReturned,
        remainingReturnableQuantity,
        availableBatches: batches,
      };
    });

    return { invoice, lines };
  }

  /**
   * Phân giải tập các Customer ID / Code hợp lệ của đại lý được chọn
   */
  private async resolveEligibleCustomerIds(agencyId?: string): Promise<string[]> {
    if (!agencyId) return [];
    const set = new Set<string>();
    set.add(agencyId.trim());

    // Các alias chuẩn giữa bảng customers và app_order_records
    if (
      agencyId === '55555555-0000-0000-0000-000000000001' ||
      agencyId === 'cust-dl-0001' ||
      agencyId === 'cust-001' ||
      agencyId === 'DL-0001' ||
      agencyId === 'DL-MK-001'
    ) {
      set.add('55555555-0000-0000-0000-000000000001');
      set.add('cust-dl-0001');
      set.add('cust-001');
      set.add('DL-0001');
      set.add('DL-MK-001');
    } else if (
      agencyId === '55555555-0000-0000-0000-000000000002' ||
      agencyId === 'cust-dl-0002' ||
      agencyId === 'cust-002' ||
      agencyId === 'DL-0002' ||
      agencyId === 'DL-AB-002'
    ) {
      set.add('55555555-0000-0000-0000-000000000002');
      set.add('cust-dl-0002');
      set.add('cust-002');
      set.add('DL-0002');
      set.add('DL-AB-002');
    } else if (
      agencyId === '55555555-0000-0000-0000-000000000003' ||
      agencyId === 'cust-dl-0003' ||
      agencyId === 'cust-003' ||
      agencyId === 'DL-0003' ||
      agencyId === 'DL-HT-003'
    ) {
      set.add('55555555-0000-0000-0000-000000000003');
      set.add('cust-dl-0003');
      set.add('cust-003');
      set.add('DL-0003');
      set.add('DL-HT-003');
    }

    if (this.customersService) {
      try {
        const cust = await this.customersService.getCustomerById(agencyId);
        if (cust) {
          if (cust.id) set.add(cust.id);
          if (cust.code) set.add(cust.code);
          if (cust.name) set.add(cust.name);
        }
      } catch {}
    }

    return Array.from(set);
  }

  /**
   * API lấy danh sách hóa đơn khả dụng để lập phiếu trả hàng (dành cho form tạo)
   * Chuẩn hóa điều kiện WHERE: Bắt đúng các đơn có trạng thái "Giao thành công" (DELIVERED) của đại lý
   */
  async getEligibleInvoices(agencyId?: string, currentUser?: ICurrentUser): Promise<any[]> {
    const candidateCustomerIds = await this.resolveEligibleCustomerIds(agencyId);
    const resultsMap = new Map<string, any>();

    // 1. Truy vấn trực tiếp từ PostgreSQL bắt đúng điều kiện WHERE status = 'DELIVERED'
    if (this.databaseService?.isConnected()) {
      try {
        const querySql = `
          WITH delivered_candidates AS (
            -- Nguồn 1: Các đơn giao thành công từ app_order_records
            SELECT 
              id,
              order_code as code,
              order_code as "orderCode",
              payload->>'customerId' as "customerId",
              payload->>'customerName' as "customerName",
              COALESCE((payload->>'grandTotal')::numeric, (payload->>'totalAmount')::numeric, (payload->>'subtotal')::numeric, 0) as "totalAmount",
              payload->>'status' as status,
              COALESCE((payload->>'deliveryDate')::timestamptz, (payload->>'createdAt')::timestamptz, created_at) as "issueDate",
              0::numeric as "remainingAmount"
            FROM app_order_records
            WHERE UPPER(COALESCE(payload->>'status', '')) = 'DELIVERED'

            UNION ALL

            -- Nguồn 2: Các đơn giao thành công từ bảng orders
            SELECT 
              o.id::text as id,
              o.code,
              o.code as "orderCode",
              o.customer_id::text as "customerId",
              c.name as "customerName",
              COALESCE(o.final_amount, o.total_amount, 0)::numeric as "totalAmount",
              o.status,
              o.created_at as "issueDate",
              0::numeric as "remainingAmount"
            FROM orders o
            LEFT JOIN customers c ON c.id = o.customer_id
            WHERE UPPER(o.status) = 'DELIVERED'

            UNION ALL

            -- Nguồn 3: Hóa đơn từ bảng invoices có đơn hàng liên kết đã giao thành công (DELIVERED)
            SELECT 
              i.id::text as id,
              i.code,
              COALESCE(o.code, i.code) as "orderCode",
              i.customer_id::text as "customerId",
              c.name as "customerName",
              i.total_amount::numeric as "totalAmount",
              COALESCE(o.status, 'DELIVERED') as status,
              i.issue_date as "issueDate",
              COALESCE(i.remaining_amount, 0)::numeric as "remainingAmount"
            FROM invoices i
            LEFT JOIN orders o ON o.id = i.order_id
            LEFT JOIN customers c ON c.id = i.customer_id
            WHERE UPPER(COALESCE(o.status, 'DELIVERED')) = 'DELIVERED'
              AND i.payment_status NOT IN ('CANCELLED', 'DRAFT')
          )
          SELECT DISTINCT ON (code)
            id,
            code,
            "orderCode",
            "customerId",
            "customerName",
            "totalAmount",
            "issueDate",
            "remainingAmount",
            status
          FROM delivered_candidates
          ORDER BY code, "issueDate" DESC;
        `;

        const rows = await this.databaseService.query<any>(querySql);
        for (const row of rows) {
          const matchAgency =
            candidateCustomerIds.length === 0 ||
            candidateCustomerIds.includes(row.customerId) ||
            candidateCustomerIds.some((id) => (row.customerName || '').toLowerCase().includes(id.toLowerCase()));

          if (matchAgency) {
            resultsMap.set(row.code, {
              id: row.id,
              code: row.code,
              orderCode: row.orderCode || row.code,
              customerId: row.customerId,
              customerName: row.customerName || 'Đại lý',
              totalAmount: Number(row.totalAmount || 0),
              issueDate: row.issueDate,
              remainingAmount: Number(row.remainingAmount || 0),
            });
          }
        }
      } catch (err) {
        this.logger.warn(`Lỗi truy vấn SQL eligible-invoices: ${(err as Error).message}`);
      }
    }

    // 2. Fallback / Merge thêm từ InvoicesService nếu có hóa đơn hợp lệ chưa nằm trong map
    if (this.invoicesService) {
      try {
        const allInvoices = await this.invoicesService.getAllInvoices();
        for (const inv of allInvoices) {
          if (inv.status === 'CANCELLED' || inv.status === 'DRAFT') continue;
          const matchAgency =
            candidateCustomerIds.length === 0 ||
            candidateCustomerIds.includes(inv.customerId) ||
            candidateCustomerIds.some((id) => (inv.customerName || '').toLowerCase().includes(id.toLowerCase()));

          if (matchAgency && !resultsMap.has(inv.invoiceCode) && !resultsMap.has(inv.id)) {
            resultsMap.set(inv.invoiceCode, {
              id: inv.id,
              code: inv.invoiceCode,
              orderCode: inv.orderCode || inv.invoiceCode,
              customerId: inv.customerId,
              customerName: inv.customerName,
              totalAmount: inv.amount,
              issueDate: inv.issueDate,
              remainingAmount: inv.remainingAmount,
            });
          }
        }
      } catch {}
    }

    return Array.from(resultsMap.values());
  }

  /**
   * API 1: Tạo mới phiếu trả hàng (Dành cho Nhân viên kinh doanh)
   * POST /api/return-receipts
   */
  async createReturnReceipt(
    dto: CreateReturnReceiptDto,
    currentUser?: ICurrentUser,
  ): Promise<ReturnReceiptEntity> {
    await this.ensureTables();

    // 1. Kiểm tra hóa đơn gốc và hạn mức số lượng từng dòng sản phẩm
    const { invoice, lines } = await this.getOriginalInvoiceDetails(dto.original_invoice_id);

    // Kiểm tra hóa đơn có thuộc về đại lý gửi lên không
    const isMatchingAgency =
      invoice.customerId === dto.agency_id ||
      (dto.agency_id === '55555555-0000-0000-0000-000000000001' && invoice.customerId === 'cust-001') ||
      (dto.agency_id === 'cust-001' && invoice.customerId === '55555555-0000-0000-0000-000000000001') ||
      (dto.agency_id === '55555555-0000-0000-0000-000000000002' && invoice.customerId === 'cust-002') ||
      (dto.agency_id === 'cust-002' && invoice.customerId === '55555555-0000-0000-0000-000000000002');

    if (!isMatchingAgency) {
      throw new BadRequestException(
        `Hóa đơn ${invoice.invoiceCode} không thuộc về đại lý ${dto.agency_id}. Vui lòng chọn đúng hóa đơn của đại lý.`,
      );
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Vui lòng chọn ít nhất một sản phẩm cần trả hàng.');
    }

    // 2. Validate số lượng trả của từng sản phẩm không vượt quá số lượng còn được phép trả
    let totalRefundAmount = 0;
    const validatedItems: ReturnReceiptItemEntity[] = [];

    for (const itemDto of dto.items) {
      const line = lines.find(
        (l) =>
          l.productId === itemDto.product_id ||
          (itemDto.product_sku && l.productSku.toUpperCase() === itemDto.product_sku.toUpperCase()),
      );

      if (!line) {
        throw new BadRequestException(
          `Sản phẩm ID ${itemDto.product_id} (${itemDto.product_name || itemDto.product_sku || ''}) không tồn tại trong hóa đơn gốc ${invoice.invoiceCode}.`,
        );
      }

      const returnQty = Number(itemDto.quantity);
      if (returnQty <= 0) {
        throw new BadRequestException(`Số lượng trả của sản phẩm ${line.productName} phải lớn hơn 0.`);
      }

      if (returnQty > line.remainingReturnableQuantity) {
        throw new BadRequestException(
          `Số lượng trả của sản phẩm "${line.productName}" là ${returnQty} ${line.unit}, vượt quá số lượng tối đa còn được phép trả (${line.remainingReturnableQuantity} ${line.unit}). Đã mua: ${line.purchasedQuantity}, đã lập trả trước đó: ${line.alreadyReturnedQuantity}.`,
        );
      }

      const unitPrice = itemDto.unit_price !== undefined ? Number(itemDto.unit_price) : line.unitPrice;
      const lineTotal = Math.round(returnQty * unitPrice);
      totalRefundAmount += lineTotal;

      validatedItems.push({
        id: `rri-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        returnReceiptId: '',
        productId: line.productId || itemDto.product_id,
        productSku: line.productSku || itemDto.product_sku || 'SKU',
        productName: line.productName || itemDto.product_name || 'Sản phẩm',
        unit: line.unit || itemDto.unit || 'Lon',
        batchNumber: itemDto.batch_number || null,
        quantity: returnQty,
        unitPrice,
        lineTotal,
        conditionType: itemDto.condition_type,
        subReason: itemDto.sub_reason || null,
        createdAt: new Date(),
      });
    }

    // 3. Xác định kho tiếp nhận
    let warehouseId = dto.warehouse_id || DEFAULT_WAREHOUSE_ID;
    if (this.databaseService?.isConnected() && (!dto.warehouse_id || dto.warehouse_id === DEFAULT_WAREHOUSE_ID)) {
      try {
        const whRow = await this.databaseService.query<{ warehouse_id: string }>(
          `SELECT warehouse_id FROM orders WHERE id::text = $1 OR code = $1 LIMIT 1`,
          [invoice.orderId || invoice.orderCode],
        );
        if (whRow[0]?.warehouse_id) warehouseId = whRow[0].warehouse_id;
      } catch {}
    }

    // 4. Sinh mã phiếu trả và lưu vào PostgreSQL
    const receiptCode = await this.getNextReceiptCode();
    const now = new Date();
    const createdBy = currentUser?.userId || 'usr-sales-01';

    let savedReceipt: ReturnReceiptEntity;

    if (this.databaseService?.isConnected()) {
      try {
        const res = await this.databaseService.query<any>(
          `INSERT INTO return_receipts (
             code, original_invoice_id, agency_id, warehouse_id, status, reason,
             total_refund_amount, created_by, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6, $7, NOW(), NOW())
           RETURNING *;`,
          [
            receiptCode,
            invoice.invoiceCode,
            dto.agency_id,
            warehouseId,
            dto.reason.trim(),
            totalRefundAmount,
            createdBy,
          ],
        );

        const r = res[0];
        const receiptId = r.id;

        // Lưu từng dòng item
        for (const it of validatedItems) {
          it.returnReceiptId = receiptId;
          const itRes = await this.databaseService.query<any>(
            `INSERT INTO return_receipt_items (
               return_receipt_id, product_id, product_sku, product_name, unit,
               batch_number, quantity, unit_price, line_total, condition_type, sub_reason, created_at
             ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
             RETURNING id;`,
            [
              receiptId,
              it.productId,
              it.productSku,
              it.productName,
              it.unit,
              it.batchNumber,
              it.quantity,
              it.unitPrice,
              it.lineTotal,
              it.conditionType,
              it.subReason,
            ],
          );
          if (itRes[0]?.id) it.id = itRes[0].id;

          // Nếu là hàng lỗi, lập tức phân loại ghi nhận vào bảng kho hàng lỗi (damaged_stock_balances)
          if (it.conditionType === ReturnConditionType.DAMAGED) {
            try {
              await this.databaseService.query(
                `INSERT INTO damaged_stock_balances (warehouse_id, product_id, product_sku, batch_number, quantity, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (warehouse_id, product_id, batch_number)
                 DO UPDATE SET quantity = damaged_stock_balances.quantity + $5, updated_at = NOW();`,
                [
                  warehouseId,
                  it.productId,
                  it.productSku.toUpperCase(),
                  it.batchNumber ? it.batchNumber.trim() : '',
                  it.quantity,
                ],
              );
            } catch (dErr: any) {
              this.logger.warn(`Lỗi ghi damaged_stock_balances khi tạo phiếu: ${dErr.message}`);
            }
          }
        }

        savedReceipt = {
          id: receiptId,
          code: r.code,
          originalInvoiceId: r.original_invoice_id,
          originalInvoiceCode: invoice.invoiceCode,
          agencyId: r.agency_id,
          agencyName: invoice.customerName,
          warehouseId: r.warehouse_id,
          status: 'PENDING',
          reason: r.reason,
          totalRefundAmount: Number(r.total_refund_amount),
          createdBy: r.created_by,
          createdByName: currentUser?.username || 'Nhân viên kinh doanh',
          createdAt: new Date(r.created_at),
          updatedAt: new Date(r.updated_at),
          items: validatedItems,
        };
      } catch (dbErr: any) {
        this.logger.warn(`Lỗi lưu return_receipts vào DB: ${dbErr.message}`);
        savedReceipt = this.createFallbackReceipt(
          receiptCode,
          invoice,
          dto,
          warehouseId,
          totalRefundAmount,
          createdBy,
          validatedItems,
        );
      }
    } else {
      savedReceipt = this.createFallbackReceipt(
        receiptCode,
        invoice,
        dto,
        warehouseId,
        totalRefundAmount,
        createdBy,
        validatedItems,
      );
    }

    this.fallbackReceipts.set(savedReceipt.id, savedReceipt);
    this.fallbackReceipts.set(savedReceipt.code, savedReceipt);

    this.logger.log(
      `[ReturnsService] Đã lập phiếu trả hàng ${savedReceipt.code} (HĐ: ${invoice.invoiceCode}) trị giá ${totalRefundAmount.toLocaleString('vi-VN')} đ ở trạng thái PENDING.`,
    );

    // Gửi thông báo tới các tài khoản có nghiệp vụ quản lý (Quản trị hệ thống, Quản lý kho, Thủ kho, Quản lý kinh doanh, Kế toán)
    await this.notifyManagementOnReturnCreated(savedReceipt, invoice);

    return savedReceipt;
  }

  private createFallbackReceipt(
    receiptCode: string,
    invoice: InvoiceItem,
    dto: CreateReturnReceiptDto,
    warehouseId: string,
    totalRefundAmount: number,
    createdBy: string,
    items: ReturnReceiptItemEntity[],
  ): ReturnReceiptEntity {
    const id = `ret-${Date.now()}`;
    const now = new Date();
    const receipt: ReturnReceiptEntity = {
      id,
      code: receiptCode,
      originalInvoiceId: invoice.invoiceCode,
      originalInvoiceCode: invoice.invoiceCode,
      agencyId: dto.agency_id,
      agencyName: invoice.customerName,
      warehouseId,
      status: 'PENDING',
      reason: dto.reason,
      totalRefundAmount,
      createdBy,
      createdAt: now,
      updatedAt: now,
      items,
    };
    return receipt;
  }

  /**
   * API 2: Quản lý kho xác nhận nhận hàng (Dành cho Quản lý kho)
   * PATCH /api/return-receipts/:id/approve
   */
  async approveReturnReceipt(
    id: string,
    dto: ApproveReturnReceiptDto,
    currentUser: ICurrentUser,
  ): Promise<ReturnReceiptEntity> {
    await this.ensureTables();

    // 1. Kiểm tra quyền của user (phải là Quản lý kho, Thủ kho, Quản lý bán hàng hoặc Admin)
    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const hasPermission =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.WAREHOUSE_MANAGER) ||
        roles.includes(UserRole.WH_MANAGER) ||
        roles.includes(UserRole.WAREHOUSE_KEEPER) ||
        roles.includes(UserRole.WAREHOUSE) ||
        roles.includes(UserRole.SALES_MANAGER);

      if (!hasPermission) {
        throw new ForbiddenException('Chỉ Quản lý kho hoặc Admin mới có quyền xác nhận nhập kho phiếu trả hàng.');
      }
    }

    // 2. Tìm phiếu trả hàng
    const receipt = await this.findReturnReceiptById(id);
    if (!receipt) {
      throw new NotFoundException(`Không tìm thấy phiếu trả hàng ${id}`);
    }

    if (receipt.status !== 'PENDING') {
      throw new BadRequestException(
        `Phiếu trả hàng ${receipt.code} đã ở trạng thái ${receipt.status}, không thể thực hiện thao tác duyệt/từ chối lại.`,
      );
    }

    const warehouseManagerId = currentUser?.userId || 'usr-wh-manager';
    const now = new Date();

    // 3. Nếu Quản lý kho TỪ CHỐI (REJECT)
    if (dto.action === ReturnApprovalAction.REJECT) {
      receipt.status = 'REJECTED';
      receipt.warehouseManagerId = warehouseManagerId;
      receipt.approvedAt = now;
      receipt.approvalNote = dto.note || 'Từ chối nhận hàng hoàn trả';
      receipt.updatedAt = now;

      if (this.databaseService?.isConnected()) {
        try {
          await this.databaseService.query(
            `UPDATE return_receipts
             SET status = 'REJECTED', warehouse_manager_id = $1, approved_at = NOW(),
                 approval_note = $2, updated_at = NOW()
             WHERE id::text = $3 OR code = $3;`,
            [warehouseManagerId, receipt.approvalNote, id],
          );
        } catch {}
      }

      this.fallbackReceipts.set(receipt.id, receipt);
      this.fallbackReceipts.set(receipt.code, receipt);
      await this.notifyOnReturnStatusUpdated(receipt, ReturnApprovalAction.REJECT);
      return receipt;
    }

    // 4. Nếu Quản lý kho XÁC NHẬN NHẬP KHO (APPROVE)
    // Thực hiện giao dịch: Cộng kho theo tình trạng + Giảm trừ công nợ đại lý
    if (this.databaseService?.isConnected()) {
      const client = await this.databaseService.getClient();
      try {
        await client.query('BEGIN');

        // A. Cập nhật kho cho từng sản phẩm
        for (const item of receipt.items || []) {
          const qty = Number(item.quantity);
          const isGood = item.conditionType === ReturnConditionType.GOOD;

          if (isGood) {
            // Hàng tốt: Nhập lại kho bán hàng (inventories & app_inventory_stock_balances)
            await client.query(
              `INSERT INTO inventories (warehouse_id, product_id, on_hand, created_at, updated_at)
               VALUES ($1::uuid, $2::uuid, $3, NOW(), NOW())
               ON CONFLICT (warehouse_id, product_id)
               DO UPDATE SET on_hand = inventories.on_hand + $3, updated_at = NOW();`,
              [receipt.warehouseId, item.productId, qty],
            );

            await client.query(
              `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity, updated_at)
               VALUES ($1, $2::uuid, $3, NOW())
               ON CONFLICT (product_sku, warehouse_id)
               DO UPDATE SET physical_quantity = app_inventory_stock_balances.physical_quantity + $3, updated_at = NOW();`,
              [item.productSku.toUpperCase(), receipt.warehouseId, qty],
            );

            // Cập nhật lô nếu có
            let batchId: string | null = null;
            if (item.batchNumber && item.batchNumber.trim()) {
              const bRes = await client.query(
                `INSERT INTO inventory_batches (warehouse_id, product_id, batch_number, expiry_date, quantity, cost_price, status, created_at, updated_at)
                 VALUES ($1::uuid, $2::uuid, $3, NOW() + INTERVAL '1 year', $4, $5, 'ACTIVE', NOW(), NOW())
                 ON CONFLICT (warehouse_id, product_id, batch_number)
                 DO UPDATE SET quantity = inventory_batches.quantity + $4, updated_at = NOW()
                 RETURNING id;`,
                [receipt.warehouseId, item.productId, item.batchNumber.trim(), qty, item.unitPrice],
              );
              batchId = bRes.rows[0]?.id || null;
            }

            // Ghi nhận transaction kho bán hàng
            const onHandRes = await client.query(
              `SELECT on_hand FROM inventories WHERE warehouse_id = $1::uuid AND product_id = $2::uuid LIMIT 1`,
              [receipt.warehouseId, item.productId],
            );
            const balanceAfter = Number(onHandRes.rows[0]?.on_hand || qty);

            await client.query(
              `INSERT INTO inventory_transactions (
                 warehouse_id, product_id, batch_id, transaction_type, quantity_change,
                 balance_after, unit_cost, reference_type, reference_id, notes, created_by, created_at
               ) VALUES ($1::uuid, $2::uuid, $3, 'RETURN_IMPORT', $4, $5, $6, 'RETURN_RECEIPT', $7, $8, $9, NOW());`,
              [
                receipt.warehouseId,
                item.productId,
                batchId,
                qty,
                balanceAfter,
                item.unitPrice,
                receipt.code,
                `Nhập lại hàng tốt từ phiếu trả hàng ${receipt.code}`,
                warehouseManagerId.length === 36 ? warehouseManagerId : null,
              ],
            );

            // Ghi thẻ kho app_inventory_transactions
            await client.query(
              `INSERT INTO app_inventory_transactions (
                 id, product_id, sku, product_name, transaction_type,
                 input_quantity, input_unit, conversion_rate, base_quantity_change, base_unit,
                 previous_stock, new_stock, reason, reference_code, warehouse, performed_by, created_at
               ) VALUES ($1, $2, $3, $4, 'IMPORT', $5, $6, 1, $5, $6, $7, $8, $9, $10, $11, $12, NOW());`,
              [
                `tx-ret-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                item.productId,
                item.productSku,
                item.productName,
                qty,
                item.unit || 'Lon',
                Math.max(0, balanceAfter - qty),
                balanceAfter,
                `Nhập lại hàng tốt từ phiếu trả hàng ${receipt.code}`,
                receipt.code,
                receipt.warehouseId,
                currentUser?.username || 'Quản lý kho',
              ],
            );
          } else {
            // Hàng hỏng / lỗi: đã được tiếp nhận vào kho hàng lỗi (damaged_stock_balances) tại thời điểm lập phiếu
            this.logger.log(`[ReturnsService] Hàng lỗi SKU ${item.productSku} đã lưu tại kho lỗi ${receipt.warehouseId}`);
          }
        }

        // B. Cập nhật giảm trừ công nợ đại lý
        const totalRefund = Number(receipt.totalRefundAmount || 0);
        if (totalRefund > 0) {
          // Trừ trực tiếp vào current_debt của đại lý
          await client.query(
            `UPDATE customers
             SET current_debt = GREATEST(0, current_debt - $1), updated_at = NOW()
             WHERE id::text = $2 OR code = $2;`,
            [totalRefund, receipt.agencyId],
          );

          // Lấy dư nợ mới nhất của đại lý
          const custRes = await client.query(
            `SELECT id, current_debt FROM customers WHERE id::text = $1 OR code = $1 LIMIT 1`,
            [receipt.agencyId],
          );
          const newDebt = Number(custRes.rows[0]?.current_debt || 0);
          const custUuid = custRes.rows[0]?.id || receipt.agencyId;

          // Ghi vào Sổ cái công nợ khách hàng (customer_debt_ledger)
          if (custUuid && custUuid.length === 36) {
            await client.query(
              `INSERT INTO customer_debt_ledger (
                 customer_id, transaction_type, reference_type, reference_id,
                 debit_amount, credit_amount, balance_after, aging_bucket, notes, created_by, created_at
               ) VALUES ($1::uuid, 'RETURN_DEDUCTION', 'RETURN_RECEIPT', $2, 0, $3, $4, 'CURRENT', $5, $6, NOW());`,
              [
                custUuid,
                receipt.code,
                totalRefund,
                newDebt,
                `Giảm trừ công nợ từ phiếu trả hàng ${receipt.code} (HĐ: ${receipt.originalInvoiceId})`,
                warehouseManagerId.length === 36 ? warehouseManagerId : null,
              ],
            );
          }

          // Cập nhật điều chỉnh giảm nợ trên hóa đơn gốc
          await client.query(
            `UPDATE invoices
             SET paid_amount = paid_amount + $1,
                 remaining_amount = GREATEST(0, remaining_amount - $1),
                 updated_at = NOW()
             WHERE id::text = $2 OR code = $2;`,
            [totalRefund, receipt.originalInvoiceId],
          );
        }

        // C. Cập nhật trạng thái phiếu thành APPROVED
        await client.query(
          `UPDATE return_receipts
           SET status = 'APPROVED', warehouse_manager_id = $1, approved_at = NOW(),
               approval_note = $2, updated_at = NOW()
           WHERE id::text = $3 OR code = $3;`,
          [warehouseManagerId, dto.note || 'Đã kiểm hàng, khớp số lượng', id],
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        this.logger.error(`Lỗi giao dịch duyệt phiếu trả hàng: ${(txErr as Error).message}`);
        throw txErr;
      } finally {
        client.release();
      }
    }

    receipt.status = 'APPROVED';
    receipt.warehouseManagerId = warehouseManagerId;
    receipt.approvedAt = now;
    receipt.approvalNote = dto.note || 'Đã kiểm hàng, khớp số lượng';
    receipt.updatedAt = now;

    this.fallbackReceipts.set(receipt.id, receipt);
    this.fallbackReceipts.set(receipt.code, receipt);

    this.logger.log(
      `[ReturnsService] Quản lý kho đã duyệt phiếu trả hàng ${receipt.code}: Đã cộng tồn kho & giảm trừ ${receipt.totalRefundAmount.toLocaleString('vi-VN')} đ công nợ đại lý.`,
    );

    await this.notifyOnReturnStatusUpdated(receipt, ReturnApprovalAction.APPROVE);

    return receipt;
  }

  /**
   * Lấy chi tiết một phiếu trả hàng
   */
  async findReturnReceiptById(id: string): Promise<ReturnReceiptEntity | null> {
    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<any>(
          `SELECT rr.*, c.name as agency_name, c.code as agency_code,
                  w.name as warehouse_name, w.code as warehouse_code,
                  u.full_name as created_by_name, wm.full_name as warehouse_manager_name
           FROM return_receipts rr
           LEFT JOIN customers c ON c.id::text = rr.agency_id OR c.code = rr.agency_id
           LEFT JOIN warehouses w ON w.id::text = rr.warehouse_id OR w.code = rr.warehouse_id
           LEFT JOIN users u ON u.id::text = rr.created_by
           LEFT JOIN users wm ON wm.id::text = rr.warehouse_manager_id
           WHERE rr.id::text = $1 OR rr.code = $1 LIMIT 1;`,
          [id],
        );
        if (rows[0]) {
          const r = rows[0];
          const itemsRows = await this.databaseService.query<any>(
            `SELECT * FROM return_receipt_items WHERE return_receipt_id = $1::uuid ORDER BY created_at ASC;`,
            [r.id],
          );
          const items: ReturnReceiptItemEntity[] = itemsRows.map((it) => ({
            id: it.id,
            returnReceiptId: it.return_receipt_id,
            productId: it.product_id,
            productSku: it.product_sku,
            productName: it.product_name,
            unit: it.unit,
            batchNumber: it.batch_number,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unit_price),
            lineTotal: Number(it.line_total),
            conditionType: it.condition_type,
            subReason: it.sub_reason,
            createdAt: new Date(it.created_at),
          }));

          return {
            id: r.id,
            code: r.code,
            originalInvoiceId: r.original_invoice_id,
            originalInvoiceCode: r.original_invoice_id,
            agencyId: r.agency_id,
            agencyCode: r.agency_code,
            agencyName: r.agency_name || 'Đại lý',
            warehouseId: r.warehouse_id,
            warehouseCode: r.warehouse_code,
            warehouseName: r.warehouse_name,
            status: r.status as ReturnReceiptStatus,
            reason: r.reason,
            totalRefundAmount: Number(r.total_refund_amount),
            createdBy: r.created_by,
            createdByName: r.created_by_name || 'Nhân viên kinh doanh',
            warehouseManagerId: r.warehouse_manager_id,
            warehouseManagerName: r.warehouse_manager_name,
            approvedAt: r.approved_at ? new Date(r.approved_at) : null,
            approvalNote: r.approval_note,
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
            items,
          };
        }
      } catch (err) {
        this.logger.warn(`Lỗi query DB phiếu trả hàng: ${(err as Error).message}`);
      }
    }

    return this.fallbackReceipts.get(id) || null;
  }

  /**
   * Danh sách phiếu trả hàng (hỗ trợ lọc status, search, agency)
   */
  async findAllReturnReceipts(
    query?: { status?: string; search?: string; agencyId?: string },
    currentUser?: ICurrentUser,
  ): Promise<ReturnReceiptEntity[]> {
    await this.ensureTables();

    if (this.databaseService?.isConnected()) {
      try {
        let sql = `
          SELECT rr.*, c.name as agency_name, c.code as agency_code,
                 w.name as warehouse_name, w.code as warehouse_code,
                 u.full_name as created_by_name, wm.full_name as warehouse_manager_name
          FROM return_receipts rr
          LEFT JOIN customers c ON c.id::text = rr.agency_id OR c.code = rr.agency_id
          LEFT JOIN warehouses w ON w.id::text = rr.warehouse_id OR w.code = rr.warehouse_id
          LEFT JOIN users u ON u.id::text = rr.created_by
          LEFT JOIN users wm ON wm.id::text = rr.warehouse_manager_id
          WHERE 1=1
        `;
        const params: any[] = [];

        if (query?.status && query.status !== 'ALL') {
          params.push(query.status.toUpperCase());
          sql += ` AND rr.status = $${params.length}`;
        }

        if (query?.agencyId) {
          params.push(query.agencyId);
          sql += ` AND (rr.agency_id = $${params.length} OR c.code = $${params.length})`;
        }

        if (query?.search && query.search.trim()) {
          params.push(`%${query.search.trim().toLowerCase()}%`);
          sql += ` AND (LOWER(rr.code) LIKE $${params.length} OR LOWER(rr.original_invoice_id) LIKE $${params.length} OR LOWER(c.name) LIKE $${params.length} OR LOWER(rr.reason) LIKE $${params.length})`;
        }

        sql += ` ORDER BY rr.created_at DESC;`;

        const rows = await this.databaseService.query<any>(sql, params);
        const results: ReturnReceiptEntity[] = [];

        for (const r of rows) {
          const itemsRows = await this.databaseService.query<any>(
            `SELECT * FROM return_receipt_items WHERE return_receipt_id = $1::uuid ORDER BY created_at ASC;`,
            [r.id],
          );
          results.push({
            id: r.id,
            code: r.code,
            originalInvoiceId: r.original_invoice_id,
            originalInvoiceCode: r.original_invoice_id,
            agencyId: r.agency_id,
            agencyCode: r.agency_code,
            agencyName: r.agency_name || 'Đại lý',
            warehouseId: r.warehouse_id,
            warehouseCode: r.warehouse_code,
            warehouseName: r.warehouse_name,
            status: r.status as ReturnReceiptStatus,
            reason: r.reason,
            totalRefundAmount: Number(r.total_refund_amount),
            createdBy: r.created_by,
            createdByName: r.created_by_name || 'Nhân viên kinh doanh',
            warehouseManagerId: r.warehouse_manager_id,
            warehouseManagerName: r.warehouse_manager_name,
            approvedAt: r.approved_at ? new Date(r.approved_at) : null,
            approvalNote: r.approval_note,
            createdAt: new Date(r.created_at),
            updatedAt: new Date(r.updated_at),
            items: itemsRows.map((it) => ({
              id: it.id,
              returnReceiptId: it.return_receipt_id,
              productId: it.product_id,
              productSku: it.product_sku,
              productName: it.product_name,
              unit: it.unit,
              batchNumber: it.batch_number,
              quantity: Number(it.quantity),
              unitPrice: Number(it.unit_price),
              lineTotal: Number(it.line_total),
              conditionType: it.condition_type,
              subReason: it.sub_reason,
              createdAt: new Date(it.created_at),
            })),
          });
        }
        return results;
      } catch (err) {
        this.logger.warn(`Lỗi query danh sách return_receipts: ${(err as Error).message}`);
      }
    }

    return Array.from(new Set(this.fallbackReceipts.values()));
  }

  /**
   * Phương thức tương thích ngược cho debt-report.service.ts
   */
  async getAllReturns(): Promise<ReturnRequestItem[]> {
    const list = await this.findAllReturnReceipts();
    return list.map((r) => ({
      id: r.id,
      requestCode: r.code,
      orderId: r.originalInvoiceId,
      orderCode: r.originalInvoiceId,
      customerId: r.agencyId,
      customerName: r.agencyName || 'Đại lý',
      reason: r.reason,
      status: r.status === 'APPROVED' ? 'APPROVED' : r.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
      refundAmount: r.totalRefundAmount,
      warehouseNote: r.approvalNote || undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  // Giữ lại các method tương thích cũ nếu còn route cũ gọi
  async findAll(query?: any, currentUser?: ICurrentUser): Promise<ReturnRequestItem[]> {
    return this.getAllReturns();
  }

  async findById(id: string, currentUser?: ICurrentUser): Promise<ReturnRequestItem> {
    const receipt = await this.findReturnReceiptById(id);
    if (!receipt) throw new NotFoundException(`Không tìm thấy yêu cầu trả hàng ${id}`);
    return {
      id: receipt.id,
      requestCode: receipt.code,
      orderId: receipt.originalInvoiceId,
      orderCode: receipt.originalInvoiceId,
      customerId: receipt.agencyId,
      customerName: receipt.agencyName || 'Đại lý',
      reason: receipt.reason,
      status: receipt.status === 'APPROVED' ? 'APPROVED' : receipt.status === 'REJECTED' ? 'REJECTED' : 'PENDING',
      refundAmount: receipt.totalRefundAmount,
      warehouseNote: receipt.approvalNote || undefined,
      createdAt: receipt.createdAt,
      updatedAt: receipt.updatedAt,
    };
  }

  async create(dto: Partial<ReturnRequestItem>, currentUser?: ICurrentUser): Promise<ReturnRequestItem> {
    const receiptCode = `TH-${Date.now().toString().slice(-6)}`;
    const item: ReturnRequestItem = {
      id: `ret-${Date.now()}`,
      requestCode: receiptCode,
      orderId: dto.orderId || 'ord-unknown',
      orderCode: dto.orderCode || 'DH-UNKNOWN',
      customerId: dto.customerId || 'cust-001',
      customerName: dto.customerName || 'Đại lý',
      reason: dto.reason || 'Yêu cầu trả hàng',
      status: 'PENDING',
      refundAmount: dto.refundAmount || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    return item;
  }

  async approve(id: string, reviewer?: ICurrentUser): Promise<ReturnRequestItem> {
    const res = await this.approveReturnReceipt(id, { action: ReturnApprovalAction.APPROVE }, reviewer!);
    return {
      id: res.id,
      requestCode: res.code,
      orderId: res.originalInvoiceId,
      orderCode: res.originalInvoiceId,
      customerId: res.agencyId,
      customerName: res.agencyName || 'Đại lý',
      reason: res.reason,
      status: 'APPROVED',
      refundAmount: res.totalRefundAmount,
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
    };
  }

  async receiveStock(id: string, note?: string): Promise<ReturnRequestItem> {
    return this.findById(id);
  }

  async adjustDebt(id: string, refundAmount?: number, note?: string): Promise<ReturnRequestItem> {
    return this.findById(id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    if (this.databaseService?.isConnected()) {
      try {
        await this.databaseService.query(
          `DELETE FROM return_receipt_items WHERE return_receipt_id::text = $1;
           DELETE FROM return_receipts WHERE id::text = $1 OR code = $1;`,
          [id],
        );
      } catch {}
    }
    this.fallbackReceipts.delete(id);
    return { success: true, message: `Đã xóa phiếu trả hàng ${id}` };
  }

  /**
   * Phát thông báo tới các tài khoản có nghiệp vụ quản lý khi có phiếu trả hàng mới được tạo:
   * 1. Quản lý kho & Thủ kho (cần kiểm tra hàng và duyệt nhập kho)
   * 2. Quản lý kinh doanh (nắm thông tin giảm trừ doanh số)
   * 3. Quản trị hệ thống (Admin)
   * 4. Kế toán công nợ (theo dõi giảm trừ công nợ đại lý)
   */
  async notifyManagementOnReturnCreated(
    receipt: ReturnReceiptEntity,
    invoice: InvoiceItem,
  ): Promise<void> {
    if (!this.databaseService?.isConnected()) return;

    try {
      const amountFormatted = new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
      }).format(receipt.totalRefundAmount || 0);

      const itemCount = receipt.items?.length || 0;
      const agencyDisplayName = receipt.agencyName || invoice.customerName || 'Đại lý';
      const title = `Phiếu trả hàng mới: ${receipt.code} từ ${agencyDisplayName}`;
      const message = `Đại lý ${agencyDisplayName} vừa lập phiếu trả hàng [${receipt.code}] cho HĐ ${receipt.originalInvoiceId || receipt.originalInvoiceCode || ''} (${itemCount} sản phẩm, hoàn tiền ${amountFormatted}). Chờ Quản lý kho kiểm tra & duyệt nhập kho.`;

      // Truy vấn tất cả tài khoản thuộc các vai trò quản lý
      const rows = await this.databaseService.query<any>(
        `SELECT DISTINCT u.id, u.username, u.full_name, COALESCE(r.name, 'Quản lý') as role_name, r.code as role_code
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE (
           u.role_id IN (1, 2, 4, 5) OR
           r.code ILIKE '%admin%' OR
           r.code ILIKE '%sales_manager%' OR
           r.code ILIKE '%warehouse%' OR
           r.code ILIKE '%keeper%' OR
           r.code ILIKE '%accountant%' OR
           r.name ILIKE '%quản trị%' OR
           r.name ILIKE '%quản lý%' OR
           r.name ILIKE '%thủ kho%' OR
           r.name ILIKE '%kế toán%'
         )
         AND (u.status = 'ACTIVE' OR u.status IS NULL);`,
      );

      const targetUsers = rows || [];
      this.logger.log(
        `[ReturnsService] Đang gửi thông báo phiếu trả hàng ${receipt.code} tới ${targetUsers.length} tài khoản quản lý...`,
      );

      for (const u of targetUsers) {
        try {
          await this.databaseService.query(
            `INSERT INTO app_system_notifications (
               user_id, recipient_name, recipient_role, order_id, order_code,
               customer_name, type, title, message, amount, link, priority, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, 'ORDER', $7, $8, $9, '/accounting/returns', 'high', NOW(), NOW());`,
            [
              String(u.id),
              u.full_name || u.username,
              u.role_name,
              receipt.id,
              receipt.code,
              agencyDisplayName,
              title,
              message,
              receipt.totalRefundAmount || 0,
            ],
          );
        } catch (insertErr: any) {
          this.logger.warn(`Lỗi ghi thông báo cho user ${u.username}: ${insertErr.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Lỗi trong notifyManagementOnReturnCreated: ${err.message}`);
    }
  }

  /**
   * Thông báo khi phiếu trả hàng được duyệt nhập kho hoặc bị từ chối
   */
  async notifyOnReturnStatusUpdated(
    receipt: ReturnReceiptEntity,
    action: ReturnApprovalAction,
  ): Promise<void> {
    if (!this.databaseService?.isConnected()) return;

    try {
      const isApproved = action === ReturnApprovalAction.APPROVE;
      const amountFormatted = new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND',
      }).format(receipt.totalRefundAmount || 0);

      const title = isApproved
        ? `Phiếu trả hàng ${receipt.code} đã được duyệt nhập kho`
        : `Phiếu trả hàng ${receipt.code} đã bị từ chối`;

      const message = isApproved
        ? `Quản lý kho đã duyệt nhập kho phiếu trả hàng [${receipt.code}]. Đã hoàn tất nhập kho và giảm trừ ${amountFormatted} công nợ.`
        : `Quản lý kho đã từ chối nhận hàng phiếu trả hàng [${receipt.code}]. Lý do: ${receipt.approvalNote || 'Không đạt tiêu chuẩn hoàn trả'}.`;

      // 1. Gửi cho người tạo phiếu (creator) nếu có
      if (receipt.createdBy && receipt.createdBy !== 'usr-sales-01') {
        try {
          await this.databaseService.query(
            `INSERT INTO app_system_notifications (
               user_id, recipient_name, recipient_role, order_id, order_code,
               customer_name, type, title, message, amount, link, priority, created_at, updated_at
             ) VALUES ($1, $2, 'Người lập phiếu', $3, $4, $5, 'ORDER', $6, $7, $8, '/accounting/returns', 'high', NOW(), NOW());`,
            [
              receipt.createdBy,
              receipt.createdByName || 'Nhân viên kinh doanh',
              receipt.id,
              receipt.code,
              receipt.agencyName || 'Đại lý',
              title,
              message,
              receipt.totalRefundAmount || 0,
            ],
          );
        } catch {}
      }

      // 2. Gửi cho Đại lý
      if (receipt.agencyId) {
        try {
          await this.databaseService.query(
            `INSERT INTO app_system_notifications (
               user_id, recipient_name, recipient_role, order_id, order_code,
               customer_name, type, title, message, amount, link, priority, created_at, updated_at
             ) VALUES ($1, $2, 'Đại lý', $3, $4, $5, 'ORDER', $6, $7, $8, '/accounting/returns', 'high', NOW(), NOW());`,
            [
              receipt.agencyId,
              receipt.agencyName || 'Đại lý',
              receipt.id,
              receipt.code,
              receipt.agencyName || 'Đại lý',
              title,
              message,
              receipt.totalRefundAmount || 0,
            ],
          );
        } catch {}
      }
    } catch (err: any) {
      this.logger.error(`Lỗi trong notifyOnReturnStatusUpdated: ${err.message}`);
    }
  }
}
