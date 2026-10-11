import { AgencyStatus } from "../enums/agency-status.enum";

/**
 * Thực thể Hồ sơ Đại lý (JIRA SN-30)
 * Bảng agencies
 */
export class AgencyEntity {
  /**
   * Khóa chính định danh duy nhất (UUID / string)
   */
  id: string;

  /**
   * Mã đại lý duy nhất trên toàn hệ thống (VD: DL-0001, DL-0002)
   */
  agencyCode: string;

  /**
   * Tên doanh nghiệp / tên đại lý
   */
  name: string;

  /**
   * Mã số thuế doanh nghiệp
   */
  taxCode: string;

  /**
   * Nhóm khách hàng (quyết định bảng giá được áp dụng: AGENT_LEVEL_1, AGENT_LEVEL_2, RETAIL)
   */
  customerGroupId: string;

  /**
   * Khu vực địa lý (VD: Miền Nam, Miền Bắc, Miền Trung, TP.HCM...)
   */
  region: string;

  /**
   * Người phụ trách (nhân viên kinh doanh / Sales Rep phụ trách chăm sóc)
   */
  assignedUser: string;


  /**
   * Trạng thái hồ sơ đại lý: ACTIVE (hoạt động) | INACTIVE (ngừng giao dịch)
   */
  status: AgencyStatus;

  /**
   * Số điện thoại liên hệ
   */
  phone?: string;

  /**
   * Địa chỉ email
   */
  email?: string;

  /**
   * Địa chỉ kinh doanh / trụ sở
   */
  address?: string;

  /**
   * Cờ đánh dấu đại lý đã phát sinh giao dịch đơn hàng hay chưa
   */
  hasOrders?: boolean;

  /**
   * Thời gian khởi tạo hồ sơ
   */
  createdAt: Date;

  /**
   * Thời gian cập nhật gần nhất
   */
  updatedAt: Date;

  constructor(partial: Partial<AgencyEntity>) {
    Object.assign(this, partial);
    this.status = partial.status ?? AgencyStatus.ACTIVE;
    this.taxCode = partial.taxCode ?? "";
    this.region = partial.region ?? "";
    this.assignedUser = partial.assignedUser ?? "";
    this.hasOrders = partial.hasOrders ?? false;
    this.createdAt = partial.createdAt ?? new Date();
    this.updatedAt = partial.updatedAt ?? new Date();
  }
}
