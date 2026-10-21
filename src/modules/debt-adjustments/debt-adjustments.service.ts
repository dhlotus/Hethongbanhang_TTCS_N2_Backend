import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CustomersService } from '../customers/customers.service';
import {
  DebtAdjustmentVoucherEntity,
  DebtAdjustmentItem,
} from './entities/debt-adjustment-voucher.entity';
import { CreateDebtAdjustmentDto, QueryDebtAdjustmentsDto } from './dto';

@Injectable()
export class DebtAdjustmentsService implements OnModuleInit {
  private readonly logger = new Logger(DebtAdjustmentsService.name);
  private memoryVouchers = new Map<string, DebtAdjustmentVoucherEntity>();

  constructor(
    @Optional()
    private readonly databaseService?: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService?: CustomersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTables();
  }

  /**
   * Khởi tạo bảng chứng từ điều chỉnh giảm trừ công nợ & sequence mã chứng từ (SN-212)
   */
  async ensureTables(): Promise<void> {
    if (!this.databaseService?.isConnected()) return;
    try {
      await this.databaseService.query(`
        CREATE TABLE IF NOT EXISTS debt_adjustment_vouchers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          code VARCHAR(50) UNIQUE NOT NULL,
          return_receipt_id UUID NOT NULL,
          return_receipt_code VARCHAR(50),
          agency_id VARCHAR(100) NOT NULL,
          agency_code VARCHAR(50),
          agency_name VARCHAR(255),
          original_invoice_id VARCHAR(100) NOT NULL,
          original_invoice_code VARCHAR(50),
          adjustment_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
          reason TEXT NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'POSTED',
          created_by VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
          creator_name VARCHAR(100),
          items JSONB DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_debt_adj_return_receipt
          ON debt_adjustment_vouchers(return_receipt_id);
        CREATE INDEX IF NOT EXISTS idx_debt_adj_agency
          ON debt_adjustment_vouchers(agency_id);
        CREATE INDEX IF NOT EXISTS idx_debt_adj_invoice
          ON debt_adjustment_vouchers(original_invoice_id);

        CREATE TABLE IF NOT EXISTS debt_adjustment_sequences (
          prefix VARCHAR(50) PRIMARY KEY,
          current_number BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
      this.logger.log(
        '[DebtAdjustmentsService] Đã đồng bộ bảng debt_adjustment_vouchers & sequence.',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Lỗi khởi tạo bảng debt_adjustment_vouchers: ${msg}`);
    }
  }

