import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { DashboardOverviewResponseDto } from './dto/dashboard-overview.dto';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole, Role } from '../../common/enums/user-role.enum';
import { OrderStatus } from '../orders/entities/order-status.enum';

@Injectable()
export class DashboardService {
  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService: ProductsService,
  ) {}

  async getOverview(currentUser: ICurrentUser, timeRange?: string): Promise<DashboardOverviewResponseDto> {
    const roles = currentUser.roles || [];
    const isManager = roles.some((r: string) => 
      r === UserRole.ADMIN || r === UserRole.SALES_MANAGER || r === Role.BUSINESS_MANAGER
    );
    const isAccountant = roles.some((r: string) => 
      r === UserRole.ACCOUNTANT || r === Role.ACCOUNTANT_DEBT
    );
    const isWarehouse = roles.some((r: string) => 
      r === UserRole.WAREHOUSE || r === UserRole.WAREHOUSE_KEEPER || r === UserRole.WAREHOUSE_MANAGER || r === UserRole.WH_MANAGER
    );
    const isSalesRep = roles.includes(UserRole.SALES_REP);

    // Get all orders (up to 1000 for mock)
    const { data: allOrders } = await this.ordersService.findAllOrders({ limit: 10000 });
    
    // Get all customers
    const allCustomers = await this.customersService.findAllCustomers();

    // Get all products
    const allProducts = await this.productsService.findAll();

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let todaySales = 0;
    let monthlySales = 0;
    let pendingOrdersCount = 0;
    let readyToShipOrdersCount = 0;
    let totalOverdueDebt = 0;
    let lowStockAlertCount = 0;

    const salesTrendMap = new Map<string, number>();

    // Calculate Orders Metrics
    for (const order of allOrders) {
      // Ignore cancelled/draft/returned for sales
      if (order.status !== OrderStatus.CANCELLED && order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.RETURNED) {
        const orderDate = new Date(order.createdAt);
        
        // Sales trend (only for current month)
        if (orderDate >= startOfMonth) {
          const dateStr = orderDate.toISOString().split('T')[0];
          salesTrendMap.set(dateStr, (salesTrendMap.get(dateStr) || 0) + order.grandTotal);
          monthlySales += order.grandTotal;
        }
        
        if (orderDate >= startOfToday) {
          todaySales += order.grandTotal;
        }
      }

      // Pending approval
      if (order.status === OrderStatus.PENDING_APPROVAL || order.status === OrderStatus.PENDING_INVENTORY_APPROVAL) {
        pendingOrdersCount++;
      }

      // Ready to ship
      if (order.status === OrderStatus.APPROVED) {
        readyToShipOrdersCount++;
      }
    }

    // Calculate Customer Debt
    const highRiskAgencies = [];
    for (const customer of allCustomers) {
      if (customer.overdueAmount && customer.overdueAmount > 0) {
        totalOverdueDebt += customer.overdueAmount;
        highRiskAgencies.push({
          customerId: customer.id,
          customerName: customer.name,
          customerCode: customer.code,
          overdueAmount: customer.overdueAmount,
          salesRepName: customer.salesRepName,
        });
      } else if (customer.currentDebt && customer.creditLimit && customer.currentDebt >= customer.creditLimit) {
        // Also consider high risk if over credit limit
        highRiskAgencies.push({
          customerId: customer.id,
          customerName: customer.name,
          customerCode: customer.code,
          overdueAmount: customer.currentDebt - customer.creditLimit,
          salesRepName: customer.salesRepName,
        });
      }
    }

    highRiskAgencies.sort((a, b) => b.overdueAmount - a.overdueAmount);
    const topHighRisk = highRiskAgencies.slice(0, 10);

    // Calculate Low Stock
    for (const product of allProducts) {
      if (product.availableStock !== undefined && product.availableStock <= 10) { // Assuming < 10 is low stock
        lowStockAlertCount++;
      }
    }

    const salesTrend = Array.from(salesTrendMap.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Filter based on roles
    const result = new DashboardOverviewResponseDto();
    
    // Add mock growth percentages for UI demonstration
    const salesGrowthPercent = 12.5; // positive growth
    const debtGrowthPercent = -5.2; // negative growth (good thing)

    result.metrics = {
      todaySales: (isManager || isSalesRep) ? todaySales : 0,
      monthlySales: (isManager || isSalesRep) ? monthlySales : 0,
      pendingOrdersCount: (isManager || isAccountant || isSalesRep) ? pendingOrdersCount : 0,
      readyToShipOrdersCount: (isManager || isWarehouse) ? readyToShipOrdersCount : 0,
      totalOverdueDebt: (isManager || isAccountant) ? totalOverdueDebt : 0,
      lowStockAlertCount: (isManager || isWarehouse) ? lowStockAlertCount : 0,
      salesGrowthPercent: (isManager || isSalesRep) ? salesGrowthPercent : undefined,
      debtGrowthPercent: (isManager || isAccountant) ? debtGrowthPercent : undefined,
    };

    result.charts = {
      salesTrend: (isManager || isSalesRep) ? salesTrend : [],
      highRiskAgencies: (isManager || isAccountant) ? topHighRisk : [],
    };
    
    let insights = 'Tất cả các chỉ số đang ở mức ổn định.';
    if (topHighRisk.length > 0 || lowStockAlertCount > 0) {
      insights = `Hôm nay có ${topHighRisk.length} đại lý vượt hạn mức/công nợ cần thu hồi và ${lowStockAlertCount} SKU dưới định mức tồn kho.`;
    }
    result.executiveInsights = insights;
    result.lastUpdated = new Date().toISOString();

    return result;
  }
}
