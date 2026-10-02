import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UploadedAvatarFile } from './decorators/uploaded-avatar-file.decorator';
import {
  AvatarResponseDto,
  CreateUserDto,
  QueryUsersDto,
  UpdateUserDto,
  UpdateUserStatusDto,
} from './dto';
import { SafeUser } from './entities/user.entity';
import { AvatarValidationPipe } from './pipes/avatar-validation.pipe';
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
   * Tải lên ảnh đại diện của người dùng đang đăng nhập (SN-144)
   * POST /api/users/me/avatar
   * - Hỗ trợ cả trường 'file' hoặc 'avatar' trong multipart/form-data
   * - Phân quyền: Mọi người dùng đã đăng nhập (cả 7 vai trò) đều được đổi ảnh đại diện cá nhân
   */
  @Post('me/avatar')
  @Roles(...Object.values(UserRole))
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'avatar', maxCount: 1 },
      ],
      {
        storage: multer.memoryStorage(),
        limits: {
          fileSize: 10 * 1024 * 1024,
        },
      },
    ),
  )
  async uploadAvatar(
    @CurrentUser() currentUser: ICurrentUser,
    @UploadedAvatarFile(new AvatarValidationPipe()) file: Express.Multer.File,
  ): Promise<AvatarResponseDto> {
    return this.usersService.uploadAvatar(currentUser.userId, file);
  }

  /**
   * Xóa ảnh đại diện cá nhân, đưa về mặc định
   * DELETE /api/users/me/avatar
   */
  @Delete('me/avatar')
  @Roles(...Object.values(UserRole))
  @HttpCode(HttpStatus.OK)
  async removeAvatar(
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<SafeUser> {
    return this.usersService.removeAvatar(currentUser.userId);
  }

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
