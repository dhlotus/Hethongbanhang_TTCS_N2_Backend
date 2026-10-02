import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Express } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import {
  CreateUserDto,
  QueryUsersDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto';
import { SafeUser } from './entities/user.entity';
import type { ExcelImportReport } from './interfaces/excel-import.interface';
import {
  AssignedCustomerItem,
  CreateUserResult,
  PaginatedUsersResult,
  UpdateUserStatusResult,
  UsersService,
} from './users.service';

/**
 * Controller Quản lý Người dùng & Phân quyền Hệ thống (SN-10 & EP-01):
 * - Bảo vệ bởi JwtAuthGuard & RolesGuard
 * - Mặc định từ chối: Chỉ Quản trị viên (ADMIN) mới có quyền truy cập
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * Lấy danh sách người dùng phân trang, tìm kiếm và lọc
   * GET /api/users
   */
  @Get()
  async findAll(@Query() query: QueryUsersDto): Promise<PaginatedUsersResult> {
    return this.usersService.findAll(query);
  }

  /**
   * Lấy thông tin chi tiết một người dùng
   * GET /api/users/:id
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<SafeUser> {
    return this.usersService.findSafeById(id);
  }

  /**
   * Tạo mới tài khoản nhân sự
   * POST /api/users
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateUserDto): Promise<CreateUserResult> {
    return this.usersService.create(dto);
  }

  /**
   * Import tài khoản hàng loạt từ file Excel (SN-16 / Bulk Import)
   * POST /api/users/import-excel
   *
   * Quy trình: Upload file .xlsx → Validate từng dòng → Tạo tài khoản → Trả báo cáo tổng kết
   * Chỉ Admin mới được phép thực hiện (kế thừa guard cấp controller).
   */
  @Post('import-excel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 }, // Giới hạn 10MB
      fileFilter: (
        _req: Express.Request,
        file: Express.Multer.File,
        callback: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const ALLOWED_MIME_TYPES = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
          'application/vnd.ms-excel', // .xls
        ];
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(null, true);
        } else {
          callback(
            new Error('Chỉ chấp nhận file Excel (.xlsx hoặc .xls). File không hợp lệ bị từ chối.'),
            false,
          );
        }
      },
    }),
  )
  async importExcel(
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
      }),
    )
    file: Express.Multer.File,
  ): Promise<ExcelImportReport> {
    return this.usersService.importFromExcel(file.buffer);
  }

  /**
   * Cập nhật thông tin nhân sự
   * PATCH /api/users/:id
   */
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<SafeUser> {
    return this.usersService.update(id, dto, currentUser);
  }

  /**
   * Lấy danh sách đại lý do nhân sự phụ trách kèm cảnh báo bàn giao (SN-15)
   * GET /api/users/:id/assigned-customers
   */
  @Get(':id/assigned-customers')
  async getAssignedCustomers(@Param('id') id: string): Promise<{
    customers: AssignedCustomerItem[];
    total: number;
    warning?: string;
  }> {
    return this.usersService.getAssignedCustomersResult(id);
  }

  /**
   * Khóa hoặc Mở khóa tài khoản nhân sự (Thu hồi toàn bộ phiên đăng nhập khi khóa & Cảnh báo bàn giao)
   * PATCH /api/users/:id/status
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<UpdateUserStatusResult> {
    return this.usersService.updateStatus(id, dto, currentUser);
  }

  /**
   * Admin cấp mã đặt lại mật khẩu cho nhân sự
   * POST /api/users/:id/reset-code
   */
  @Post(':id/reset-code')
  async generateResetCode(
    @Param('id') id: string,
  ): Promise<{ resetCode: string; user: SafeUser }> {
    return this.usersService.generateResetCode(id);
  }
}