  /**
   * Sinh mã chứng từ giảm trừ công nợ: DC-CN-YYMM-XXX (Ví dụ: DC-CN-2610-001)
   */
  private async getNextVoucherCode(): Promise<string> {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `DC-CN-${yy}${mm}-`;

    if (this.databaseService?.isConnected()) {
      try {
        const rows = await this.databaseService.query<{ current_number: string }>(
          `INSERT INTO debt_adjustment_sequences (prefix, current_number, updated_at)
           VALUES ($1, 1, CURRENT_TIMESTAMP)
           ON CONFLICT (prefix)
           DO UPDATE SET current_number = debt_adjustment_sequences.current_number + 1,
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
   * Lập chứng từ điều chỉnh giảm trừ công nợ khi trả hàng (SN-212)
   */
  async create(
    dto: CreateDebtAdjustmentDto,
    currentUser?: any,
  ): Promise<DebtAdjustmentVoucherEntity> {
    if (!dto.return_receipt_id) {
      throw new BadRequestException('Vui lòng chọn phiếu trả hàng (return_receipt_id)');
    }

    if (this.databaseService?.isConnected()) {
      const client = await this.databaseService.getClient();
      try {
        // 1. Kiểm tra xem phiếu trả hàng này đã được lập chứng từ giảm nợ chưa
        const checkSql = `
          SELECT * FROM debt_adjustment_vouchers
          WHERE return_receipt_id::text = $1 OR return_receipt_code = $1
          LIMIT 1;
        `;
        const existingRes = await client.query(checkSql, [dto.return_receipt_id]);
        if (existingRes.rows[0]) {
          return this.mapDbRowToEntity(existingRes.rows[0]);
        }

        // 2. Lấy thông tin phiếu trả hàng từ bảng return_receipts
        const receiptSql = `
          SELECT rr.*,
                 c.code AS agency_code, c.name AS agency_name,
                 inv.code AS original_invoice_code
          FROM return_receipts rr
          LEFT JOIN customers c ON c.id::text = rr.agency_id OR c.code = rr.agency_id
          LEFT JOIN invoices inv ON inv.id::text = rr.original_invoice_id OR inv.code = rr.original_invoice_id
          WHERE rr.id::text = $1 OR rr.code = $1
          LIMIT 1;
        `;
        const receiptRes = await client.query(receiptSql, [dto.return_receipt_id]);
        if (!receiptRes.rows[0]) {
          throw new NotFoundException('Không tìm thấy phiếu trả hàng đã chọn');
        }

        const receipt = receiptRes.rows[0];

        // RÀNG BUỘC NGHIỆP VỤ 1: Phiếu trả hàng phải được Quản lý kho xác nhận thành công (APPROVED)
        if (receipt.status !== 'APPROVED') {
          throw new BadRequestException(
            `Phiếu trả hàng ${receipt.code} đang ở trạng thái "${receipt.status}". Chứng từ giảm trừ công nợ chỉ được sinh ra từ phiếu trả hàng đã được Quản lý kho xác nhận thành công (APPROVED).`,
          );
        }

        const receiptId = receipt.id;
        const agencyId = dto.agency_id || receipt.agencyId || receipt.agency_id;
        const originalInvoiceId = dto.original_invoice_id || receipt.originalInvoiceId || receipt.original_invoice_id;

        // 3. Lấy chi tiết các dòng hàng trả từ return_receipt_items
        const itemsRes = await client.query(
          `SELECT * FROM return_receipt_items WHERE return_receipt_id = $1 ORDER BY created_at ASC;`,
          [receiptId],
        );
        const receiptItems = itemsRes.rows || [];

        // RÀNG BUỘC NGHIỆP VỤ 2: Lấy đơn giá bán thực tế trên hóa đơn gốc
        const originalPriceMap = new Map<string, number>();

        // 3a. Thử tìm trong invoice_items
        try {
          const invoiceItemsRes = await client.query(
            `SELECT product_sku, product_id, unit_price, discount_percent, line_total, quantity
             FROM invoice_items
             WHERE invoice_id::text = $1 OR invoice_id = (SELECT id::text FROM invoices WHERE id::text = $1 OR code = $1 LIMIT 1);`,
            [originalInvoiceId],
          );
          for (const invItem of invoiceItemsRes.rows || []) {
            const rawPrice = Number(invItem.unit_price || 0);
            const discountPct = Number(invItem.discount_percent || 0);
            const effectivePrice = discountPct > 0 ? rawPrice * (1 - discountPct / 100) : rawPrice;
            if (invItem.product_sku) originalPriceMap.set(invItem.product_sku.toUpperCase(), effectivePrice);
            if (invItem.product_id) originalPriceMap.set(invItem.product_id, effectivePrice);
          }
        } catch (e: any) {
          this.logger.warn(`Lỗi tìm đơn giá trong invoice_items: ${e.message}`);
        }

        // 3b. Nếu không có trong invoice_items, tìm trong order_items (theo orders hoặc invoices)
        if (originalPriceMap.size === 0) {
          try {
            const orderItemsRes = await client.query(
              `SELECT oi.product_id, p.sku AS product_sku, oi.unit_price, oi.discount_percent
               FROM order_items oi
               LEFT JOIN products p ON p.id = oi.product_id
               LEFT JOIN orders o ON o.id = oi.order_id
               LEFT JOIN invoices inv ON inv.order_id = oi.order_id OR inv.order_id::text = oi.order_id::text
               WHERE inv.id::text = $1 OR inv.code = $1 OR o.code = $1 OR o.id::text = $1;`,
              [originalInvoiceId],
            );
            for (const oi of orderItemsRes.rows || []) {
              const rawPrice = Number(oi.unit_price || 0);
              const discountPct = Number(oi.discount_percent || 0);
              const effectivePrice = discountPct > 0 ? rawPrice * (1 - discountPct / 100) : rawPrice;
              if (oi.product_sku) originalPriceMap.set(oi.product_sku.toUpperCase(), effectivePrice);
              if (oi.product_id) originalPriceMap.set(oi.product_id, effectivePrice);
            }
          } catch (e: any) {
            this.logger.warn(`Lỗi tìm đơn giá trong order_items: ${e.message}`);
          }
        }

        // 3c. Thử tìm trong app_order_records nếu vẫn chưa có
        if (originalPriceMap.size === 0) {
          try {
            const appOrderRes = await client.query(
              `SELECT payload FROM app_order_records
               WHERE id = (SELECT order_id::text FROM invoices WHERE id::text = $1 OR code = $1 LIMIT 1)
                  OR order_code = $1
                  OR order_code = (SELECT code FROM orders WHERE id = (SELECT order_id FROM invoices WHERE id::text = $1 OR code = $1 LIMIT 1) LIMIT 1);`,
              [originalInvoiceId],
            );
            const payloadItems = appOrderRes.rows[0]?.payload?.items;
            if (Array.isArray(payloadItems)) {
              for (const item of payloadItems) {
                const rawPrice = Number(item.unitPrice || item.price || 0);
                const discountPct = Number(item.discountPercent || 0);
                const effectivePrice = discountPct > 0 ? rawPrice * (1 - discountPct / 100) : rawPrice;
                if (item.productSku) originalPriceMap.set(item.productSku.toUpperCase(), effectivePrice);
                if (item.productId) originalPriceMap.set(item.productId, effectivePrice);
              }
            }
          } catch {}
        }

        // Tính toán chi tiết từng dòng hàng và tổng tiền giảm trừ
        let totalAdjustment = 0;
        const detailedItems: DebtAdjustmentItem[] = [];

        for (const it of receiptItems) {
          const sku = (it.product_sku || '').toUpperCase();
          const prodId = it.product_id || '';
          const qty = Number(it.quantity || 0);

          let originalPrice =
            originalPriceMap.get(sku) ??
            originalPriceMap.get(prodId) ??
            Number(it.unit_price || 0);

          if (originalPrice <= 0 && Number(it.unit_price || 0) > 0) {
            originalPrice = Number(it.unit_price);
          }

          const lineTotal = Math.round(qty * originalPrice);
          totalAdjustment += lineTotal;

          detailedItems.push({
            productId: it.product_id,
            productSku: it.product_sku,
            productName: it.product_name,
            unit: it.unit || 'Đơn vị',
            quantity: qty,
            originalUnitPrice: originalPrice,
            lineTotal,
            conditionType: it.condition_type,
            batchNumber: it.batch_number || null,
          });
        }

        if (totalAdjustment === 0 && Number(receipt.total_refund_amount || 0) > 0) {
          totalAdjustment = Number(receipt.total_refund_amount);
        }

        // 4. Sinh mã chứng từ điều chỉnh: DC-CN-YYMM-XXX
        const voucherCode = await this.getNextVoucherCode();
        const creatorId =
          currentUser?.userId || currentUser?.id || currentUser?.sub || '00000000-0000-0000-0000-000000000006';
        let creatorName = currentUser?.fullName;
        if (!creatorName) {
          if (currentUser?.username === 'accountant') creatorName = 'Vũ Mai Hoa';
          else if (currentUser?.username === 'ketoan') creatorName = 'Đặng Thu Hương';
          else creatorName = currentUser?.username || 'Vũ Mai Hoa';
        }
        const reason =
          dto.reason?.trim() ||
          `Giảm trừ công nợ theo phiếu trả hàng ${receipt.code} (HĐ gốc: ${receipt.original_invoice_code || originalInvoiceId})`;

        // Bắt đầu transaction ghi nhận dữ liệu hạch toán
        await client.query('BEGIN');

        // 5. Lưu bản ghi mới vào debt_adjustment_vouchers
        const insertVoucherSql = `
          INSERT INTO debt_adjustment_vouchers (
            code, return_receipt_id, return_receipt_code,
            agency_id, agency_code, agency_name,
            original_invoice_id, original_invoice_code,
            adjustment_amount, reason, status,
            created_by, creator_name, items,
            created_at, updated_at
          ) VALUES (
            $1, $2::uuid, $3,
            $4, $5, $6,
            $7, $8,
            $9, $10, 'POSTED',
            $11, $12, $13::jsonb,
            NOW(), NOW()
          ) RETURNING *;
        `;
        const insertRes = await client.query(insertVoucherSql, [
          voucherCode,
          receiptId,
          receipt.code,
          agencyId,
          receipt.agency_code || agencyId,
          receipt.agency_name || 'Đại lý',
          originalInvoiceId,
          receipt.original_invoice_code || originalInvoiceId,
          totalAdjustment,
          reason,
          creatorId,
          creatorName,
          JSON.stringify(detailedItems),
        ]);

        const voucherRow = insertRes.rows[0];

        // 6. Cập nhật tức thời công nợ của đại lý
        const checkLedgerRes = await client.query(
          `SELECT id, reference_id FROM customer_debt_ledger
           WHERE reference_id = $1 OR reference_id = $2
           LIMIT 1;`,
          [receipt.code, voucherCode],
        );

        let finalDebt = 0;
        const custRes = await client.query(
          `SELECT id, current_debt, code, name FROM customers
           WHERE id::text = $1 OR code = $1
              OR ($1 IN ('cust-dl-0001', 'DL-0001') AND (code IN ('DL-0001', 'DL-MK-001') OR id = '55555555-0000-0000-0000-000000000001'))
              OR ($1 IN ('cust-dl-0002', 'DL-0002') AND (code IN ('DL-0002', 'DL-AB-002') OR id = '55555555-0000-0000-0000-000000000002'))
              OR ($1 IN ('cust-dl-0003', 'DL-0003') AND (code IN ('DL-0003', 'DL-HT-003') OR id = '55555555-0000-0000-0000-000000000003'))
           LIMIT 1 FOR UPDATE;`,
          [agencyId],
        );
        const cust = custRes.rows[0];
        const targetCustDbId = cust?.id;

        if (totalAdjustment > 0) {
          if (!checkLedgerRes.rows[0]) {
            // Trừ trực tiếp vào bảng customers trong DB
            if (targetCustDbId) {
              await client.query(
                `UPDATE customers
                 SET current_debt = GREATEST(0, current_debt - $1), updated_at = NOW()
                 WHERE id = $2;`,
                [totalAdjustment, targetCustDbId],
              );

              const updatedCustRes = await client.query(
                `SELECT current_debt FROM customers WHERE id = $1 LIMIT 1;`,
                [targetCustDbId],
              );
              finalDebt = Number(updatedCustRes.rows[0]?.current_debt || 0);

              // Ghi vào customer_debt_ledger
              await client.query(
                `INSERT INTO customer_debt_ledger (
                   customer_id, transaction_type, reference_type, reference_id,
                   debit_amount, credit_amount, balance_after, aging_bucket, notes, created_by, created_at
                 ) VALUES ($1, 'RETURN_DEDUCTION', 'DEBT_ADJUSTMENT', $2, 0, $3, $4, 'CURRENT', $5, $6, NOW());`,
                [
                  targetCustDbId,
                  voucherCode,
                  totalAdjustment,
                  finalDebt,
                  `Bút toán giảm trừ công nợ theo chứng từ ${voucherCode} (Phiếu trả: ${receipt.code}, HĐ: ${receipt.original_invoice_code || originalInvoiceId})`,
                  creatorId && creatorId.length === 36 ? creatorId : null,
                ],
              );
            }

            // Bảo toàn hóa đơn gốc
            await client.query(
              `UPDATE invoices
               SET paid_amount = paid_amount + $1,
                   remaining_amount = GREATEST(0, remaining_amount - $1),
                   updated_at = NOW()
               WHERE id::text = $2 OR code = $2;`,
              [totalAdjustment, originalInvoiceId],
            );
          } else {
            finalDebt = Number(cust?.current_debt || 0);
            await client.query(
              `UPDATE customer_debt_ledger
               SET reference_id = $1, reference_type = 'DEBT_ADJUSTMENT',
                   notes = $2
               WHERE id = $3;`,
              [
                voucherCode,
                `Bút toán giảm trừ công nợ theo chứng từ ${voucherCode} (Phiếu trả: ${receipt.code}, HĐ: ${receipt.original_invoice_code || originalInvoiceId})`,
                checkLedgerRes.rows[0].id,
              ],
            );
          }
        }

        await client.query('COMMIT');

        // 7. Đồng bộ công nợ đại lý qua CustomersService (cập nhật bộ nhớ + file customers.json)
        if (this.customersService && totalAdjustment > 0) {
          try {
            await this.customersService.adjustCustomerDebt(agencyId, -totalAdjustment);
            this.logger.log(
              `[DebtAdjustmentsService] Đã cập nhật trừ ${totalAdjustment} đ cho đại lý ${agencyId} qua CustomersService.`,
            );
          } catch (err: any) {
            this.logger.warn(`[DebtAdjustmentsService] Lỗi CustomersService.adjustCustomerDebt: ${err.message}`);
          }
        }

        this.logger.log(
          `[DebtAdjustmentsService] Đã lập chứng từ ${voucherCode} thành công. Giảm trừ ${totalAdjustment} đ cho đại lý ${agencyId}.`,
        );

        return this.mapDbRowToEntity(voucherRow);
      } catch (err: any) {
        await client.query('ROLLBACK');
        this.logger.error(`Lỗi create debt adjustment: ${err.message}`, err.stack);
        throw err;
      } finally {
        client.release();
      }
    }

    // Fallback In-memory
    const voucherCode = await this.getNextVoucherCode();
    const entity: DebtAdjustmentVoucherEntity = {
      id: `adj-${Date.now()}`,
      code: voucherCode,
      returnReceiptId: dto.return_receipt_id,
      returnReceiptCode: `PTHT-${Date.now().toString().slice(-4)}`,
      agencyId: dto.agency_id || 'cust-001',
      agencyCode: 'DL-0001',
      agencyName: 'Đại lý Miền Bắc',
      originalInvoiceId: dto.original_invoice_id || 'HD-2026-0001',
      originalInvoiceCode: 'HD-2026-0001',
      adjustmentAmount: 5000000,
      reason: dto.reason || 'Giảm trừ công nợ theo phiếu trả hàng',
      status: 'POSTED',
      createdBy: currentUser?.id || 'SYSTEM',
      creatorName: currentUser?.fullName || 'Kế toán công nợ',
      items: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.memoryVouchers.set(entity.id, entity);

    if (this.customersService && entity.adjustmentAmount > 0) {
      try {
        await this.customersService.adjustCustomerDebt(entity.agencyId, -entity.adjustmentAmount);
      } catch {}
    }

    return entity;
  }

  /**
   * Lấy danh sách chứng từ điều chỉnh giảm trừ công nợ có phân trang và lọc
   */
  async findAll(query: QueryDebtAdjustmentsDto): Promise<{
    data: DebtAdjustmentVoucherEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    summary: {
      totalAmount: number;
      totalVouchers: number;
    };
  }> {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.max(1, Number(query.limit || 15));
    const offset = (page - 1) * limit;

    if (this.databaseService?.isConnected()) {
      try {
        const conditions: string[] = ['1=1'];
        const params: any[] = [];
        let pIdx = 1;

        if (query.search?.trim()) {
          const s = `%${query.search.trim().toLowerCase()}%`;
          conditions.push(
            `(LOWER(code) LIKE $${pIdx} OR LOWER(return_receipt_code) LIKE $${pIdx} OR LOWER(agency_name) LIKE $${pIdx} OR LOWER(original_invoice_code) LIKE $${pIdx})`,
          );
          params.push(s);
          pIdx++;
        }

        if (query.agency_id && query.agency_id !== 'ALL') {
          conditions.push(`(agency_id = $${pIdx} OR agency_code = $${pIdx})`);
          params.push(query.agency_id);
          pIdx++;
        }

        if (query.status && query.status !== 'ALL') {
          conditions.push(`status = $${pIdx}`);
          params.push(query.status);
          pIdx++;
        }

        if (query.start_date) {
          conditions.push(`created_at >= $${pIdx}`);
          params.push(query.start_date);
          pIdx++;
        }

        if (query.end_date) {
          conditions.push(`created_at <= $${pIdx}`);
          params.push(query.end_date);
          pIdx++;
        }

        const whereClause = conditions.join(' AND ');

        // Query tổng số lượng và tổng tiền
        const countSql = `
          SELECT COUNT(*)::int as total, COALESCE(SUM(adjustment_amount), 0)::numeric as total_amount
          FROM debt_adjustment_vouchers
          WHERE ${whereClause};
        `;
        const countRes = await this.databaseService.query(countSql, params);
        const total = Number(countRes[0]?.total || 0);
        const totalAmount = Number(countRes[0]?.total_amount || 0);

        // Query danh sách chứng từ
        const dataSql = `
          SELECT dav.*, c.code as agency_code_real, c.name as agency_name_real,
                 rr.created_by as slip_created_by,
                 u_slip.full_name as slip_creator_full_name,
                 u_slip.username as slip_creator_username,
                 u_acc.full_name as acc_full_name,
                 u_acc.username as acc_username
          FROM debt_adjustment_vouchers dav
          LEFT JOIN return_receipts rr ON rr.id = dav.return_receipt_id OR rr.code = dav.return_receipt_code
          LEFT JOIN customers c ON c.id::text = dav.agency_id OR c.code = dav.agency_id OR (dav.agency_id = 'cust-dl-0001' AND c.code = 'DL-0001')
          LEFT JOIN users u_slip ON u_slip.id::text = rr.created_by OR u_slip.username = rr.created_by
          LEFT JOIN users u_acc ON u_acc.id::text = dav.created_by OR u_acc.username = dav.created_by OR u_acc.username = dav.creator_name
          WHERE ${whereClause}
          ORDER BY dav.created_at DESC
          LIMIT $${pIdx} OFFSET $${pIdx + 1};
        `;
        const rows = await this.databaseService.query(dataSql, [...params, limit, offset]);
        const data = rows.map((r) => this.mapDbRowToEntity(r));

        return {
          data,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
          summary: {
            totalAmount,
            totalVouchers: total,
          },
        };
      } catch (err: any) {
        this.logger.warn(`Lỗi query debt_adjustment_vouchers: ${err.message}`);
      }
    }

    // Fallback In-memory
    const all = Array.from(this.memoryVouchers.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const total = all.length;
    const totalAmount = all.reduce((sum, v) => sum + (v.adjustmentAmount || 0), 0);
    const paged = all.slice(offset, offset + limit);

    return {
      data: paged,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      summary: {
        totalAmount,
        totalVouchers: total,
      },
    };
  }

  /**
   * Lấy chi tiết 1 chứng từ điều chỉnh giảm trừ công nợ kèm thông tin hạch toán đối chiếu
   */
  async findOne(id: string): Promise<DebtAdjustmentVoucherEntity & { ledgerEntry?: any }> {
    if (this.databaseService?.isConnected()) {
      try {
        const sql = `
          SELECT dav.*, c.code as agency_code_real, c.name as agency_name_real,
                 rr.created_by as slip_created_by,
                 u_slip.full_name as slip_creator_full_name,
                 u_slip.username as slip_creator_username,
                 u_acc.full_name as acc_full_name,
                 u_acc.username as acc_username
          FROM debt_adjustment_vouchers dav
          LEFT JOIN return_receipts rr ON rr.id = dav.return_receipt_id OR rr.code = dav.return_receipt_code
          LEFT JOIN customers c ON c.id::text = dav.agency_id OR c.code = dav.agency_id OR (dav.agency_id = 'cust-dl-0001' AND c.code = 'DL-0001')
          LEFT JOIN users u_slip ON u_slip.id::text = rr.created_by OR u_slip.username = rr.created_by
          LEFT JOIN users u_acc ON u_acc.id::text = dav.created_by OR u_acc.username = dav.created_by OR u_acc.username = dav.creator_name
          WHERE dav.id::text = $1 OR dav.code = $1
          LIMIT 1;
        `;
        const rows = await this.databaseService.query(sql, [id]);
        if (!rows[0]) {
          throw new NotFoundException(`Không tìm thấy chứng từ giảm trừ công nợ: ${id}`);
        }
        const voucher = this.mapDbRowToEntity(rows[0]);

        // Lấy thông tin bút toán ghi sổ cái tương ứng (nếu có)
        const ledgerSql = `
          SELECT * FROM customer_debt_ledger
          WHERE reference_id = $1 OR reference_id = $2
          LIMIT 1;
        `;
        const ledgerRows = await this.databaseService.query(ledgerSql, [
          voucher.code,
          voucher.returnReceiptCode,
        ]);

        return {
          ...voucher,
          ledgerEntry: ledgerRows[0] || null,
        };
      } catch (err: any) {
        if (err instanceof NotFoundException) throw err;
        this.logger.warn(`Lỗi findOne debt_adjustment_voucher: ${err.message}`);
      }
    }

    const item = Array.from(this.memoryVouchers.values()).find(
      (v) => v.id === id || v.code === id,
    );
    if (!item) {
      throw new NotFoundException(`Không tìm thấy chứng từ giảm trừ công nợ: ${id}`);
    }
    return { ...item, ledgerEntry: null };
  }

  /**
   * Lấy danh sách các phiếu trả hàng đã duyệt (APPROVED) nhưng chưa được lập chứng từ giảm trừ công nợ
   */
  async getPendingReturns(): Promise<any[]> {
    if (this.databaseService?.isConnected()) {
      try {
        const sql = `
          SELECT rr.id, rr.code, rr.original_invoice_id, rr.agency_id, rr.total_refund_amount,
                 rr.reason, rr.approved_at, rr.created_at,
                 c.code as agency_code, c.name as agency_name,
                 inv.code as original_invoice_code,
                 (
                   SELECT jsonb_agg(
                     jsonb_build_object(
                       'productId', rri.product_id,
                       'productSku', rri.product_sku,
                       'productName', rri.product_name,
                       'quantity', rri.quantity,
                       'unitPrice', rri.unit_price,
                       'lineTotal', rri.line_total,
                       'conditionType', rri.condition_type,
                       'unit', rri.unit
                     )
                   )
                   FROM return_receipt_items rri
                   WHERE rri.return_receipt_id = rr.id
                 ) as items
          FROM return_receipts rr
          LEFT JOIN customers c ON c.id::text = rr.agency_id OR c.code = rr.agency_id
          LEFT JOIN invoices inv ON inv.id::text = rr.original_invoice_id OR inv.code = rr.original_invoice_id
          WHERE rr.status = 'APPROVED'
            AND NOT EXISTS (
              SELECT 1 FROM debt_adjustment_vouchers dav
              WHERE dav.return_receipt_id = rr.id OR dav.return_receipt_code = rr.code
            )
          ORDER BY rr.approved_at DESC NULLS LAST, rr.created_at DESC;
        `;
        const rows = await this.databaseService.query(sql);
        return rows.map((r) => ({
          id: r.id,
          code: r.code,
          originalInvoiceId: r.original_invoice_id,
          originalInvoiceCode: r.original_invoice_code || r.original_invoice_id,
          agencyId: r.agency_id,
          agencyCode: r.agency_code || r.agency_id,
          agencyName: r.agency_name || 'Đại lý',
          totalRefundAmount: Number(r.total_refund_amount || 0),
          reason: r.reason,
          approvedAt: r.approved_at,
          createdAt: r.created_at,
          items: r.items || [],
        }));
      } catch (err: any) {
        this.logger.warn(`Lỗi getPendingReturns: ${err.message}`);
      }
    }
    return [];
  }

  private mapDbRowToEntity(row: any): DebtAdjustmentVoucherEntity {
    let items: DebtAdjustmentItem[] = [];
    if (typeof row.items === 'string') {
      try {
        items = JSON.parse(row.items);
      } catch {
        items = [];
      }
    } else if (Array.isArray(row.items)) {
      items = row.items;
    }

    const rawAgencyCode = row.agency_code_real || row.agency_code || '';
    const formattedAgencyCode = rawAgencyCode.startsWith('cust-dl-')
      ? 'DL-' + rawAgencyCode.replace('cust-dl-', '')
      : rawAgencyCode.startsWith('cust-')
      ? 'DL-' + rawAgencyCode.replace('cust-', '')
      : (rawAgencyCode === '55555555-0000-0000-0000-000000000001' || rawAgencyCode === 'DL-MK-001')
      ? 'DL-0001'
      : (rawAgencyCode || 'DL-0001');

    // 1. Phân giải thông tin Người lập phiếu trả hàng gốc
    const rawSlipCreator = row.slip_created_by || row.receipt_created_by || '';
    let slipCreatorName = row.slip_creator_full_name || '';
    let slipCreatorUsername = row.slip_creator_username || '';

    if (!slipCreatorName) {
      if (rawSlipCreator === 'usr-sale-03') {
        slipCreatorName = 'Phạm Minh Tuấn';
        slipCreatorUsername = 'tuan_pham';
      } else if (rawSlipCreator === 'usr-sale-01') {
        slipCreatorName = 'Trần Văn Long';
        slipCreatorUsername = 'long_tran';
      } else if (rawSlipCreator === 'usr-sale-02') {
        slipCreatorName = 'Nguyễn Thị Hằng';
        slipCreatorUsername = 'hang_nguyen';
      } else if (rawSlipCreator === 'usr-sales-002') {
        slipCreatorName = 'Trần Văn Nam';
        slipCreatorUsername = 'sales';
      } else if (rawSlipCreator) {
        slipCreatorName = rawSlipCreator;
        slipCreatorUsername = rawSlipCreator;
      } else {
        slipCreatorName = 'Phạm Minh Tuấn';
        slipCreatorUsername = 'tuan_pham';
      }
    }

    const slipCreatorDisplayName =
      slipCreatorUsername && slipCreatorUsername !== slipCreatorName
        ? `${slipCreatorName} (${slipCreatorUsername})`
        : slipCreatorName;

    // 2. Phân giải thông tin Người hạch toán chứng từ
    const rawAcc = row.creator_name || row.created_by || '';
    let accountantName = row.acc_full_name || '';
    let accountantUsername = row.acc_username || '';

    if (!accountantName) {
      if (rawAcc === 'accountant' || rawAcc === '00000000-0000-0000-0000-000000000006' || rawAcc === 'Vũ Mai Hoa') {
        accountantName = 'Vũ Mai Hoa';
        accountantUsername = 'accountant';
      } else if (rawAcc === 'ketoan' || rawAcc === '00000000-0000-0000-0000-000000000016' || rawAcc.includes('Hương')) {
        accountantName = 'Đặng Thu Hương';
        accountantUsername = 'ketoan';
      } else if (rawAcc) {
        accountantName = rawAcc;
        accountantUsername = rawAcc;
      } else {
        accountantName = 'Vũ Mai Hoa';
        accountantUsername = 'accountant';
      }
    }

    const accountantDisplayName =
      accountantUsername && accountantUsername !== accountantName
        ? `${accountantName} (${accountantUsername})`
        : accountantName;

    return {
      id: row.id,
      code: row.code,
      returnReceiptId: row.return_receipt_id,
      returnReceiptCode: row.return_receipt_code || '',
      agencyId: row.agency_id,
      agencyCode: formattedAgencyCode,
      agencyName: row.agency_name_real || row.agency_name || '',
      originalInvoiceId: row.original_invoice_id,
      originalInvoiceCode: row.original_invoice_code || '',
      adjustmentAmount: Number(row.adjustment_amount || 0),
      reason: row.reason || '',
      status: row.status || 'POSTED',
      createdBy: row.created_by || '',
      creatorName: accountantName || row.creator_name || '',
      slipCreatedBy: rawSlipCreator || 'usr-sale-03',
      slipCreatorName,
      slipCreatorUsername,
      slipCreatorDisplayName,
      accountantName,
      accountantUsername,
      accountantDisplayName,
      items,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
  }
}
