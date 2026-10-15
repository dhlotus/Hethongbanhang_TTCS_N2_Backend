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
    ];

    for (const r of seeds) {
      this.receipts.set(r.id, r);
      this.receipts.set(r.code, r);
    }
  }

  /**
   * Lấy danh sách phiếu thu
   */
  async findAll(query?: { search?: string; customerId?: string }): Promise<Receipt[]> {
    let list = Array.from(new Set(this.receipts.values()));

    if (query?.search) {
      const q = query.search.trim().toLowerCase();
      list = list.filter(
        (r) =>
          r.code.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.customerCode.toLowerCase().includes(q) ||
          (r.referenceCode && r.referenceCode.toLowerCase().includes(q)) ||
          r.collectorName.toLowerCase().includes(q),
      );
    }

    if (query?.customerId) {
      list = list.filter((r) => r.customerId === query.customerId);
    }

    // Sắp xếp ngày tạo mới nhất lên đầu
    return list.sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime());
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

        // --- ROW 4: Hình thức thu (Có khung badge) ---
        const row4Height = 40;
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#475569')
          .text('Hình thức thu:', leftCol, currentY + 13);

        // Badge viên thuốc trắng bo viền
        doc.roundedRect(valCol, currentY + 8, 160, 24, 4).fillAndStroke('#ffffff', '#cbd5e1');
        doc
          .fontSize(9.5)
          .font(fontBold)
          .fillColor('#1e293b')
          .text(`💳  ${data.paymentMethodLabel}`, valCol + 10, currentY + 13);

        currentY += row4Height;
        doc.moveTo(boxX, currentY).lineTo(boxX + boxWidth, currentY).strokeColor('#e2e8f0').lineWidth(0.8).stroke();

        // --- ROW 5: Người thu tiền (Có badge Kế toán công nợ) ---
        const row5Height = 40;
        doc
          .fontSize(10)
          .font(fontBold)
          .fillColor('#475569')
          .text('Người thu tiền:', leftCol, currentY + 13)
          .font(fontBold)
          .fillColor('#0f172a')
          .text(data.collectorName, valCol, currentY + 13);

        const collectorWidth = doc.widthOfString(data.collectorName);
        // Badge Kế toán công nợ
        const badgeX = valCol + collectorWidth + 14;
        doc.roundedRect(badgeX, currentY + 9, 105, 20, 10).fillAndStroke('#eef2ff', '#c7d2fe');
        doc
          .fontSize(8.5)
          .font(fontBold)
          .fillColor('#4338ca')
          .text('✓ Kế toán công nợ', badgeX + 8, currentY + 13);

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
