import {
  Body,
  Controller,
  Delete,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateDeliveryPointDto } from './dto/create-delivery-point.dto';
import { UpdateDeliveryPointDto } from './dto/update-delivery-point.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { FilterCustomersDto } from './dto/filter-customers.dto';
import { LockCustomerDto } from './dto/lock-customer.dto';
import { CustomerEntity } from './entities/customer.entity';
import { DeliveryPointEntity } from './entities/delivery-point.entity';
import { PaginatedCustomersResult } from './interfaces/paginated-customers.interface';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { CustomerDebtStatusDto } from './dto/customer-debt-status.dto';
import { Public } from '../../common/decorators/public.decorator';
import { AssignSalesRepDto } from './dto/assign-sales-rep.dto';
import { BulkTransferTerritoryDto } from './dto/bulk-transfer-territory.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryAssignmentHistoryDto } from './dto/query-assignment-history.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { OrdersService } from '../orders/orders.service';
import {
  CustomerPurchaseHistoryResponse,
  LatestOrderSummary,
} from '../orders/dto/customer-purchase-history.dto';

/**
 * Controller Quản lý Đại lý & Điểm giao hàng (SN-31, SN-32, SN-35, SN-37 & SN-43)
 */
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    @Optional()
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService?: OrdersService,
  ) {}

  /**
   * Tạo đại lý mới (SN-35)
   * POST /api/customers
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Public()
  async createCustomer(@Body() dto: CreateCustomerDto): Promise<CustomerEntity> {
    return this.customersService.createCustomer(dto);
  }

  /**
   * Lấy lịch sử chuyển giao & phân công địa bàn (SN-35)
   * GET /api/customers/assignment-history
   */
  @Get('assignment-history')
  @Public()
  async getAssignmentHistory(@Query() query: QueryAssignmentHistoryDto): Promise<any> {
    return this.customersService.getAssignmentHistory(query);
  }

  /**
   * Chuyển giao địa bàn hàng loạt khi nhân viên nghỉ việc (SN-35)
   * POST /api/customers/bulk-transfer-territory
   */
  @Post('bulk-transfer-territory')
  @HttpCode(HttpStatus.OK)
  @Public()
  async bulkTransferTerritory(
    @Body() dto: BulkTransferTerritoryDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<any> {
    return this.customersService.bulkTransferTerritory(dto, currentUser);
  }

  /**
   * Gán nhân viên kinh doanh phụ trách chính cho đại lý (SN-35)
   * PATCH /api/customers/:id/assign-sales-rep
   */
  @Patch(':id/assign-sales-rep')
  @Public()
  async assignSalesRep(
    @Param('id') customerId: string,
    @Body() dto: AssignSalesRepDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<CustomerEntity> {
    return this.customersService.assignSalesRep(customerId, dto, currentUser);
  }

  /**
   * Gán nhân viên kinh doanh phụ trách chính cho đại lý (SN-35 alias)
   * PUT /api/customers/:id/sales-rep
   */
  @Put(':id/sales-rep')
  @Public()
  async updateSalesRep(
    @Param('id') customerId: string,
    @Body() dto: AssignSalesRepDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<CustomerEntity> {
    return this.customersService.assignSalesRep(customerId, dto, currentUser);
  }

  /**
   * Lấy danh sách đại lý có hỗ trợ tìm kiếm & lọc linh hoạt (SN-37 & EP-03 / S3-08)
   * GET /api/customers
   */
  @Get()
  @Public()
  @UseGuards(JwtAuthGuard)
  async getCustomers(
    @Query() query: FilterCustomersDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<PaginatedCustomersResult> {
    return this.customersService.filterCustomers(query, currentUser);
  }

  /**
   * Kiểm tra tình trạng công nợ của đại lý trước khi lập đơn (SN-41)
   * GET /api/customers/:id/debt-status
   */
  @Get(':id/debt-status')
  @Public()
  async getCustomerDebtStatus(
    @Param('id') id: string,
  ): Promise<CustomerDebtStatusDto> {
    return this.customersService.getCustomerDebtStatus(id);
  }

  /**
   * Lấy chi tiết đại lý theo ID
   * GET /api/customers/:id
   */
  @Get(':id')
  @Public()
  async getCustomerById(@Param('id') id: string): Promise<CustomerEntity> {
    return this.customersService.getCustomerById(id);
  }

  /**
   * Lấy danh sách điểm giao hàng của đại lý (SN-31 & SN-32)
   * GET /api/customers/:id/delivery-points
   */
  @Get(':id/delivery-points')
  async getDeliveryPoints(
    @Param('id') customerId: string,
  ): Promise<DeliveryPointEntity[]> {
    return this.customersService.getDeliveryPoints(customerId);
  }

  /**
   * Thêm điểm giao hàng mới cho đại lý (SN-31)
   * POST /api/customers/:id/delivery-points
   */
  @Post(':id/delivery-points')
  @HttpCode(HttpStatus.CREATED)
  async createDeliveryPoint(
    @Param('id') customerId: string,
    @Body() dto: CreateDeliveryPointDto,
  ): Promise<DeliveryPointEntity> {
    return this.customersService.createDeliveryPoint(customerId, dto);
  }

  /**
   * Cập nhật điểm giao hàng của đại lý (SN-31)
   * PUT /api/customers/:id/delivery-points/:pointId
   */
  @Put(':id/delivery-points/:pointId')
  async updateDeliveryPoint(
    @Param('id') customerId: string,
    @Param('pointId') pointId: string,
    @Body() dto: UpdateDeliveryPointDto,
  ): Promise<DeliveryPointEntity> {
    return this.customersService.updateDeliveryPoint(customerId, pointId, dto);
  }

  /**
   * Đặt 1 điểm giao hàng làm mặc định (SN-31)
   * PATCH /api/customers/:id/delivery-points/:pointId/default
   */
  @Patch(':id/delivery-points/:pointId/default')
  async setDefaultDeliveryPoint(
    @Param('id') customerId: string,
    @Param('pointId') pointId: string,
  ): Promise<DeliveryPointEntity> {
    return this.customersService.setDefaultDeliveryPoint(customerId, pointId);
  }

  /**
   * Xóa điểm giao hàng của đại lý (SN-31)
   * DELETE /api/customers/:id/delivery-points/:pointId
   */
  @Delete(':id/delivery-points/:pointId')
  async deleteDeliveryPoint(
    @Param('id') customerId: string,
    @Param('pointId') pointId: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.customersService.deleteDeliveryPoint(customerId, pointId);
  }

  /**
   * Khoá giao dịch đại lý - Kế toán công nợ (SN-36)
   * PATCH /api/customers/:id/lock
   */
  @Patch(':id/lock')
  async lockCustomer(
    @Param('id') id: string,
    @Body() dto: LockCustomerDto,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<CustomerEntity> {
    return this.customersService.lockCustomer(id, dto, currentUser);
  }

  /**
   * Mở khoá giao dịch đại lý - Kế toán công nợ (SN-36)
   * PATCH /api/customers/:id/unlock
   */
  @Patch(':id/unlock')
  async unlockCustomer(@Param('id') id: string): Promise<CustomerEntity> {
    return this.customersService.unlockCustomer(id);
  }

  /**
   * Lấy danh sách mặt hàng gợi ý theo lịch sử 3 tháng gần nhất (SN-43 AC1 & AC3)
   * GET /api/customers/:customerId/purchase-history/suggestions
   */
  @Get(':customerId/purchase-history/suggestions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP)
  async getPurchaseHistorySuggestions(
    @Param('customerId') customerId: string,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<CustomerPurchaseHistoryResponse> {
    if (!this.ordersService) {
      throw new Error('OrdersService chưa được khởi tạo');
    }
    return this.ordersService.getPurchaseHistorySuggestions(customerId, currentUser);
  }

  /**
   * Lấy chi tiết đơn hàng thành công gần nhất của đại lý để thêm nhanh vào đơn mới (SN-43 AC2 & AC3)
   * GET /api/customers/:customerId/orders/latest
   */
  @Get(':customerId/orders/latest')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SALES_MANAGER, UserRole.SALES_REP)
  async getLatestOrder(
    @Param('customerId') customerId: string,
    @CurrentUser() currentUser?: ICurrentUser,
  ): Promise<LatestOrderSummary | null> {
    if (!this.ordersService) {
      throw new Error('OrdersService chưa được khởi tạo');
    }
    return this.ordersService.getLatestCustomerOrder(customerId, currentUser);
  }
}
