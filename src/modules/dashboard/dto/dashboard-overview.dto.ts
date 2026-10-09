export class DashboardOverviewResponseDto {
  metrics: {
    todaySales: number;
    monthlySales: number;
    pendingOrdersCount: number;
    readyToShipOrdersCount: number;
    totalOverdueDebt: number;
    lowStockAlertCount: number;
  };
  charts: {
    salesTrend: { date: string; value: number }[];
    highRiskAgencies: {
      customerId: string;
      customerName: string;
      customerCode: string;
      overdueAmount: number;
      salesRepName?: string;
    }[];
  };
}
