import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditLogsService, PaginatedAuditLogsResult } from './audit-logs.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

/**
 * Controller Nhật ký Kiểm toán hệ thống (Audit Logs - Task SN-142 / SN-19):
 * - Bảo vệ phân quyền nghiêm ngặt: CHỈ người dùng vai trò ADMIN mới được phép truy cập
 * - Read-Only: Tuyệt đối không có các route thêm, sửa, xóa
 */
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  /**
   * Lấy danh sách nhật ký hệ thống có lọc theo thời gian, người dùng, phân hệ và phân trang
   * GET /api/audit-logs
   */
  @Get()
  async findAll(
    @Query() query: QueryAuditLogsDto,
  ): Promise<PaginatedAuditLogsResult> {
    return this.auditLogsService.findAll(query);
  }
}
