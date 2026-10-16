import { PaymentMethod, ReceiptStatus } from '../entities/receipt.entity';

/**
 * DTO dữ liệu in ấn Phiếu thu tiền (SN-209)
 * Đảm bảo 5 trường thông tin bắt buộc:
 * 1. Mã duy nhất (receiptCode)
 * 2. Thông tin đại lý (customerInfo: tên, mã, SĐT, địa chỉ)
 * 3. Số tiền (amount, amountFormatted, amountInWords)
 * 4. Hình thức thu (paymentMethod, paymentMethodLabel)
 * 5. Người thu (collectorName, collectorInfo)
 */
export class ReceiptPrintDto {
  id: string;
  receiptCode: string;
  code: string;
  customerInfo: {
    id: string;
    code: string;
    name: string;
    phone?: string;
    address?: string;
  };
  amount: number;
  amountFormatted: string;
  amountInWords: string;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  collectorInfo: {
    id: string;
    username?: string;
    name: string;
    role?: string;
  };
  collectorName: string;
  paymentDate: string;
  referenceCode?: string;
  notes?: string;
  status: ReceiptStatus;
  statusLabel: string;
  companyInfo: {
    name: string;
    brand: string;
    address: string;
    phone: string;
    taxCode: string;
    templateCode: string;
  };
}
