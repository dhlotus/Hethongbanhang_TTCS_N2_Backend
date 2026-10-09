import { IsEnum, IsOptional, IsString } from "class-validator";
import { AgencyStatus } from "../enums/agency-status.enum";

/**
 * DTO Cập nhật thông tin hồ sơ đại lý (JIRA SN-30)
 */
export class UpdateAgencyDto {
  /**
   * Mã đại lý (duy nhất trên toàn hệ thống)
   */
  @IsOptional()
  @IsString({ message: "Mã đại lý phải là chuỗi ký tự" })
  agencyCode?: string;

  /**
   * Tên đại lý / Doanh nghiệp
   */
  @IsOptional()
  @IsString({ message: "Tên đại lý phải là chuỗi ký tự" })
  name?: string;

  /**
   * Mã số thuế doanh nghiệp
   */
  @IsOptional()
  @IsString({ message: "Mã số thuế phải là chuỗi ký tự" })
  taxCode?: string;

  /**
   * Nhóm khách hàng (quyết định bảng giá: AGENT_LEVEL_1, AGENT_LEVEL_2, RETAIL)
   */
  @IsOptional()
  @IsString({ message: "Nhóm khách hàng phải là chuỗi ký tự" })
  customerGroupId?: string;

  /**
   * Khu vực địa lý
   */
  @IsOptional()
  @IsString({ message: "Khu vực phải là chuỗi ký tự" })
  region?: string;

  /**
   * Người phụ trách (nhân viên kinh doanh / Sales Rep)
   */
  @IsOptional()
  @IsString({ message: "Người phụ trách phải là chuỗi ký tự" })
  assignedUser?: string;

  /**
   * Trạng thái hoạt động: ACTIVE | INACTIVE
   */
  @IsOptional()
  @IsEnum(AgencyStatus, {
    message: "Trạng thái đại lý phải là ACTIVE hoặc INACTIVE",
  })
  status?: AgencyStatus;

  /**
   * Số điện thoại liên lạc
   */
  @IsOptional()
  @IsString({ message: "Số điện thoại phải là chuỗi ký tự" })
  phone?: string;

  /**
   * Email liên lạc
   */
  @IsOptional()
  @IsString({ message: "Email phải là chuỗi ký tự" })
  email?: string;

  /**
   * Địa chỉ kinh doanh
   */
  @IsOptional()
  @IsString({ message: "Địa chỉ phải là chuỗi ký tự" })
  address?: string;
}
