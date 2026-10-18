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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { CollectionsService } from './collections.service';
import {
  CreateCollectionDto,
  UpdateCollectionStatusDto,
  QueryCollectionDto,
  QueryReconciliationDto,
} from './dto';

@Controller('collections')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  /**
   * 1. Tạo phiếu thu mới kèm upload ảnh biên lai (POST /api/collections)
   * Content-Type: multipart/form-data hoặc application/json
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(
    UserRole.SALES_REP,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
    UserRole.ADMIN,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
  )
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  )
  async create(
    @Body() dto: CreateCollectionDto,
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() currentUser?: ICurrentUser,
  ) {
    const data = await this.collectionsService.create(dto, file, currentUser);
    return {
      success: true,
      message: 'Tạo phiếu thu tiền tuyến thành công, trạng thái đang chờ Kế toán đối chiếu',
      data,
    };
  }

  /**
   * 2. Lấy dữ liệu Bảng đối chiếu tổng hợp (GET /api/collections/reconciliation)
   * Phải đặt trước GET :id để tránh conflict route param
   */
  @Get('reconciliation')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
    UserRole.SALES_REP,
  )
  async getReconciliation(
    @Query() query: QueryReconciliationDto,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    const res = await this.collectionsService.getReconciliation(query, currentUser);
    return {
      success: true,
      data: res.rows,
      summary: res.summary,
    };
  }

  /**
   * 3. Lấy danh sách phiếu thu (GET /api/collections)
   */
  @Get()
  @Roles(
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
  )
  async findAll(
    @Query() query: QueryCollectionDto,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    const res = await this.collectionsService.findAll(query, currentUser);
    return {
      success: true,
      data: res.data,
      summary: res.summary,
    };
  }

  /**
   * 4. Lấy chi tiết phiếu thu (GET /api/collections/:id)
   */
  @Get(':id')
  @Roles(
    UserRole.SALES_REP,
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
  )
  async findById(@Param('id') id: string) {
    const data = await this.collectionsService.findById(id);
    return {
      success: true,
      data,
    };
  }

  /**
   * 5. Kế toán duyệt hoặc từ chối phiếu thu (PATCH /api/collections/:id/status)
   */
  @Patch(':id/status')
  @Roles(
    UserRole.ACCOUNTANT,
    UserRole.ACCOUNTANT_DEBT,
    UserRole.ADMIN,
    UserRole.SALES_MANAGER,
    UserRole.BUSINESS_MANAGER,
  )
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCollectionStatusDto,
    @CurrentUser() currentUser: ICurrentUser,
  ) {
    const data = await this.collectionsService.updateStatus(id, dto, currentUser);
    return {
      success: true,
      message:
        dto.status === 'APPROVED'
          ? 'Đã duyệt phiếu thu và tự động gạch nợ thành công'
          : 'Đã từ chối phiếu thu',
      data,
    };
  }
}
