import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import {
  CreateUserResult,
  PaginatedUsersResult,
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
   * Khóa hoặc Mở khóa tài khoản nhân sự (Thu hồi toàn bộ phiên đăng nhập khi khóa)
   * PATCH /api/users/:id/status
   */
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() currentUser: ICurrentUser,
  ): Promise<SafeUser> {
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
