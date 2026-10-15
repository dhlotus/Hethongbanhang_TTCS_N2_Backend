/**
 * DTO Trạng thái công nợ của Đại lý (Task SN-41)
 * Trả về chi tiết hạn mức, dư nợ hiện tại, nợ quá hạn và cờ kiểm soát tạo đơn
 */
export class CustomerDebtStatusDto {
  /** ID Đại lý */
  customerId: string;

  /** Mã Đại lý */
  customerCode: string;

  /** Tên Đại lý */
  customerName: string;

  /** Tổng hạn mức công nợ được cấp (VND) */
  creditLimit: number;

  /** Số dư công nợ hiện tại (VND) */
  currentDebt: number;

  /** Hạn mức khả dụng còn lại = creditLimit - currentDebt (VND) */
  availableLimit: number;

  /** Số ngày nợ tối đa cho phép */
  maxDebtDays: number;

  /** Số tiền nợ quá hạn (VND) */
  overdueAmount: number;

  /** Số ngày đã quá hạn lớn nhất của các khoản nợ */
  overdueDays: number;

  /**
   * Cờ cho phép tạo đơn hàng mới:
   * false nếu vi phạm điều kiện quá hạn vượt quá số ngày cho phép (Hard Block)
   * true nếu hợp lệ hoặc chỉ vượt hạn mức (sẽ chuyển sang luồng duyệt)
   */
  canCreateOrder: boolean;

  /** Lý do chặn tạo đơn nếu canCreateOrder = false */
  blockReason?: string;

  /** Cảnh báo hiển thị cho nhân viên kinh doanh */
  warningMessage?: string;
}
