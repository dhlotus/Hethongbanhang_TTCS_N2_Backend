import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
} from "class-validator";
import { AgencyStatus } from "../enums/agency-status.enum";

/**
 * DTO Tìm kiếm và phân trang danh sách đại lý (JIRA SN-30)
 */
export class QueryAgencyDto {
  /**
   * Từ khóa tìm kiếm (theo mã đại lý, tên, MST, SĐT, người phụ trách)
   */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Lọc theo nhóm khách hàng (bảng giá)
   */
  @IsOptional()
  @IsString()
  customerGroupId?: string;

  /**
   * Lọc theo khu vực
   */
  @IsOptional()
  @IsString()
  region?: string;

  /**
   * Lọc theo trạng thái hoạt động: ACTIVE | INACTIVE
   */
  @IsOptional()
  @IsEnum(AgencyStatus, {
    message: "Trạng thái lọc phải là ACTIVE hoặc INACTIVE",
  })
  status?: AgencyStatus;

  /**
   * Lọc theo người phụ trách
   */
  @IsOptional()
  @IsString()
  assignedUser?: string;

  /**
   * Số trang (bắt đầu từ 1)
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  page?: number;

  /**
   * Số lượng bản ghi trên một trang (mặc định: 10 hoặc 20)
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  limit?: number;
}
