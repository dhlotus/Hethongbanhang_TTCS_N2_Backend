import { IsArray, IsNotEmpty, IsOptional, IsString, ArrayMinSize } from 'class-validator';

/**
 * DTO Phát hành hoá đơn bán hàng từ phiếu đã giao (SN-200)
 * Gộp 1 hoặc nhiều phiếu giao hàng của cùng một đại lý
 */
export class IssueInvoiceDto {
  /**
   * Danh sách ID phiếu giao hàng (deliverySlipIds) đã giao thành công
   */
  @IsArray({ message: 'Danh sách mã phiếu giao hàng phải là một mảng' })
  @ArrayMinSize(1, { message: 'Cần chọn ít nhất một phiếu giao hàng để phát hành hoá đơn' })
  @IsString({ each: true, message: 'Mã phiếu giao hàng phải là chuỗi ký tự' })
  deliverySlipIds: string[];

  /**
   * Hạn thanh toán của hoá đơn (YYYY-MM-DD hoặc ISO string)
   * Nếu không truyền, hệ thống tự tính theo số ngày nợ tối đa của đại lý
   */
  @IsOptional()
  @IsString({ message: 'Hạn thanh toán phải là chuỗi định dạng ngày' })
  dueDate?: string;

  /**
   * Ghi chú bổ sung trên hoá đơn
   */
  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi ký tự' })
  note?: string;
}
