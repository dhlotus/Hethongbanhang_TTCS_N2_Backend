import { Injectable, NotFoundException, Optional, Logger } from '@nestjs/common';
import * as fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { DatabaseService } from '../../database/database.service';
import {
  Receipt,
  PaymentMethod,
  ReceiptStatus,
} from './entities/receipt.entity';
import { ReceiptPrintDto } from './dto/receipt-print.dto';
import { numberToVietnameseWords } from '../../common/utils/number-to-vietnamese-words.util';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

export interface PaginatedReceiptsResult {
  data: Receipt[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const COMPANY_INFO = {
  name: 'CÔNG TY CỔ PHẦN THỰC PHẨM DINH DƯỠNG LOHA GOLD',
  brand: 'LOHA GOLD B2B SALES & DISTRIBUTION',
  address: 'Lô C2-4, KCN Tân Bình, Tây Thạnh, Tân Phú, TP. Hồ Chí Minh',
  phone: '1900 6868 - (028) 3816 8888',
  taxCode: '0316889988',
  templateCode: 'Mẫu số: 01 - TT (Ban hành theo TT số 200/2014/TT-BTC)',
};

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Tiền mặt',
  [PaymentMethod.BANK_TRANSFER]: 'Chuyển khoản',
  [PaymentMethod.CREDIT_CARD]: 'Thẻ tín dụng / Ghi nợ',
  [PaymentMethod.CHECK]: 'Séc thanh toán',
};

const STATUS_LABELS: Record<ReceiptStatus, string> = {
  [ReceiptStatus.CONFIRMED]: 'Đã xác nhận thu tiền',
  [ReceiptStatus.PENDING]: 'Chờ xác nhận',
  [ReceiptStatus.CANCELLED]: 'Đã hủy',
};

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);
  private readonly receipts = new Map<string, Receipt>();

  constructor(@Optional() private readonly databaseService?: DatabaseService) {
    this.seedInitialReceipts();
  }

  /**
   * Khởi tạo các phiếu thu mẫu đại diện đầy đủ thông tin chuẩn nghiệp vụ Kế toán B2B
   */
  private seedInitialReceipts(): void {
    const seeds: Receipt[] = [
      new Receipt({
        id: 'rcpt-001',
        code: 'PT2610-0001',
        customerId: 'cust-001',
        customerCode: 'DL-0001',
        customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
        customerPhone: '0988 123 456',
        customerAddress: 'Số 123 Phố Vọng, P. Đồng Tâm, Q. Hai Bà Trưng, Hà Nội',
        amount: 25000000,
        amountInWords: numberToVietnameseWords(25000000),
        paymentMethod: PaymentMethod.CASH,
        paymentDate: new Date('2026-10-15T09:30:00+07:00'),
        referenceCode: 'HD2609-001',
        notes: 'Thu tiền mặt đợt 1 cho hóa đơn bán buôn HD2609-001',
        status: ReceiptStatus.CONFIRMED,
        collectorId: 'usr-acc-01',
        collectorName: 'Nguyễn Thị Mai',
        collectorUsername: 'accountant_debt',
        createdAt: new Date('2026-10-15T09:30:00+07:00'),
        updatedAt: new Date('2026-10-15T09:30:00+07:00'),
      }),
      new Receipt({
        id: 'rcpt-002',
        code: 'PT2610-0002',
        customerId: 'cust-002',
        customerCode: 'DL-0002',
        customerName: 'Đại lý Tạp hóa Hưng Yên',
        customerPhone: '0912 345 678',
        customerAddress: 'Xã Dân Tiến, Huyện Khoái Châu, Tỉnh Hưng Yên',
        amount: 18000000,
        amountInWords: numberToVietnameseWords(18000000),
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentDate: new Date('2026-10-14T14:15:00+07:00'),
        referenceCode: 'HD2609-002',
        notes: 'Chuyển khoản thanh toán toàn bộ công nợ qua Vietcombank',
        status: ReceiptStatus.CONFIRMED,
        collectorId: 'usr-acc-02',
        collectorName: 'Trần Văn Kế Toán',
        collectorUsername: 'accountant_lead',
        createdAt: new Date('2026-10-14T14:15:00+07:00'),
        updatedAt: new Date('2026-10-14T14:15:00+07:00'),
      }),
      new Receipt({
        id: 'rcpt-003',
        code: 'PT2610-0003',
        customerId: 'cust-008',
        customerCode: 'DL-0008',
        customerName: 'Đại Lý Tiêu Dùng Nhanh Thịnh Vượng',
        customerPhone: '0977 889 900',
        customerAddress: 'Số 45 Lê Lợi, P. Bến Nghé, Quận 1, TP. Hồ Chí Minh',
        amount: 51300000,
        amountInWords: numberToVietnameseWords(51300000),
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentDate: new Date('2026-10-15T15:45:00+07:00'),
        referenceCode: 'DH2610-10156',
        notes: 'Thu tiền thanh toán đơn hàng bán buôn DH2610-10156',
        status: ReceiptStatus.CONFIRMED,
        collectorId: 'usr-acc-01',
        collectorName: 'Nguyễn Thị Mai',
        collectorUsername: 'accountant_debt',
        createdAt: new Date('2026-10-15T15:45:00+07:00'),
        updatedAt: new Date('2026-10-15T15:45:00+07:00'),
      }),
      new Receipt({
        id: 'rcpt-004',
        code: 'PT2610-0004',
        customerId: '55555555-0000-0000-0000-000000000002',
        customerCode: 'DL-0004',
        customerName: 'Đại Lý Phân Phối Hàng Tiêu Dùng An Phát',
        customerPhone: '0901234564',
        customerAddress: 'Số 99 Lê Đức Thọ, P.7, Q.Gò Vấp, TP.HCM',
        amount: 5000000,
        amountInWords: numberToVietnameseWords(5000000),
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentDate: new Date('2026-10-10T11:00:00+07:00'),
        referenceCode: 'HD2609-005',
        notes: 'Thu tiền tạm ứng đợt 1 hóa đơn HD2609-005',
        status: ReceiptStatus.CONFIRMED,
        collectorId: 'usr-acc-01',
        collectorName: 'Nguyễn Thị Mai',
        collectorUsername: 'accountant_debt',
        createdAt: new Date('2026-10-10T11:00:00+07:00'),
        updatedAt: new Date('2026-10-10T11:00:00+07:00'),
      }),
      new Receipt({
        id: 'rcpt-005',
        code: 'PT2610-0005',
        customerId: 'cust-dl-0003',
        customerCode: 'DL-0003',
        customerName: 'Công Ty Cổ Phần Thương Mại Dịch Vụ Hoàng Gia',
        customerPhone: '0901234563',
        customerAddress: '320 Cộng Hòa, P.13, Q.Tân Bình, TP.HCM',
        amount: 15000000,
        amountInWords: numberToVietnameseWords(15000000),
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentDate: new Date('2026-08-20T10:00:00+07:00'),
        referenceCode: 'HD2608-HG-01',
        notes: 'Tạm ứng đợt 1 chuyển khoản qua Techcombank',
        status: ReceiptStatus.CONFIRMED,
        collectorId: 'usr-acc-01',
        collectorName: 'Nguyễn Thị Mai',
        collectorUsername: 'accountant_debt',
        createdAt: new Date('2026-08-20T10:00:00+07:00'),
        updatedAt: new Date('2026-08-20T10:00:00+07:00'),
      }),
      new Receipt({
        id: 'rcpt-006',
        code: 'PT2610-0006',
        customerId: 'cust-dl-0008',
        customerCode: 'DL-0008',
        customerName: 'Đại Lý Tiêu Dùng Nhanh Thịnh Vượng',
        customerPhone: '0977 889 900',
        customerAddress: 'Số 45 Lê Lợi, P. Bến Nghé, Quận 1, TP. Hồ Chí Minh',
        amount: 8000000,
        amountInWords: numberToVietnameseWords(8000000),
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        paymentDate: new Date('2026-09-18T15:00:00+07:00'),
        referenceCode: 'HD2608-TV-01',
        notes: 'Thanh toán đợt 1 qua Vietcombank cho hóa đơn HD2608-TV-01',
        status: ReceiptStatus.CONFIRMED,
        collectorId: 'usr-acc-02',
        collectorName: 'Trần Văn Kế Toán',
        collectorUsername: 'accountant_lead',
        createdAt: new Date('2026-09-18T15:00:00+07:00'),
        updatedAt: new Date('2026-09-18T15:00:00+07:00'),
      }),
    ];

    for (const r of seeds) {
      this.receipts.set(r.id, r);
      this.receipts.set(r.code, r);
    }
  }

  /**
   * Lấy toàn bộ phiếu thu tiền trong hệ thống (dành cho module Báo cáo công nợ & đối soát)
   */
  async getAllReceipts(): Promise<Receipt[]> {
    const unique = new Map<string, Receipt>();
    for (const r of this.receipts.values()) {
      unique.set(r.id, r);
    }
    return Array.from(unique.values());
  }

  /**
   * Lấy danh sách phiếu thu với tìm kiếm, lọc hình thức và phân trang chuẩn Backend
   */
  async findAll(
    query?: {
      search?: string;
      customerId?: string;
      paymentMethod?: string;
      page?: number | string;
      limit?: number | string;
    },
    currentUser?: ICurrentUser,
  ): Promise<Receipt[] | PaginatedReceiptsResult> {
    let list = Array.from(new Set(this.receipts.values()));

    // 1. Phân quyền xem phiếu thu theo Role: Đại lý chỉ xem phiếu thu của mình
    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdminOrAccountant =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER') ||
        roles.includes(UserRole.ACCOUNTANT) ||
        roles.includes('ACCOUNTANT_DEBT');

      if (!isManagerOrAdminOrAccountant && roles.includes(UserRole.CUSTOMER)) {
        const email = (currentUser.email || '').toLowerCase().trim();
        const uname = (currentUser.username || '').toLowerCase().trim();
        let targetCustId = currentUser.customerId || currentUser.agencyId || currentUser.userId;
        if (uname === 'dealer' || email === 'dealer@loha.vn') {
          targetCustId = 'cust-001';
        } else if (uname === 'daily' || email === 'daily@loha.vn') {
          targetCustId = 'cust-002';
        }
        list = list.filter(
          (r) =>
            r.customerId === targetCustId ||
            (targetCustId === 'cust-001' &&
              (r.customerId === '55555555-0000-0000-0000-000000000001' || r.customerCode === 'DL-0001')) ||
            (targetCustId === 'cust-002' &&
              (r.customerId === '55555555-0000-0000-0000-000000000002' || r.customerCode === 'DL-0002')),
        );
      }
    }

    // 2. Lọc theo customerId nếu có
    if (query?.customerId) {
      list = list.filter((r) => r.customerId === query.customerId);
    }

    // 3. Lọc theo hình thức thanh toán (paymentMethod)
    if (query?.paymentMethod && query.paymentMethod !== 'ALL') {
      const method = query.paymentMethod.toUpperCase().trim();
      list = list.filter((r) => r.paymentMethod === method);
    }

    // 4. Tìm kiếm từ khóa (Mã phiếu, Tên đại lý, Mã đại lý, Chứng từ gốc, Người thu, Ghi chú)
    if (query?.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.code.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.customerCode.toLowerCase().includes(q) ||
          (r.referenceCode && r.referenceCode.toLowerCase().includes(q)) ||
          r.collectorName.toLowerCase().includes(q) ||
          (r.notes && r.notes.toLowerCase().includes(q)),
      );
    }

    // 5. Sắp xếp ngày tạo mới nhất lên đầu
    list.sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime());

    // 6. Hỗ trợ phân trang khi client gửi page hoặc limit
    if (query?.page !== undefined || query?.limit !== undefined) {
      const total = list.length;
      const page = Math.max(1, Number(query.page || 1));
      const limit = Math.max(1, Math.min(100, Number(query.limit || 10)));
      const totalPages = Math.ceil(total / limit) || 1;
      const offset = (page - 1) * limit;
      const data = list.slice(offset, offset + limit);

      return {
        data,
        total,
        page,
        limit,
        totalPages,
      };
    }

    return list;
  }

  /**
   * Tìm phiếu thu theo ID hoặc Mã phiếu
   */
  async findById(idOrCode: string): Promise<Receipt> {
    const receipt = this.receipts.get(idOrCode);
    if (receipt) {
      return receipt;
    }

    // Tìm kiếm trong toàn bộ values
    for (const item of this.receipts.values()) {
      if (item.id === idOrCode || item.code === idOrCode) {
        return item;
      }
    }

    throw new NotFoundException(`Không tìm thấy phiếu thu với mã/id: ${idOrCode}`);
  }

  /**
   * Kiểm tra xem phiếu thu cho mã chứng từ tham chiếu (hóa đơn) đã tồn tại hay chưa
   */
  hasReceiptForReference(referenceCode: string): boolean {
    if (!referenceCode) return false;
    for (const r of this.receipts.values()) {
      if (r.referenceCode && r.referenceCode.toLowerCase() === referenceCode.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Tự động sinh phiếu thu tiền & đối trừ khi ghi nhận thanh toán hóa đơn (SN-200, SN-207, SN-209)
   */
  async createReceiptFromInvoicePayment(params: {
    invoiceId: string;
    invoiceCode: string;
    customerId: string;
    customerCode?: string;
    customerName: string;
    customerPhone?: string;
    customerAddress?: string;
    amount: number;
    paymentMethod?: string;
    note?: string;
    collectorId?: string;
    collectorName?: string;
    collectorUsername?: string;
  }): Promise<Receipt> {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const prefix = `PT${yy}${mm}-`;

    let maxNum = 0;
    for (const r of this.receipts.values()) {
      if (r.code && r.code.startsWith(prefix)) {
        const suffix = r.code.slice(prefix.length);
        const parsed = parseInt(suffix, 10);
        if (!isNaN(parsed) && parsed > maxNum) {
          maxNum = parsed;
        }
      }
    }

    const nextCode = `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
    const id = `rcpt-${Date.now()}`;

    let method = PaymentMethod.BANK_TRANSFER;
    const rawMethod = (params.paymentMethod || '').toUpperCase().trim();
    if (rawMethod.includes('CASH') || rawMethod.includes('TIỀN MẶT')) {
      method = PaymentMethod.CASH;
    } else if (rawMethod.includes('CARD') || rawMethod.includes('THẺ')) {
      method = PaymentMethod.CREDIT_CARD;
    } else if (rawMethod.includes('CHECK') || rawMethod.includes('SÉC')) {
      method = PaymentMethod.CHECK;
    }

    const receipt = new Receipt({
      id,
      code: nextCode,
      customerId: params.customerId,
      customerCode: params.customerCode || params.customerId,
      customerName: params.customerName,
      customerPhone: params.customerPhone || '0988 123 456',
      customerAddress: params.customerAddress || 'Số 123 Phố Vọng, P. Đồng Tâm, Q. Hai Bà Trưng, Hà Nội',
      amount: params.amount,
      amountInWords: numberToVietnameseWords(params.amount),
      paymentMethod: method,
      paymentDate: now,
      referenceCode: params.invoiceCode,
      notes: params.note || `Thu tiền thanh toán cho hóa đơn ${params.invoiceCode}`,
      status: ReceiptStatus.CONFIRMED,
      collectorId: params.collectorId || 'usr-acc-01',
      collectorName: params.collectorName || 'Kế toán công nợ',
      collectorUsername: params.collectorUsername || 'accountant',
      createdAt: now,
      updatedAt: now,
    });

    this.receipts.set(receipt.id, receipt);
    this.receipts.set(receipt.code, receipt);

    this.logger.log(`[ReceiptsService] Đã tự động tạo phiếu thu ${receipt.code} cho hóa đơn ${params.invoiceCode} số tiền ${params.amount} đ`);
    return receipt;
  }

  /**
   * Lấy dữ liệu chuẩn hóa phục vụ In ấn (Endpoint: GET /api/receipts/:id/print)
   * Đảm bảo đủ 5 thông tin: Mã, Đại lý, Số tiền, Hình thức, Người thu (SN-209)
   */
  async getPrintData(idOrCode: string): Promise<ReceiptPrintDto> {
    const receipt = await this.findById(idOrCode);

    const formattedVnd = new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
    }).format(receipt.amount);

    return {
      id: receipt.id,
      receiptCode: receipt.code,
      code: receipt.code,
      customerInfo: {
        id: receipt.customerId,
        code: receipt.customerCode,
        name: receipt.customerName,
        phone: receipt.customerPhone,
        address: receipt.customerAddress,
      },
      amount: receipt.amount,
      amountFormatted: formattedVnd,
      amountInWords: receipt.amountInWords || numberToVietnameseWords(receipt.amount),
      paymentMethod: receipt.paymentMethod,
      paymentMethodLabel: PAYMENT_METHOD_LABELS[receipt.paymentMethod] || receipt.paymentMethod,
      collectorInfo: {
        id: receipt.collectorId,
        username: receipt.collectorUsername,
        name: receipt.collectorName,
        role: 'Kế toán công nợ',
      },
      collectorName: receipt.collectorName,
      paymentDate: receipt.paymentDate.toISOString(),
      referenceCode: receipt.referenceCode,
      notes: receipt.notes,
      status: receipt.status,
      statusLabel: STATUS_LABELS[receipt.status] || receipt.status,
      companyInfo: COMPANY_INFO,
    };
  }

  /**
   * Sinh Buffer file PDF phiếu thu chính thức (Endpoint: GET /api/receipts/:id/pdf)
   * Sử dụng PDFKit với font Arial Unicode tiếng Việt, khớp 100% với mẫu in giao diện
   */
  async generatePdfBuffer(idOrCode: string): Promise<{ buffer: Buffer; filename: string }> {
    const data = await this.getPrintData(idOrCode);

    return new Promise<{ buffer: Buffer; filename: string }>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 40,
          info: {
            Title: `Phieu_Thu_${data.receiptCode}`,
            Author: COMPANY_INFO.brand,
            Subject: 'Biên lai phiếu thu tiền khách hàng B2B',
          },
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            buffer,
            filename: `phieu-thu-${data.receiptCode}.pdf`,
          });
        });
        doc.on('error', (err: unknown) => reject(err));

        // Cấu hình font Arial Unicode tiếng Việt
        const arialPath = 'C:\\Windows\\Fonts\\arial.ttf';
        const arialBoldPath = 'C:\\Windows\\Fonts\\arialbd.ttf';
        const arialItalicPath = 'C:\\Windows\\Fonts\\ariali.ttf';

        const hasArial = fs.existsSync(arialPath);
        if (hasArial) {
          doc.registerFont('Arial', arialPath);
          doc.registerFont('Arial-Bold', arialBoldPath);
          doc.registerFont('Arial-Italic', arialItalicPath);
        }

        const fontRegular = hasArial ? 'Arial' : 'Helvetica';
        const fontBold = hasArial ? 'Arial-Bold' : 'Helvetica-Bold';
        const fontItalic = hasArial ? 'Arial-Italic' : 'Helvetica-Oblique';

        // 1. Tiêu đề Phiếu thu (Bắt đầu trực tiếp từ tiêu đề, không còn header công ty và barcode)
        doc
          .fontSize(22)
          .font(fontBold)
          .fillColor('#0f172a')
          .text('PHIẾU THU TIỀN', 40, 50, { align: 'center' });

        const d = new Date(data.paymentDate);
        const dayStr = d.getDate().toString().padStart(2, '0');
        const monthStr = (d.getMonth() + 1).toString().padStart(2, '0');
        const yearStr = d.getFullYear().toString();

        doc
          .fontSize(10)
          .font(fontItalic)
          .fillColor('#64748b')
          .text(`Ngày ${dayStr} tháng ${monthStr} năm ${yearStr}`, 40, 80, { align: 'center' });

        // 2. Khung chi tiết các trường thông tin bắt buộc với đường kẻ phân cách giữa các ô
        const boxX = 45;
        const boxY = 115;
        const boxWidth = 505;
        const leftCol = 60;
        const valCol = 180;

        let currentY = boxY;

        // --- ROW 1: Mã phiếu thu ---
        const row1Height = 36;
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#475569')
          .text('Mã phiếu thu:', leftCol, currentY + 11)
          .font(fontBold)
          .fillColor('#4338ca')
          .text(data.receiptCode, valCol, currentY + 11);

        currentY += row1Height;
        doc.moveTo(boxX, currentY).lineTo(boxX + boxWidth, currentY).strokeColor('#e2e8f0').lineWidth(0.8).stroke();

        // --- ROW 2: Đại lý / Người nộp ---
        const row2Height = 56;
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#475569')
          .text('Đại lý / Người nộp:', leftCol, currentY + 10)
          .font(fontBold)
          .fillColor('#0f172a')
          .text(data.customerInfo.name, valCol, currentY + 10, { continued: true })
          .font(fontRegular)
          .fillColor('#64748b')
          .text(` (${data.customerInfo.code})`);

        doc
          .fontSize(9)
          .font(fontRegular)
          .fillColor('#64748b')
          .text('Điện thoại: ', valCol, currentY + 28, { continued: true })
          .font(fontBold)
          .fillColor('#1e293b')
          .text(`${data.customerInfo.phone || '---'}   `, { continued: true })
          .font(fontRegular)
          .fillColor('#64748b')
          .text('Địa chỉ: ', { continued: true })
          .font(fontRegular)
          .fillColor('#334155')
          .text(data.customerInfo.address || '---', { width: 340 });

        currentY += row2Height;
        doc.moveTo(boxX, currentY).lineTo(boxX + boxWidth, currentY).strokeColor('#e2e8f0').lineWidth(0.8).stroke();

        // --- ROW 3: Số tiền thu (Nền xanh nhạt chuẩn mẫu in giao diện) ---
        const row3Height = 52;
        doc.rect(boxX + 0.5, currentY, boxWidth - 1, row3Height).fillColor('#ecfdf5').fill();

        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#047857')
          .text('Số tiền thu:', leftCol, currentY + 10)
          .font(fontBold)
          .fillColor('#047857')
          .fontSize(14)
          .text(data.amountFormatted, valCol, currentY + 8);

        doc
          .fontSize(9)
          .font(fontItalic)
          .fillColor('#065f46')
          .text('(Viết bằng chữ: ', valCol, currentY + 28, { continued: true })
          .font(fontBold)
          .text(`${data.amountInWords})`);

        currentY += row3Height;
        doc.moveTo(boxX, currentY).lineTo(boxX + boxWidth, currentY).strokeColor('#e2e8f0').lineWidth(0.8).stroke();

        // --- ROW 4: Hình thức thu (Chỉ hiển thị tên hình thức thu) ---
        const row4Height = 36;
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#475569')
          .text('Hình thức thu:', leftCol, currentY + 11)
          .font(fontBold)
          .fillColor('#1e293b')
          .text(data.paymentMethodLabel, valCol, currentY + 11);

        currentY += row4Height;
        doc.moveTo(boxX, currentY).lineTo(boxX + boxWidth, currentY).strokeColor('#e2e8f0').lineWidth(0.8).stroke();

        // --- ROW 5: Người thu tiền (Chỉ hiển thị họ tên người thu) ---
        const row5Height = 36;
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#475569')
          .text('Người thu tiền:', leftCol, currentY + 11)
          .font(fontBold)
          .fillColor('#0f172a')
          .text(data.collectorName, valCol, currentY + 11);

        currentY += row5Height;
        doc.moveTo(boxX, currentY).lineTo(boxX + boxWidth, currentY).strokeColor('#e2e8f0').lineWidth(0.8).stroke();

        // --- ROW 6: Lý do thu / Đối trừ ---
        const row6Height = 48;
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#475569')
          .text('Lý do thu / Đối trừ:', leftCol, currentY + 10)
          .font(fontRegular)
          .fillColor('#334155')
          .text(data.notes || 'Thu tiền thanh toán đơn hàng', valCol, currentY + 10, { width: 340 });

        doc
          .fontSize(9)
          .font(fontRegular)
          .fillColor('#64748b')
          .text('Chứng từ gốc liên kết: ', valCol, currentY + 28, { continued: true })
          .font(fontBold)
          .fillColor('#0f172a')
          .text(data.referenceCode || '---');

        currentY += row6Height;

        // Khung ngoài bao quanh
        const totalHeight = currentY - boxY;
        doc.roundedRect(boxX, boxY, boxWidth, totalHeight, 8).strokeColor('#cbd5e1').lineWidth(1).stroke();

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
