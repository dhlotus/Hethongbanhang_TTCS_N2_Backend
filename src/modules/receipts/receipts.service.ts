import { Injectable, NotFoundException, Optional, Logger } from '@nestjs/common';
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
  [PaymentMethod.BANK_TRANSFER]: 'Chuyển khoản ngân hàng',
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
   * Sử dụng PDFKit với layout A5/A4 chuẩn kế toán
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

        // 1. Header Công ty & Mẫu phiếu thu
        doc
          .fontSize(10)
          .font('Helvetica-Bold')
          .text(COMPANY_INFO.name, 40, 40, { align: 'left' });

        doc
          .fontSize(8)
          .font('Helvetica')
          .text(`Dia chi: ${COMPANY_INFO.address}`, 40, 55, { align: 'left' })
          .text(`MST: ${COMPANY_INFO.taxCode}  |  Hotline: ${COMPANY_INFO.phone}`, 40, 68, { align: 'left' });

        // Mẫu chứng từ bộ tài chính (Góc trên bên phải)
        doc
          .fontSize(8)
          .font('Helvetica-Bold')
          .text('Mau so: 01 - TT', 380, 40, { align: 'right' })
          .font('Helvetica')
          .text('(Ban hanh theo TT 200/2014/TT-BTC)', 380, 52, { align: 'right' });

        doc.moveTo(40, 85).lineTo(555, 85).strokeColor('#cbd5e1').lineWidth(1).stroke();

        // 2. Tiêu đề Phiếu thu
        doc
          .fontSize(18)
          .font('Helvetica-Bold')
          .fillColor('#1e1b4b')
          .text('PHIEU THU TIEN', 40, 105, { align: 'center' });

        const d = new Date(data.paymentDate);
        const dayStr = d.getDate().toString().padStart(2, '0');
        const monthStr = (d.getMonth() + 1).toString().padStart(2, '0');
        const yearStr = d.getFullYear().toString();

        doc
          .fontSize(9)
          .font('Helvetica')
          .fillColor('#64748b')
          .text(`Ngay ${dayStr} thang ${monthStr} nam ${yearStr}`, 40, 128, { align: 'center' })
          .font('Helvetica-Bold')
          .fillColor('#4338ca')
          .text(`So phieu: ${data.receiptCode}`, 40, 142, { align: 'center' });

        // 3. Khung chi tiết 5 trường thông tin bắt buộc (SN-209)
        let y = 175;
        const leftCol = 50;
        const valCol = 190;

        doc.roundedRect(40, 165, 515, 175, 8).strokeColor('#e2e8f0').lineWidth(1).stroke();

        // [Trường 1 & 2] Mã duy nhất & Thông tin Đại lý
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text('Ma phieu thu:', leftCol, y)
          .font('Helvetica-Bold')
          .fillColor('#1e293b')
          .text(data.receiptCode, valCol, y);

        y += 20;
        doc
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text('Khach hang / Dai ly:', leftCol, y)
          .font('Helvetica-Bold')
          .fillColor('#0f172a')
          .text(`${data.customerInfo.name} (${data.customerInfo.code})`, valCol, y);

        y += 18;
        doc
          .font('Helvetica')
          .fillColor('#64748b')
          .text('Dien thoai lien he:', leftCol, y)
          .text(data.customerInfo.phone || '---', valCol, y);

        y += 18;
        doc
          .font('Helvetica')
          .fillColor('#64748b')
          .text('Dia chi giao dich:', leftCol, y)
          .text(data.customerInfo.address || '---', valCol, y, { width: 350 });

        y += 24;
        // [Trường 3] Số tiền
        doc
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text('So tien thu (VND):', leftCol, y)
          .font('Helvetica-Bold')
          .fillColor('#047857')
          .fontSize(11)
          .text(data.amountFormatted, valCol, y);

        y += 18;
        doc
          .fontSize(9)
          .font('Helvetica-Oblique')
          .fillColor('#475569')
          .text('Viet bang chu:', leftCol, y)
          .text(data.amountInWords, valCol, y, { width: 350 });

        y += 22;
        // [Trường 4] Hình thức thu
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text('Hinh thuc thanh toan:', leftCol, y)
          .font('Helvetica')
          .fillColor('#1e293b')
          .text(`${data.paymentMethodLabel} (${data.paymentMethod})`, valCol, y);

        y += 18;
        // [Trường 5] Người thu
        doc
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text('Nhan vien lap phieu (Nguoi thu):', leftCol, y)
          .font('Helvetica-Bold')
          .fillColor('#4338ca')
          .text(data.collectorName, valCol, y);

        // 4. Lý do nộp & Chứng từ gốc
        y = 355;
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#475569')
          .text(`Ly do nop: ${data.notes || 'Thanh toan cong no tien hang B2B'}`, 45, y)
          .text(`Chung tu goc kem theo: Hoa don / Don hang ${data.referenceCode || '---'}`, 45, y + 15);

        // 5. Chữ ký các bên
        const sigY = 410;
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#0f172a')
          .text('NGUOI NOP TIEN', 50, sigY, { width: 120, align: 'center' })
          .text('NGUOI THU TIEN', 215, sigY, { width: 120, align: 'center' })
          .text('KE TOAN TRUONG', 380, sigY, { width: 140, align: 'center' });

        doc
          .fontSize(8)
          .font('Helvetica-Oblique')
          .fillColor('#94a3b8')
          .text('(Ky, ghi ro ho ten)', 50, sigY + 14, { width: 120, align: 'center' })
          .text('(Ky, ghi ro ho ten)', 215, sigY + 14, { width: 120, align: 'center' })
          .text('(Ky, dong dau)', 380, sigY + 14, { width: 140, align: 'center' });

        // Tên người ký bên dưới
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#334155')
          .text(data.customerInfo.name, 50, sigY + 80, { width: 120, align: 'center' })
          .text(data.collectorName, 215, sigY + 80, { width: 120, align: 'center' });

        // Chân trang chứng thực
        doc
          .fontSize(7)
          .font('Helvetica')
          .fillColor('#94a3b8')
          .text(
            `Chung tu duoc in tu He Thong Ban Hang & Kho LOHA SALES luc ${new Date().toLocaleString('vi-VN')} | Ma phieu: ${data.receiptCode}`,
            40,
            780,
            { align: 'center' },
          );

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
