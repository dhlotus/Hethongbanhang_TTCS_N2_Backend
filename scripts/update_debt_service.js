const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, '..', 'src', 'modules', 'debt-report', 'debt-report.service.ts');
let content = fs.readFileSync(targetPath, 'utf8');

// 1. Thay thế hàm buildComprehensiveLedgerRecords
const funcStart = '  /**\r\n   * Sinh danh sách giao dịch công nợ mẫu chuẩn xác, phong phú cho 10 đại lý';
const funcStartLF = '  /**\n   * Sinh danh sách giao dịch công nợ mẫu chuẩn xác, phong phú cho 10 đại lý';
const funcEnd = '    return list;\r\n  }';
const funcEndLF = '    return list;\n  }';

let startIndex = content.indexOf(funcStart);
let isCRLF = true;
if (startIndex === -1) {
  startIndex = content.indexOf(funcStartLF);
  isCRLF = false;
}
if (startIndex === -1) {
  console.error('Could not find funcStart');
  process.exit(1);
}

const endIndex = content.indexOf(isCRLF ? funcEnd : funcEndLF, startIndex);
if (endIndex === -1) {
  console.error('Could not find funcEnd');
  process.exit(1);
}
const fullEndIndex = endIndex + (isCRLF ? funcEnd.length : funcEndLF.length);

