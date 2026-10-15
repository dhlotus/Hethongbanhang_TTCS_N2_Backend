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
  Put,
  Query,
} from "@nestjs/common";
import { AgencyService } from "./agency.service";
import { CreateAgencyDto, QueryAgencyDto, UpdateAgencyDto } from "./dto";
import { AgencyEntity } from "./entities/agency.entity";

/**
 * Controller Quản lý Hồ sơ Đại lý (JIRA SN-30)
 * Prefix: /agencies (hoặc /api/agencies qua GlobalPrefix)
 */
@Controller("agencies")
export class AgencyController {
  constructor(private readonly agencyService: AgencyService) {}

  /**
   * Lấy danh sách hồ sơ đại lý (hỗ trợ tìm kiếm, lọc theo nhóm, khu vực, trạng thái, phân trang)
   * GET /api/agencies
   */
  @Get()
  async getAgencies(@Query() query: QueryAgencyDto) {
    if (query?.page || query?.limit) {
      return this.agencyService.findAllPaginated(query);
    }
    return this.agencyService.findAllAgencies(query);
  }

  /**
   * Lấy chi tiết hồ sơ đại lý theo ID hoặc Mã đại lý
   * GET /api/agencies/:id
   */
  @Get(":id")
  async getAgencyById(@Param("id") id: string): Promise<AgencyEntity> {
    return this.agencyService.getAgencyById(id);
  }

  /**
   * Khởi tạo hồ sơ đại lý mới
   * POST /api/agencies
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAgency(@Body() dto: CreateAgencyDto): Promise<AgencyEntity> {
    return this.agencyService.createAgency(dto);
  }

  /**
   * Cập nhật toàn bộ thông tin hồ sơ đại lý
   * PUT /api/agencies/:id
   */
  @Put(":id")
  async updateAgency(
    @Param("id") id: string,
    @Body() dto: UpdateAgencyDto,
  ): Promise<AgencyEntity> {
    return this.agencyService.updateAgency(id, dto);
  }

  /**
   * Cập nhật một phần thông tin hồ sơ đại lý
   * PATCH /api/agencies/:id
   */
  @Patch(":id")
  async patchAgency(
    @Param("id") id: string,
    @Body() dto: UpdateAgencyDto,
  ): Promise<AgencyEntity> {
    return this.agencyService.updateAgency(id, dto);
  }

  /**
   * Ngừng giao dịch đại lý (chuyển trạng thái sang INACTIVE)
   * PATCH /api/agencies/:id/deactivate
   */
  @Patch(":id/deactivate")
  async deactivateAgency(@Param("id") id: string): Promise<AgencyEntity> {
    return this.agencyService.deactivateAgency(id);
  }

  /**
   * Xóa hoặc Ngừng giao dịch đại lý (JIRA SN-30)
   * - Nếu đại lý đã phát sinh giao dịch: Tự động chuyển status sang 'INACTIVE' và KHÔNG XÓA khỏi database.
   * - Nếu đại lý chưa phát sinh giao dịch: Xóa vĩnh viễn khỏi database.
   * DELETE /api/agencies/:id
   */
  @Delete(":id")
  async deleteAgency(@Param("id") id: string) {
    return this.agencyService.deleteAgency(id);
  }
}

export { AgencyController as AgenciesController };
