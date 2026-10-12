import { Injectable, NotFoundException, ForbiddenException, Optional } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { UserRole } from '../../common/enums/user-role.enum';

export interface ShipmentItem {
  id: string;
  orderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  salesRepId?: string;
  warehouseId?: string;
  status: 'PENDING' | 'PICKING' | 'PACKED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  deliveryAddress?: string;
  receiverName?: string;
  phone?: string;
  trackingNumber?: string;
  carrierName?: string;
  proofOfDeliveryUrl?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ShipmentsService {
  private readonly shipments = new Map<string, ShipmentItem>();

  constructor(@Optional() private readonly databaseService?: DatabaseService) {
    this.seedInitialShipments();
  }

  private seedInitialShipments() {
    const seed: ShipmentItem[] = [
      {
        id: 'shp-001',
        orderId: 'ord-001',
        orderCode: 'DH2609-09876',
        customerId: 'cust-001',
        customerName: 'Đại lý Sữa & Bánh kẹo Miền Bắc',
        salesRepId: 'usr-sale-01',
        warehouseId: 'wh-001',
        status: 'SHIPPED',
        deliveryAddress: 'Kho số 12, KCN Đình Trám, Bắc Giang',
        receiverName: 'Anh Tuấn',
        phone: '0988123456',
        trackingNumber: 'TRK-2026-001',
        carrierName: 'Giao Hàng Nhanh',
        shippedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'shp-002',
        orderId: 'ord-002',
        orderCode: 'DH2609-09877',
        customerId: 'cust-002',
        customerName: 'Đại lý Tạp hóa Hưng Yên',
        salesRepId: 'usr-sale-02',
        warehouseId: 'wh-001',
        status: 'DELIVERED',
        deliveryAddress: 'Số 45 Điện Biên Phủ, TP Hưng Yên',
        receiverName: 'Chị Lan',
        phone: '0912345678',
        trackingNumber: 'TRK-2026-002',
        carrierName: 'Viettel Post',
        shippedAt: new Date(Date.now() - 86400000),
        deliveredAt: new Date(),
        createdAt: new Date(Date.now() - 86400000),
        updatedAt: new Date(),
      },
    ];
    for (const s of seed) {
      this.shipments.set(s.id, s);
    }
  }

  /**
   * Phân quyền Data Scope (*) cho Module 6 (Phiếu xuất & giao hàng):
   * - Customer: R* (Chỉ thấy phiếu xuất của chính mình)
   * - Sales Rep: R* (Chỉ thấy phiếu xuất của tuyến mình)
   */
  async findAll(
    query?: { orderId?: string; status?: ShipmentItem['status'] },
    currentUser?: ICurrentUser,
  ): Promise<ShipmentItem[]> {
    let list = Array.from(this.shipments.values());

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER');

      if (!isManagerOrAdmin) {
        if (roles.includes(UserRole.CUSTOMER)) {
          const targetCustId =
            currentUser.username === 'dealer' ||
            currentUser.email?.includes('dealer') ||
            currentUser.email?.includes('daily')
              ? 'cust-001'
              : currentUser.userId;
          list = list.filter((s) => s.customerId === targetCustId || s.customerId === currentUser.userId);
        } else if (roles.includes(UserRole.SALES_REP)) {
          const repId = currentUser.userId;
          list = list.filter(
            (s) =>
              s.salesRepId === repId ||
              (repId === 'usr-sale-01' && (s.salesRepId === 'usr-sales-002' || s.salesRepId === 'usr-sale-01')) ||
              (repId === 'usr-sales-002' && (s.salesRepId === 'usr-sale-01' || s.salesRepId === 'usr-sales-002')),
          );
        }
      }
    }

    if (query?.orderId) {
      list = list.filter((s) => s.orderId === query.orderId);
    }
    if (query?.status) {
      list = list.filter((s) => s.status === query.status);
    }

    return list;
  }

  async findById(id: string, currentUser?: ICurrentUser): Promise<ShipmentItem> {
    const shipment = this.shipments.get(id);
    if (!shipment) {
      throw new NotFoundException(`Không tìm thấy phiếu xuất kho ${id}`);
    }

    if (currentUser?.roles) {
      const roles = currentUser.roles.map((r) => String(r));
      const isManagerOrAdmin =
        roles.includes(UserRole.ADMIN) ||
        roles.includes(UserRole.SALES_MANAGER) ||
        roles.includes('BUSINESS_MANAGER');

      if (!isManagerOrAdmin) {
        if (roles.includes(UserRole.CUSTOMER)) {
          const targetCustId =
            currentUser.username === 'dealer' ||
            currentUser.email?.includes('dealer') ||
            currentUser.email?.includes('daily')
              ? 'cust-001'
              : currentUser.userId;
          if (shipment.customerId !== targetCustId && shipment.customerId !== currentUser.userId) {
            throw new ForbiddenException('Bạn chỉ có quyền xem phiếu xuất kho của chính đại lý mình');
          }
        } else if (roles.includes(UserRole.SALES_REP)) {
          const repId = currentUser.userId;
          const isAssigned =
            shipment.salesRepId === repId ||
            (repId === 'usr-sale-01' && (shipment.salesRepId === 'usr-sales-002' || shipment.salesRepId === 'usr-sale-01')) ||
            (repId === 'usr-sales-002' && (shipment.salesRepId === 'usr-sale-01' || shipment.salesRepId === 'usr-sales-002'));
          if (!isAssigned) {
            throw new ForbiddenException('Bạn chỉ có quyền xem phiếu xuất kho thuộc tuyến phụ trách');
          }
        }
      }
    }

    return shipment;
  }

  async create(dto: Partial<ShipmentItem>, user?: ICurrentUser): Promise<ShipmentItem> {
    const id = `shp-${Date.now()}`;
    const newShipment: ShipmentItem = {
      id,
      orderId: dto.orderId || 'ord-unknown',
      orderCode: dto.orderCode || 'DH-UNKNOWN',
      customerId: dto.customerId || 'cust-001',
      customerName: dto.customerName || 'Đại lý',
      salesRepId: dto.salesRepId,
      warehouseId: dto.warehouseId || 'wh-001',
      status: dto.status || 'PICKING',
      deliveryAddress: dto.deliveryAddress,
      receiverName: dto.receiverName,
      phone: dto.phone,
      trackingNumber: dto.trackingNumber,
      carrierName: dto.carrierName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.shipments.set(id, newShipment);
    return newShipment;
  }

  async updateStatus(id: string, status: ShipmentItem['status'], dto?: Partial<ShipmentItem>): Promise<ShipmentItem> {
    const shipment = await this.findById(id);
    shipment.status = status;
    shipment.updatedAt = new Date();
    if (dto?.trackingNumber) shipment.trackingNumber = dto.trackingNumber;
    if (dto?.carrierName) shipment.carrierName = dto.carrierName;
    if (dto?.proofOfDeliveryUrl) shipment.proofOfDeliveryUrl = dto.proofOfDeliveryUrl;
    if (status === 'SHIPPED') shipment.shippedAt = new Date();
    if (status === 'DELIVERED') shipment.deliveredAt = new Date();
    this.shipments.set(id, shipment);
    return shipment;
  }

  async confirm(id: string): Promise<ShipmentItem> {
    return this.updateStatus(id, 'DELIVERED');
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const shipment = await this.findById(id);
    this.shipments.delete(id);
    return { success: true, message: `Đã xóa phiếu xuất kho ${shipment.id}` };
  }
}
