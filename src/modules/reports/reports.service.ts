import { Injectable, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

@Injectable()
export class ReportsService {
  constructor(@Optional() private readonly databaseService?: DatabaseService) {}

  /**
   * Báo cáo kho hàng (WH Manager R, Sales Manager F, Admin F)
   */
  async getInventoryReport(query?: Record<string, string>, currentUser?: ICurrentUser) {
    return {
      reportType: 'INVENTORY',
      generatedAt: new Date(),
      totalWarehouses: 2,
      totalSkus: 25,
      totalPhysicalQuantity: 15420,
      totalReservedQuantity: 840,
      totalAvailableQuantity: 14580,
      lowStockCount: 3,
      items: [
        { sku: 'LH-MILK-900G', name: 'Sữa Bột Loha Canxi 900g', physical: 520, reserved: 45, available: 475 },
        { sku: 'LH-COOKIES-500G', name: 'Bánh Quy Bơ Thượng Hạng', physical: 1200, reserved: 100, available: 1100 },
        { sku: 'LH-COFFEE-3IN1', name: 'Cà Phê Hòa Tan 3in1', physical: 3400, reserved: 250, available: 3150 },
      ],
    };
  }

  /**
   * Báo cáo doanh số bán hàng (Sales Rep R*, Sales Manager F, Admin F)
   */
  async getSalesReport(query?: Record<string, string>, currentUser?: ICurrentUser) {
    const isSalesRep = currentUser?.roles?.includes(UserRole.SALES_REP) && !currentUser?.roles?.includes(UserRole.ADMIN) && !currentUser?.roles?.includes(UserRole.SALES_MANAGER);
    const scope = isSalesRep ? `Tuyến phụ trách của ${currentUser?.username}` : 'Toàn hệ thống';

    return {
      reportType: 'SALES',
      generatedAt: new Date(),
      scope,
      totalOrders: isSalesRep ? 12 : 148,
      totalRevenue: isSalesRep ? 185000000 : 2450000000,
      completedOrders: isSalesRep ? 10 : 135,
      salesRep: isSalesRep ? currentUser?.username : 'Tất cả',
    };
  }

  /**
   * Báo cáo tài chính & công nợ (Accountant R, Sales Manager F, Admin F)
   */
  async getFinanceReport(query?: Record<string, string>, currentUser?: ICurrentUser) {
    return {
      reportType: 'FINANCE_DEBT',
      generatedAt: new Date(),
      totalReceivables: 1845000000,
      overdueReceivables: 245000000,
      collectionRatePercent: 88.5,
      highRiskAgenciesCount: 4,
    };
  }
}