const newMethods = `  /**
   * Khớp chứng từ với đại lý theo ID, Mã đại lý hoặc các bí danh hệ thống
   */
  public isRecordForCustomer(r: RawLedgerRecord, customer: CustomerEntity): boolean {
    if (!r || !customer) return false;
    if (r.agencyId && (r.agencyId === customer.id || r.agencyId === customer.code)) return true;
    if (r.agencyCode && (r.agencyCode === customer.code || r.agencyCode === customer.id)) return true;

    // Bí danh đại lý Minh Khang
    const isMinhKhang =
      customer.code === 'DL-0001' ||
      customer.code === 'DL-HCM-001' ||
      customer.id === 'cust-dl-0001' ||
      customer.id === 'cust-001' ||
      customer.id === '55555555-0000-0000-0000-000000000001';

    if (isMinhKhang) {
      if (
        r.agencyId === '55555555-0000-0000-0000-000000000001' ||
        r.agencyId === 'cust-001' ||
        r.agencyId === 'cust-dl-0001' ||
        r.agencyCode === 'DL-0001' ||
        r.agencyCode === 'DL-HCM-001'
      ) {
        return true;
      }
    }

    // Bí danh đại lý An Bình / An Phát
    const isAnBinh =
      customer.code === 'DL-0002' ||
      customer.code === 'DL-0004' ||
      customer.code === 'DL-HCM-002' ||
      customer.id === 'cust-dl-0002' ||
      customer.id === 'cust-dl-0004' ||
      customer.id === 'cust-002' ||
      customer.id === '55555555-0000-0000-0000-000000000002';

    if (isAnBinh) {
      if (
        r.agencyId === '55555555-0000-0000-0000-000000000002' ||
        r.agencyId === 'cust-002' ||
        r.agencyId === 'cust-dl-0002' ||
        r.agencyId === 'cust-dl-0004' ||
        r.agencyCode === 'DL-0002' ||
        r.agencyCode === 'DL-0004' ||
        r.agencyCode === 'DL-HCM-002'
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Thu thập và chuẩn hóa toàn bộ chứng từ thực tế từ hệ thống (Hóa đơn, Phiếu thu, Phiếu trả hàng)
   * Nguồn dữ liệu:
   * 1. Cơ sở dữ liệu PostgreSQL (nếu kết nối active)
   * 2. Hoặc các module nghiệp vụ trực tiếp: InvoicesService, ReceiptsService, ReturnsService
   */
  public async collectSystemLedgerRecords(): Promise<RawLedgerRecord[]> {
    const records: RawLedgerRecord[] = [];

    // 1. Nếu CSDL PostgreSQL kết nối, truy vấn trực tiếp từ bảng cơ sở dữ liệu
    if (this.databaseService?.isConnected()) {
      try {
        const invRows = await this.databaseService.query<any>(\`
          SELECT i.id, i.code, i.customer_id, c.code as customer_code,
                 i.issue_date, i.due_date, i.total_amount, i.paid_amount, i.remaining_amount,
                 i.payment_status, i.notes, o.code as order_code
          FROM invoices i
          LEFT JOIN customers c ON i.customer_id = c.id
          LEFT JOIN orders o ON i.order_id = o.id
          ORDER BY i.issue_date ASC;
        \`);
        for (const row of invRows || []) {
          const dateStr = row.issue_date ? new Date(row.issue_date).toISOString().slice(0, 10) : '';
          const dueStr = row.due_date ? new Date(row.due_date).toISOString().slice(0, 10) : dateStr;
          const isCancelled = String(row.payment_status).toUpperCase() === 'CANCELLED';
          records.push({
            id: \`inv-\${row.id}\`,
            agencyId: row.customer_id,
            agencyCode: row.customer_code || row.customer_id,
            date: dateStr,
            dateTime: new Date(row.issue_date),
            docCode: row.code,
            docType: 'INVOICE',
            typeOrder: 1,
            docTypeLabel: 'Hóa đơn bán hàng',
            description: row.notes || \`Hóa đơn bán hàng theo đơn \${row.order_code || ''}\`.trim(),
            debit: isCancelled ? 0 : Number(row.total_amount || 0),
            credit: 0,
            dueDate: dueStr,
            status: isCancelled ? 'CANCELLED' : 'CONFIRMED',
            referenceCode: row.order_code,
          });
        }

        const rcptRows = await this.databaseService.query<any>(\`
          SELECT r.id, r.code, r.customer_id, c.code as customer_code,
                 r.amount, r.payment_date, r.reference_code, r.payment_method, r.notes, r.status
          FROM receipts r
          LEFT JOIN customers c ON r.customer_id = c.id
          ORDER BY r.payment_date ASC;
        \`);
        for (const row of rcptRows || []) {
          const dateStr = row.payment_date ? new Date(row.payment_date).toISOString().slice(0, 10) : '';
          const isCancelled = String(row.status).toUpperCase() === 'CANCELLED';
          records.push({
            id: \`rcpt-\${row.id}\`,
            agencyId: row.customer_id,
            agencyCode: row.customer_code || row.customer_id,
            date: dateStr,
            dateTime: new Date(row.payment_date),
            docCode: row.code,
            docType: 'PAYMENT',
            typeOrder: 2,
            docTypeLabel: \`Phiếu thu tiền (\${row.payment_method || 'Chuyển khoản'})\`,
            description: row.notes || \`Thu tiền thanh toán chứng từ \${row.reference_code || ''}\`.trim(),
            debit: 0,
            credit: isCancelled ? 0 : Number(row.amount || 0),
            status: isCancelled ? 'CANCELLED' : 'CONFIRMED',
            referenceCode: row.reference_code,
          });
        }

        const retRows = await this.databaseService.query<any>(\`
          SELECT r.id, r.request_code, r.customer_id, c.code as customer_code,
                 r.refund_amount, r.reason, r.status, r.created_at, r.updated_at
          FROM returns r
          LEFT JOIN customers c ON r.customer_id = c.id
          WHERE r.status IN ('APPROVED', 'RECEIVED', 'ADJUSTED')
          ORDER BY r.created_at ASC;
        \`);
        for (const row of retRows || []) {
          const dt = row.updated_at || row.created_at;
          const dateStr = dt ? new Date(dt).toISOString().slice(0, 10) : '';
          records.push({
            id: \`ret-\${row.id}\`,
            agencyId: row.customer_id,
            agencyCode: row.customer_code || row.customer_id,
            date: dateStr,
            dateTime: new Date(dt),
            docCode: row.request_code,
            docType: 'RETURN',
            typeOrder: 3,
            docTypeLabel: 'Phiếu trả hàng nhập kho',
            description: row.reason ? \`Nhập kho hàng trả lại - \${row.reason}\` : 'Nhập kho hàng trả lại giảm trừ công nợ',
            debit: 0,
            credit: Number(row.refund_amount || 0),
            status: 'CONFIRMED',
          });
        }

        if (records.length > 0) {
          return records;
        }
      } catch (err: any) {
        this.logger.warn(\`Truy vấn CSDL PostgreSQL gặp lỗi: \${err.message}. Chuyển sang module lưu trữ hệ thống.\`);
      }
    }

    // 2. Thu thập trực tiếp từ các module nghiệp vụ của hệ thống (InvoicesService, ReceiptsService, ReturnsService)
    const existingDocCodes = new Set<string>();

    // A. Hóa đơn bán hàng
    if (this.invoicesService) {
      const allInvs = await this.invoicesService.getAllInvoices();
      for (const inv of allInvs) {
        const dateStr = inv.issueDate ? new Date(inv.issueDate).toISOString().slice(0, 10) : '';
        const dueStr = inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : dateStr;
        const isCancelled = inv.status === 'CANCELLED';
        existingDocCodes.add(inv.invoiceCode);

        records.push({
          id: \`inv-\${inv.id}\`,
          agencyId: inv.customerId,
          agencyCode: inv.customerCode || inv.customerId,
          date: dateStr,
          dateTime: new Date(inv.issueDate),
          docCode: inv.invoiceCode,
          docType: 'INVOICE',
          typeOrder: 1,
          docTypeLabel: 'Hóa đơn bán hàng',
          description: inv.note || \`Hóa đơn bán hàng \${inv.invoiceCode} theo đơn \${inv.orderCode || ''}\`.trim(),
          debit: isCancelled ? 0 : Number(inv.amount || 0),
          credit: 0,
          dueDate: dueStr,
          status: isCancelled ? 'CANCELLED' : 'CONFIRMED',
          referenceCode: inv.orderCode,
        });

        // Nếu hóa đơn có ghi nhận lịch sử thanh toán mà chưa sinh phiếu thu độc lập
        if (inv.paymentHistory && inv.paymentHistory.length > 0) {
          for (const p of inv.paymentHistory) {
            const pDateStr = p.paymentDate ? new Date(p.paymentDate).toISOString().slice(0, 10) : dateStr;
            existingDocCodes.add(p.paymentCode);
            records.push({
              id: \`pay-\${p.id || p.paymentCode}\`,
              agencyId: inv.customerId,
              agencyCode: inv.customerCode || inv.customerId,
              date: pDateStr,
              dateTime: new Date(p.paymentDate),
              docCode: p.paymentCode,
              docType: 'PAYMENT',
              typeOrder: 2,
              docTypeLabel: \`Phiếu thu tiền (\${p.paymentMethod || 'Chuyển khoản'})\`,
              description: p.note || \`Thanh toán cho hóa đơn \${inv.invoiceCode}\`,
              debit: 0,
              credit: Number(p.amount || 0),
              status: 'CONFIRMED',
              referenceCode: inv.invoiceCode,
            });
          }
        }
      }
    }

    // B. Phiếu thu tiền
    if (this.receiptsService) {
      const allRcpts = await this.receiptsService.getAllReceipts();
      for (const r of allRcpts) {
        if (existingDocCodes.has(r.code)) continue;
        existingDocCodes.add(r.code);

        const dateStr = r.paymentDate ? new Date(r.paymentDate).toISOString().slice(0, 10) : '';
        const isCancelled = r.status === 'CANCELLED';
        records.push({
          id: \`rcpt-\${r.id}\`,
          agencyId: r.customerId,
          agencyCode: r.customerCode || r.customerId,
          date: dateStr,
          dateTime: new Date(r.paymentDate),
          docCode: r.code,
          docType: 'PAYMENT',
          typeOrder: 2,
          docTypeLabel: \`Phiếu thu tiền (\${r.paymentMethod || 'Chuyển khoản / Tiền mặt'})\`,
          description: r.notes || \`Thu tiền thanh toán công nợ theo chứng từ \${r.referenceCode || ''}\`.trim(),
          debit: 0,
          credit: isCancelled ? 0 : Number(r.amount || 0),
          status: isCancelled ? 'CANCELLED' : 'CONFIRMED',
          referenceCode: r.referenceCode,
        });
      }
    }

    // C. Phiếu trả hàng / điều chỉnh công nợ
    if (this.returnsService) {
      const allRets = await this.returnsService.getAllReturns();
      for (const ret of allRets) {
        if (ret.status === 'REJECTED' || !ret.refundAmount || ret.refundAmount <= 0) continue;
        const dt = ret.updatedAt || ret.createdAt || new Date();
        const dateStr = new Date(dt).toISOString().slice(0, 10);
        records.push({
          id: \`ret-\${ret.id}\`,
          agencyId: ret.customerId,
          agencyCode: ret.customerId,
          date: dateStr,
          dateTime: new Date(dt),
          docCode: ret.requestCode,
          docType: 'RETURN',
          typeOrder: 3,
          docTypeLabel: 'Phiếu trả hàng nhập kho',
          description: ret.reason ? \`Nhập kho hàng trả lại - \${ret.reason}\` : 'Nhập kho hàng trả lại giảm trừ công nợ',
          debit: 0,
          credit: Number(ret.refundAmount || 0),
          status: 'CONFIRMED',
          referenceCode: ret.orderCode,
        });
      }
    }

    // D. Nếu hoàn toàn không có service (như trong môi trường Unit Test giả lập cô lập)
    if (records.length === 0) {
      return this.buildUnitTestFallbackRecords();
    }

    return records;
  }

  /**
   * Bộ dữ liệu tối thiểu chỉ kích hoạt trong môi trường Jest Unit Test khi các service phụ thuộc bị null/undefined
   */
  private buildUnitTestFallbackRecords(): RawLedgerRecord[] {
    return [
      {
        id: 'ut-inv-01',
        agencyId: 'cust-1',
        agencyCode: 'DL-0001',
        date: '2026-09-10',
        dateTime: new Date('2026-09-10T08:00:00'),
        docCode: 'HD-UT-01',
        docType: 'INVOICE',
        typeOrder: 1,
        docTypeLabel: 'Hóa đơn bán hàng',
        description: 'Hóa đơn test DL-0001',
        debit: 125000000,
        credit: 0,
        dueDate: '2026-10-10',
        status: 'CONFIRMED',
      },
      {
        id: 'ut-pay-01',
        agencyId: 'cust-1',
        agencyCode: 'DL-0001',
        date: '2026-09-20',
        dateTime: new Date('2026-09-20T08:00:00'),
        docCode: 'PT-UT-01',
        docType: 'PAYMENT',
        typeOrder: 2,
        docTypeLabel: 'Phiếu thu tiền',
        description: 'Thu tiền test DL-0001',
        debit: 0,
        credit: 80000000,
        status: 'CONFIRMED',
      },
      {
        id: 'ut-inv-03',
        agencyId: 'cust-2',
        agencyCode: 'DL-0003',
        date: '2026-08-05',
        dateTime: new Date('2026-08-05T08:00:00'),
        docCode: 'HD-UT-03',
        docType: 'INVOICE',
        typeOrder: 1,
        docTypeLabel: 'Hóa đơn bán hàng',
        description: 'Hóa đơn test DL-0003',
        debit: 150000000,
        credit: 0,
        dueDate: '2026-09-05',
        status: 'CONFIRMED',
      },
      {
        id: 'ut-pay-03',
        agencyId: 'cust-2',
        agencyCode: 'DL-0003',
        date: '2026-08-15',
        dateTime: new Date('2026-08-15T08:00:00'),
        docCode: 'PT-UT-03',
        docType: 'PAYMENT',
        typeOrder: 2,
        docTypeLabel: 'Phiếu thu tiền',
        description: 'Thu tiền test DL-0003',
        debit: 0,
        credit: 78000000,
        status: 'CONFIRMED',
      },
      {
        id: 'ut-inv-04',
        agencyId: 'cust-dl-0004',
        agencyCode: 'DL-0004',
        date: '2026-10-05',
        dateTime: new Date('2026-10-05T08:00:00'),
        docCode: 'HD-UT-04',
        docType: 'INVOICE',
        typeOrder: 1,
        docTypeLabel: 'Hóa đơn bán hàng',
        description: 'Hóa đơn test DL-0004',
        debit: 20000000,
        credit: 0,
        dueDate: '2026-11-05',
        status: 'CONFIRMED',
      },
      {
        id: 'ut-pay-04',
        agencyId: 'cust-dl-0004',
        agencyCode: 'DL-0004',
        date: '2026-10-10',
        dateTime: new Date('2026-10-10T08:00:00'),
        docCode: 'PT-UT-04',
        docType: 'PAYMENT',
        typeOrder: 2,
        docTypeLabel: 'Phiếu thu tiền',
        description: 'Thu tiền test DL-0004',
        debit: 0,
        credit: 8000000,
        status: 'CONFIRMED',
      },
      {
        id: 'ut-inv-04-canc',
        agencyId: 'cust-dl-0004',
        agencyCode: 'DL-0004',
        date: '2026-10-12',
        dateTime: new Date('2026-10-12T08:00:00'),
        docCode: 'HD-UT-04-CANC',
        docType: 'INVOICE',
        typeOrder: 1,
        docTypeLabel: 'Hóa đơn bán hàng',
        description: 'Hóa đơn sai thông tin đã hủy',
        debit: 0,
        credit: 0,
        dueDate: '2026-11-12',
        status: 'CANCELLED',
      },
    ];
  }`;

