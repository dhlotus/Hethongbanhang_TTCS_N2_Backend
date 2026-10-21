import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { InventoryService } from '../inventory/inventory.service';
import { DebtReportService } from '../debt-report/debt-report.service';
import {
  DashboardOverviewResponseDto,
  DailySalesTrendItem,
  RegionSalesItem,
  OverdueAgencyItem,
} from './dto/dashboard-overview.dto';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole, Role } from '../../common/enums/user-role.enum';
import { OrderStatus, isRecognizedSalesStatus } from '../orders/entities/order-status.enum';

@Injectable()
export class DashboardService {
  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
    @Inject(forwardRef(() => InventoryService))
    private readonly inventoryService: InventoryService,
    @Inject(forwardRef(() => DebtReportService))
    private readonly debtReportService: DebtReportService,
  ) {}

  async getOverview(
    currentUser: ICurrentUser,
    timeRange?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DashboardOverviewResponseDto> {
    const startTime = performance.now();
    const roles = currentUser.roles || [];
    const isManager = roles.some(
      (r: string) =>
        r === UserRole.ADMIN ||
        r === UserRole.SALES_MANAGER ||
        r === Role.BUSINESS_MANAGER,
    );
    const isAccountant = roles.some(
      (r: string) => r === UserRole.ACCOUNTANT || r === Role.ACCOUNTANT_DEBT,
    );
    const isWarehouse = roles.some(
      (r: string) =>
        r === UserRole.WAREHOUSE ||
        r === UserRole.WAREHOUSE_KEEPER ||
        r === UserRole.WAREHOUSE_MANAGER ||
        r === UserRole.WH_MANAGER,
    );
    const isSalesRep = roles.includes(UserRole.SALES_REP);

    // Truy vấn song song tối ưu hiệu năng (Performance Optimization < 2s)
    const [ordersResult, agingReportResult, allProducts] = await Promise.all([
      this.ordersService.findAllOrders({ limit: 10000 }, currentUser),
      this.debtReportService
        ? this.debtReportService.getAgentDebtReport({}, currentUser).catch(() => null)
        : null,
      this.productsService.findAll(),
    ]);

    const allOrders = ordersResult.data || [];

    // Thời gian chuẩn
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDate = now.getDate();

    const startOfToday = new Date(currentYear, currentMonth, currentDate, 0, 0, 0, 0);
    const endOfToday = new Date(currentYear, currentMonth, currentDate, 23, 59, 59, 999);
    const startOfMonth = new Date(currentYear, currentMonth, 1, 0, 0, 0, 0);

    // Cùng kỳ tháng trước (từ ngày 1 đến cùng ngày của tháng trước)
    const prevMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const startOfPrevMonth = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1, 0, 0, 0, 0);
    const endOfPrevMonthSameDay = new Date(
      prevMonthDate.getFullYear(),
      prevMonthDate.getMonth(),
      Math.min(currentDate, new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0).getDate()),
      23,
      59,
      59,
      999,
    );

    // Xác định khoảng thời gian lọc biểu đồ
    let chartStart = startOfMonth;
    let chartEnd = now;

    if (timeRange === 'today') {
      chartStart = startOfToday;
      chartEnd = endOfToday;
    } else if (timeRange === 'last_month') {
      chartStart = new Date(currentYear, currentMonth - 1, 1, 0, 0, 0, 0);
      chartEnd = new Date(currentYear, currentMonth, 0, 23, 59, 59, 999);
    } else if (timeRange === 'this_quarter') {
      const quarterMonth = Math.floor(currentMonth / 3) * 3;
      chartStart = new Date(currentYear, quarterMonth, 1, 0, 0, 0, 0);
    } else if (timeRange === 'custom' && startDate && endDate) {
      chartStart = new Date(startDate);
      chartStart.setHours(0, 0, 0, 0);
      chartEnd = new Date(endDate);
      chartEnd.setHours(23, 59, 59, 999);
    }

    let todaySales = 0;
    let monthlySales = 0;
    let prevMonthSamePeriodSales = 0;
    let pendingOrdersCount = 0;
    let readyToShipOrdersCount = 0;

    // Biểu đồ theo ngày và theo khu vực
    const dailyTrendMap = new Map<string, { value: number; ordersCount: number }>();
    const regionSalesMap = new Map<string, { value: number; ordersCount: number }>();

    for (const order of allOrders) {
      const orderDate = new Date(order.createdAt);

      // 1. Số đơn chờ duyệt
      if (
        order.status === OrderStatus.PENDING ||
        order.status === OrderStatus.PENDING_APPROVAL ||
        order.status === OrderStatus.PENDING_INVENTORY_APPROVAL
      ) {
        pendingOrdersCount++;
      }

      // 2. Số đơn chờ xuất (Approved, Processing, Packed)
      if (
        order.status === OrderStatus.APPROVED ||
        order.status === OrderStatus.PROCESSING ||
        order.status === OrderStatus.PACKED
      ) {
        readyToShipOrdersCount++;
      }

      // SN-217 & SN-218: Chỉ ghi nhận các đơn hàng có trạng thái ĐÃ ĐƯỢC DUYỆT hoặc giao hàng thành công
      // Tuyệt đối không ghi nhận đơn chờ duyệt (PENDING, PENDING_APPROVAL), nháp, hủy hoặc trả lại
      if (!isRecognizedSalesStatus(order.status)) {
        continue;
      }

      const orderGrandTotal = order.grandTotal || 0;

      // Doanh số hôm nay
      if (orderDate >= startOfToday && orderDate <= endOfToday) {
        todaySales += orderGrandTotal;
      }

      // Doanh số tháng này
      if (orderDate >= startOfMonth && orderDate <= now) {
        monthlySales += orderGrandTotal;
      }

      // Doanh số cùng kỳ tháng trước để tính tăng trưởng thực tế
      if (orderDate >= startOfPrevMonth && orderDate <= endOfPrevMonthSameDay) {
        prevMonthSamePeriodSales += orderGrandTotal;
      }

      // Biểu đồ doanh số theo ngày trong phạm vi lọc
      if (orderDate >= chartStart && orderDate <= chartEnd) {
        const dateKey = orderDate.toISOString().split('T')[0];
        const existingDaily = dailyTrendMap.get(dateKey) || { value: 0, ordersCount: 0 };
        dailyTrendMap.set(dateKey, {
          value: existingDaily.value + orderGrandTotal,
          ordersCount: existingDaily.ordersCount + 1,
        });

        // Biểu đồ theo khu vực
        const regionName = order.region || 'Chưa phân vùng';
        const existingRegion = regionSalesMap.get(regionName) || { value: 0, ordersCount: 0 };
        regionSalesMap.set(regionName, {
          value: existingRegion.value + orderGrandTotal,
          ordersCount: existingRegion.ordersCount + 1,
        });
      }
    }

    // SN-217: Biểu đồ theo ngày phải có ĐỦ TẤT CẢ các ngày trong phạm vi báo cáo; ngày không phát sinh hiển thị 0
    const cursorDate = new Date(chartStart);
    cursorDate.setHours(0, 0, 0, 0);
    const stopDate = new Date(chartEnd);
    stopDate.setHours(0, 0, 0, 0);

    while (cursorDate <= stopDate) {
      const dKey = cursorDate.toISOString().split('T')[0];
      if (!dailyTrendMap.has(dKey)) {
        dailyTrendMap.set(dKey, { value: 0, ordersCount: 0 });
      }
      cursorDate.setDate(cursorDate.getDate() + 1);
    }

    // Tính % Tăng trưởng thực tế so với cùng kỳ tháng trước (Không dùng số mock)
    let salesGrowthPercent: number | undefined = undefined;
    if (prevMonthSamePeriodSales > 0) {
      salesGrowthPercent = Number(
        (((monthlySales - prevMonthSamePeriodSales) / prevMonthSamePeriodSales) * 100).toFixed(1),
      );
    } else if (monthlySales > 0) {
      salesGrowthPercent = 100; // Tăng trưởng 100% khi kỳ trước chưa có số
    } else {
      salesGrowthPercent = 0;
    }

    // Biểu đồ theo ngày: Sắp xếp theo ngày tăng dần
    const salesTrend: DailySalesTrendItem[] = Array.from(dailyTrendMap.entries())
      .map(([date, data]) => ({
        date,
        value: data.value,
        ordersCount: data.ordersCount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Biểu đồ theo khu vực: Tính tỷ lệ % và sắp xếp giảm dần theo doanh số
    const totalRegionSales = Array.from(regionSalesMap.values()).reduce((sum, r) => sum + r.value, 0);
    const salesByRegion: RegionSalesItem[] = Array.from(regionSalesMap.entries())
      .map(([region, data]) => ({
        region,
        value: data.value,
        ordersCount: data.ordersCount,
        percentage:
          totalRegionSales > 0
            ? Number(((data.value / totalRegionSales) * 100).toFixed(1))
            : 0,
      }))
      .sort((a, b) => b.value - a.value);

    // 5. Tính Tổng công nợ quá hạn và Top đại lý quá hạn công nợ (lấy từ DebtReportService chuẩn xác)
    let totalOverdueDebt = 0;
    const highRiskAgencies: OverdueAgencyItem[] = [];

    if (agingReportResult && agingReportResult.data) {
      totalOverdueDebt = agingReportResult.summary?.totalOverdueAmount ?? 0;
      for (const item of agingReportResult.data) {
        if (item.overdueAmount > 0) {
          highRiskAgencies.push({
            customerId: item.agencyId,
            customerName: item.agencyName,
            customerCode: item.agencyCode,
            overdueAmount: item.overdueAmount,
            oldestOverdueDays: item.oldestOverdueDays || 0,
            dueDate: item.asOfDate,
            salesRepName: item.salesRepName,
            priorityLabel: item.priorityLabel || (item.oldestOverdueDays > 60 ? 'Khẩn cấp' : 'Cao'),
          });
        }
      }
    } else {
      // Fallback nếu chưa nạp được DebtReportService
      const allCustomers = await this.customersService.findAllCustomers();
      for (const cust of allCustomers) {
        if (cust.overdueAmount && cust.overdueAmount > 0) {
          totalOverdueDebt += cust.overdueAmount;
          highRiskAgencies.push({
            customerId: cust.id,
            customerName: cust.name,
            customerCode: cust.code,
            overdueAmount: cust.overdueAmount,
            oldestOverdueDays: 15,
            salesRepName: cust.salesRepName,
            priorityLabel: 'Cần thu hồi',
          });
        }
      }
    }

    highRiskAgencies.sort((a, b) => b.overdueAmount - a.overdueAmount);
    const topOverdueAgencies = highRiskAgencies.slice(0, 10);

    // 6. Số SKU dưới tồn tối thiểu: Đếm số SKU duy nhất (Distinct Product SKU) để tránh đếm trùng
    let lowStockAlertCount = 0;
    try {
      const warehouseScope = isWarehouse && currentUser.warehouseId ? currentUser.warehouseId : 'ALL';
      const alerts = await this.inventoryService.getLowStockAlerts(warehouseScope, currentUser);
      // Đếm số SKU duy nhất
      const uniqueSkus = new Set<string>();
      for (const a of alerts) {
        const skuCode = a.sku || (a as any).productSku;
        if (skuCode) {
          uniqueSkus.add(skuCode.trim().toUpperCase());
        }
      }
      lowStockAlertCount = uniqueSkus.size;
    } catch {
      // Fallback từ allProducts
      const uniqueSkus = new Set<string>();
      for (const p of allProducts) {
        if (p.availableStock !== undefined && p.availableStock > 0 && p.availableStock <= 10) {
          uniqueSkus.add(p.sku.trim().toUpperCase());
        }
      }
      lowStockAlertCount = uniqueSkus.size;
    }

    const endTime = performance.now();
    const executionTimeMs = Math.round(endTime - startTime);

    const result = new DashboardOverviewResponseDto();
    result.metrics = {
      todaySales: isManager || isSalesRep ? todaySales : 0,
      monthlySales: isManager || isSalesRep ? monthlySales : 0,
      pendingOrdersCount: isManager || isAccountant || isSalesRep ? pendingOrdersCount : 0,
      readyToShipOrdersCount: isManager || isWarehouse ? readyToShipOrdersCount : 0,
      totalOverdueDebt: isManager || isAccountant ? totalOverdueDebt : 0,
      lowStockAlertCount: isManager || isWarehouse ? lowStockAlertCount : 0,
      salesGrowthPercent: isManager || isSalesRep ? salesGrowthPercent : undefined,
      prevMonthSamePeriodSales: isManager || isSalesRep ? prevMonthSamePeriodSales : undefined,
    };

    result.charts = {
      salesTrend: isManager || isSalesRep ? salesTrend : [],
      salesByRegion: isManager || isSalesRep ? salesByRegion : [],
      highRiskAgencies: isManager || isAccountant ? topOverdueAgencies : [],
    };

    let insights = 'Tất cả các chỉ số hoạt động kinh doanh và kho bãi đang trong tầm kiểm soát.';
    if (topOverdueAgencies.length > 0 || lowStockAlertCount > 0) {
      insights = `Hiện có ${topOverdueAgencies.length} đại lý phát sinh nợ quá hạn cần đôn đốc và ${lowStockAlertCount} SKU dưới ngưỡng tồn tối thiểu cần điều phối.`;
    }

    const scopeLabel = isSalesRep && !isManager
      ? `Tuyến phụ trách: ${currentUser.username || 'Nhân viên kinh doanh'}`
      : 'Toàn hệ thống doanh nghiệp';

    result.executiveInsights = insights;
    result.scopeInfo = {
      period: `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`,
      scopeLabel,
      timeRange: timeRange || 'this_month',
    };
    result.executionTimeMs = executionTimeMs;
    result.lastUpdated = new Date().toISOString();

    return result;
  }
}
