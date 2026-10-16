import { Test, TestingModule } from '@nestjs/testing';
import { ReceiptsController } from '../src/modules/receipts/receipts.controller';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import { PaymentMethod, ReceiptStatus } from '../src/modules/receipts/entities/receipt.entity';

describe('Receipts Module - SN-209 (In & Tải PDF Phiếu Thu)', () => {
  let controller: ReceiptsController;
  let service: ReceiptsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptsController],
      providers: [ReceiptsService],
    }).compile();

    controller = module.get<ReceiptsController>(ReceiptsController);
    service = module.get<ReceiptsService>(ReceiptsService);
  });

  it('phải được khởi tạo thành công', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it('GET /api/receipts: Lấy danh sách phiếu thu đã ghi nhận', async () => {
    const receipts = await controller.findAll();
    expect(Array.isArray(receipts)).toBe(true);
    expect(receipts.length).toBeGreaterThanOrEqual(1);

    const first = receipts[0];
    expect(first.code).toBeDefined();
    expect(first.customerName).toBeDefined();
    expect(first.amount).toBeGreaterThan(0);
    expect(first.collectorName).toBeDefined();
  });

  it('GET /api/receipts/:id/print: Dữ liệu in phải đảm bảo đủ 5 trường thông tin bắt buộc (SN-209)', async () => {
    const printData = await controller.getPrintData('PT2610-0001');

    // 1. Mã duy nhất
    expect(printData.receiptCode).toBe('PT2610-0001');

    // 2. Thông tin đại lý (tên, mã, SĐT, địa chỉ)
    expect(printData.customerInfo.name).toBe('Đại lý Sữa & Bánh kẹo Miền Bắc');
    expect(printData.customerInfo.code).toBe('DL-0001');
    expect(printData.customerInfo.phone).toBeDefined();
    expect(printData.customerInfo.address).toBeDefined();

    // 3. Số tiền (VND định dạng + bằng chữ tiếng Việt)
    expect(printData.amount).toBe(25000000);
    expect(printData.amountFormatted).toContain('25.000.000');
    expect(printData.amountInWords.toLowerCase()).toContain('hai mươi lăm triệu');

    // 4. Hình thức thu
    expect(printData.paymentMethod).toBe(PaymentMethod.CASH);
    expect(printData.paymentMethodLabel).toBe('Tiền mặt');

    // 5. Người thu (Họ tên nhân viên kế toán lập phiếu)
    expect(printData.collectorName).toBe('Nguyễn Thị Mai');
    expect(printData.collectorInfo.name).toBe('Nguyễn Thị Mai');
  });

  it('GET /api/receipts/:id/pdf: Sinh Buffer file PDF hợp lệ', async () => {
    const result = await service.generatePdfBuffer('PT2610-0001');

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBeGreaterThan(100);
    expect(result.filename).toBe('phieu-thu-PT2610-0001.pdf');

    // Kiểm tra PDF Magic Bytes (%PDF-)
    const magicHeader = result.buffer.subarray(0, 5).toString('ascii');
    expect(magicHeader).toBe('%PDF-');
  });
});
