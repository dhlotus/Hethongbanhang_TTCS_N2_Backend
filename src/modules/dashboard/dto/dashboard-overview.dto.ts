export interface DailySalesTrendItem {
  date: string;
  value: number;
  ordersCount: number;
}

export interface RegionSalesItem {
  region: string;
  value: number;
  ordersCount: number;
  percentage: number;
}

export interface OverdueAgencyItem {
  customerId: string;
  customerName: string;
  customerCode: string;
  overdueAmount: number;
  oldestOverdueDays: number;
  dueDate?: string;
  salesRepName?: string;
  priorityLabel?: string;
}

export class DashboardOverviewResponseDto {
  metrics: {
    todaySales: number;
    monthlySales: number;
    pendingOrdersCount: number;
    readyToShipOrdersCount: number;
    totalOverdueDebt: number;
    lowStockAlertCount: number;
    salesGrowthPercent?: number; // % Tăng trưởng so với cùng kỳ tháng trước
    prevMonthSamePeriodSales?: number;
  };
  charts: {
    salesTrend: DailySalesTrendItem[]; // Biểu đồ doanh số theo ngày
    salesByRegion: RegionSalesItem[]; // Biểu đồ doanh số theo khu vực
    highRiskAgencies: OverdueAgencyItem[]; // Danh sách đại lý quá hạn công nợ xếp theo số tiền
  };
  executiveInsights: string;
  scopeInfo: {
    period: string;
    scopeLabel: string;
    timeRange: string;
  };
  executionTimeMs: number;
  lastUpdated: string;
}
