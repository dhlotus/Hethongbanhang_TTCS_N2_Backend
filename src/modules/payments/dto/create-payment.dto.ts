import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaymentMethod } from '../../receipts/entities/receipt.entity';

/**
 * DTO Ghi nhận thanh toán và đối trừ công nợ đại lý
 * Subtask: SN-202 (Parent Story: SN-201 / Sprint 7)
 */
export class CreatePaymentDto {
  /**
   * Mã hoặc UUID định danh đại lý cần thu tiền
   */
  @IsNotEmpty({ message: 'Đại lý không được để trống' })
  @IsString({ message: 'Mã hoặc ID đại lý phải là chuỗi ký tự' })
  customerId: string;

  /**
   * Mã đại lý (Ví dụ: DL-0001, DL-0002)
   */
  @IsOptional()
  @IsString({ message: 'Mã đại lý phải là chuỗi ký tự' })
  customerCode?: string;

  /**
   * Tên đại lý
   */
  @IsOptional()
  @IsString({ message: 'Tên đại lý phải là chuỗi ký tự' })
  customerName?: string;

  /**
   * Số tiền thanh toán (VND)
   * Ràng buộc: Không được vượt quá tổng công nợ còn lại của đại lý
   */
  @IsNotEmpty({ message: 'Số tiền thanh toán không được để trống' })
  @IsNumber({}, { message: 'Số tiền thanh toán phải là số hợp lệ' })
  @Min(1000, { message: 'Số tiền thanh toán tối thiểu là 1.000 đ' })
  amount: number;

  /**
   * Hình thức thu tiền (Tiền mặt, Chuyển khoản ngân hàng, Thẻ tín dụng, Séc)
   */
  @IsNotEmpty({ message: 'Hình thức thu tiền không được để trống' })
  @IsEnum(PaymentMethod, {
    message: 'Hình thức thu tiền không hợp lệ. Cho phép: CASH, BANK_TRANSFER, CREDIT_CARD, CHECK',
  })
  paymentMethod: PaymentMethod;

  /**
   * Ngày thu tiền (Định dạng YYYY-MM-DD hoặc ISO string)
   * Mặc định là ngày hiện tại nếu không truyền
   */
  @IsOptional()
  @IsString({ message: 'Ngày thu phải là chuỗi định dạng ngày' })
  paymentDate?: string;

  /**
   * ID người thu tiền (Kế toán công nợ)
   */
  @IsOptional()
  @IsString({ message: 'ID người thu phải là chuỗi ký tự' })
  collectorId?: string;

  /**
   * Tên người thu tiền
   */
  @IsOptional()
  @IsString({ message: 'Tên người thu phải là chuỗi ký tự' })
  collectorName?: string;

  /**
   * Ghi chú chứng từ, tham chiếu ủy nhiệm chi, số hóa đơn
   */
  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi ký tự' })
  note?: string;

  /**
   * Danh sách ID hóa đơn cụ thể muốn đối trừ (AC 2)
   * Nếu để trống, hệ thống tự động đối trừ theo nguyên tắc hóa đơn cũ nhất trước (FIFO)
   */
  @IsOptional()
  @IsArray({ message: 'Danh sách hóa đơn đối trừ phải là một mảng' })
  @IsString({ each: true, message: 'ID hóa đơn phải là chuỗi ký tự' })
  invoiceIds?: string[];

  /**
   * Tùy chọn cờ tự động đối trừ hóa đơn cũ nhất trước (AC 2)
   * Mặc định là true khi không chọn invoiceIds
   */
  @IsOptional()
  @IsBoolean({ message: 'Cờ tự động đối trừ phải là kiểu boolean' })
  autoOffsetOldest?: boolean;
}