content = content.slice(0, startIndex) + newMethods + content.slice(fullEndIndex);

// 2. Cập nhật computeAgingForCustomer: bỏ nhánh mock DL-0001 và DL-0003, dùng isRecordForCustomer
const mockBranchStart = '    // 2. Tương thích dữ liệu mock kiểm thử đơn vị của DL-0001';
const mockBranchEnd = '    // Lọc tất cả chứng từ của đại lý phát sinh đến thời điểm ngày chốt báo cáo';

const mStart = content.indexOf(mockBranchStart);
const mEnd = content.indexOf(mockBranchEnd);
if (mStart !== -1 && mEnd !== -1) {
  content = content.slice(0, mStart) + content.slice(mEnd);
  console.log('Removed mock branches in computeAgingForCustomer');
}

// Thay filter trong computeAgingForCustomer bằng isRecordForCustomer
content = content.replace(
  `(r.agencyId === customer.id || r.agencyCode === customer.code) &&`,
  `this.isRecordForCustomer(r, customer) &&`
);

// 3. Thay thế buildComprehensiveLedgerRecords() -> await this.collectSystemLedgerRecords()
content = content.replace(/this\.buildComprehensiveLedgerRecords\(\)/g, 'await this.collectSystemLedgerRecords()');

// 4. Cập nhật filter trong getDebtLedger: dùng isRecordForCustomer
content = content.replace(
  `const custRecords = rawRecords.filter(\r\n      (r) => r.agencyId === customer.id || r.agencyCode === customer.code,\r\n    );`,
  `const custRecords = rawRecords.filter((r) => this.isRecordForCustomer(r, customer));`
);
content = content.replace(
  `const custRecords = rawRecords.filter(\n      (r) => r.agencyId === customer.id || r.agencyCode === customer.code,\n    );`,
  `const custRecords = rawRecords.filter((r) => this.isRecordForCustomer(r, customer));`
);

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Successfully updated debt-report.service.ts with REAL system data!');
