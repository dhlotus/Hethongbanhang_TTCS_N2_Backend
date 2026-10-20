import { Injectable, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

export interface ReturnRequestItem {
  id: string;
  requestCode: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  salesRepId?: string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'RECEIVED' | 'ADJUSTED' | 'REJECTED';
  refundAmount?: number;
  warehouseNote?: string;
  accountantNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ReturnsService {
  private readonly returnRequests = new Map<string, ReturnRequestItem>();

  constructor(@Optional() private readonly databaseService?: DatabaseService) {
    this.seedInitialReturns();
  }

  private seedInitialReturns() {
    const seed: ReturnRequestItem[] = [
      {
        id: 'ret-001',
        requestCode: 'TH2609-001',
        orderId: 'ord-001',
        orderCode: 'DH2609-09876',
        customerId: 'cust-001',
        customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
        salesRepId: 'usr-sale-01',
        reason: 'Hàng móp méo vỏ hộp do vận chuyển',
        status: 'PENDING',
        refundAmount: 1200000,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    for (const r of seed) {
      this.returnRequests.set(r.id, r);
    }
  }

  /**
   * Lấy toàn bộ yêu cầu trả hàng / giảm trừ công nợ (dành cho module Báo cáo công nợ & đối soát)
   */
  async getAllReturns(): Promise<ReturnRequestItem[]> {
    return Array.from(this.returnRequests.values());
  }

  /**
   * Phân quyền Data Scope (*) cho Module 8 (Trả hàng & điều chỉnh):
   * - Customer: W* (Chỉ thấy và tạo yêu cầu trả hàng của chính mình)
   * - Sales Rep: W* (Chỉ thấy và tạo yêu cầu trả hàng cho tuyến mình)
   * - Warehouse: W (Nhận hàng hoàn)
   * - WH Manager: F (Duyệt trả hàng)
   * - Accountant: W (Điều chỉnh công nợ)
   * - Sales Manager: F
   * - Admin: F
   */
  async findAll(
    query?: { status?: ReturnRequestItem['status'] },
    currentUser?: ICurrentUser,
  ): Promise<ReturnRequestItem[]> {
    let list = Array.from(this.returnRequests.values());

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER') ||
        roles.includes(UserRole.WAREHOUSE_MANAGER) ||
        roles.includes(UserRole.WH_MANAGER);

      if (!isManagerOrAdmin) {
        if (roles.includes(UserRole.CUSTOMER)) {
          const targetCustId =
            currentUser.username === 'dealer' ||
            currentUser.email?.includes('dealer') ||
            currentUser.email?.includes('daily')
              ? 'cust-001'
              : currentUser.userId;
          list = list.filter((r) => r.customerId === targetCustId || r.customerId === currentUser.userId);
        } else if (roles.includes(UserRole.SALES_REP)) {
          const repId = currentUser.userId;
          list = list.filter(
            (r) =>
              r.salesRepId === repId ||
              (repId === 'usr-sale-01' && (r.salesRepId === 'usr-sales-002' || r.salesRepId === 'usr-sale-01')) ||
              (repId === 'usr-sales-002' && (r.salesRepId === 'usr-sale-01' || r.salesRepId === 'usr-sales-002')),
          );
        }
      }
    }

    if (query?.status) list = list.filter((r) => r.status === query.status);
    return list;
  }

  async findById(id: string, currentUser?: ICurrentUser): Promise<ReturnRequestItem> {
    const item = this.returnRequests.get(id);
    if (!item) {
      throw new NotFoundException(`Không tìm thấy yêu cầu trả hàng ${id}`);
    }

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER') ||
        roles.includes(UserRole.WAREHOUSE_MANAGER) ||
        roles.includes(UserRole.WH_MANAGER);

      if (!isManagerOrAdmin) {
        if (roles.includes(UserRole.CUSTOMER)) {
          const targetCustId =
            currentUser.username === 'dealer' ||
            currentUser.email?.includes('dealer') ||
            currentUser.email?.includes('daily')
              ? 'cust-001'
              : currentUser.userId;
          if (item.customerId !== targetCustId && item.customerId !== currentUser.userId) {
            throw new ForbiddenException('Bạn chỉ có quyền xem yêu cầu trả hàng của chính đại lý mình');
          }
        } else if (roles.includes(UserRole.SALES_REP)) {
          const repId = currentUser.userId;
          const isAssigned =
            item.salesRepId === repId ||
            (repId === 'usr-sale-01' && (item.salesRepId === 'usr-sales-002' || item.salesRepId === 'usr-sale-01')) ||
            (repId === 'usr-sales-002' && (item.salesRepId === 'usr-sale-01' || item.salesRepId === 'usr-sales-002'));
          if (!isAssigned) {
            throw new ForbiddenException('Bạn chỉ có quyền xem yêu cầu trả hàng thuộc tuyến phụ trách');
          }
        }
      }
    }

    return item;
  }

  async create(dto: Partial<ReturnRequestItem>, currentUser?: ICurrentUser): Promise<ReturnRequestItem> {
    const id = `ret-${Date.now()}`;
    let customerId = dto.customerId || 'cust-001';

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      if (roles.includes(UserRole.CUSTOMER)) {
        const targetCustId =
          currentUser.username === 'dealer' ||
          currentUser.email?.includes('dealer') ||
          currentUser.email?.includes('daily')
            ? 'cust-001'
            : currentUser.userId;
        if (dto.customerId && dto.customerId !== targetCustId && dto.customerId !== currentUser.userId) {
          throw new ForbiddenException('Bạn chỉ có quyền tạo yêu cầu trả hàng cho chính đại lý mình');
        }
        customerId = targetCustId;
      }
    }

    const newRequest: ReturnRequestItem = {
      id,
      requestCode: `TH-${Date.now().toString().slice(-6)}`,
      orderId: dto.orderId || 'ord-unknown',
      orderCode: dto.orderCode || 'DH-UNKNOWN',
      customerId,
      customerName: dto.customerName || 'Đại lý',
      salesRepId: dto.salesRepId || (currentUser?.roles?.includes(UserRole.SALES_REP) ? currentUser.userId : undefined),
      reason: dto.reason || 'Yêu cầu trả hàng',
      status: 'PENDING',
      refundAmount: dto.refundAmount || 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.returnRequests.set(id, newRequest);
    return newRequest;
  }

  async approve(id: string, reviewer?: ICurrentUser): Promise<ReturnRequestItem> {
    const item = await this.findById(id);
    item.status = 'APPROVED';
    item.updatedAt = new Date();
    this.returnRequests.set(id, item);
    return item;
  }

  async receiveStock(id: string, note?: string): Promise<ReturnRequestItem> {
    const item = await this.findById(id);
    item.status = 'RECEIVED';
    if (note) item.warehouseNote = note;
    item.updatedAt = new Date();
    this.returnRequests.set(id, item);
    return item;
  }

  async adjustDebt(id: string, refundAmount?: number, note?: string): Promise<ReturnRequestItem> {
    const item = await this.findById(id);
    item.status = 'ADJUSTED';
    if (refundAmount !== undefined) item.refundAmount = refundAmount;
    if (note) item.accountantNote = note;
    item.updatedAt = new Date();
    this.returnRequests.set(id, item);
    return item;
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findById(id);
    this.returnRequests.delete(id);
    return { success: true, message: `Đã xóa yêu cầu trả hàng ${item.requestCode}` };
  }
}
