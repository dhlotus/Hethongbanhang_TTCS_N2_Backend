import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CustomersService } from '../customers/customers.service';
import { CustomerStatus } from '../customers/entities/customer.entity';
import { CreateOrderDto, CreateOrderLineDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/create-order.dto';
import { OrderLineEntity } from './entities/order-line.entity';
import { OrderEntity, IOrderDeliveryPoint } from './entities/order.entity';
import { OrderStatus, PaymentStatus } from './entities/order-status.enum';

/**
 * Service Quản lý Đặt hàng B2B (SN-38 & SN-39)
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly orders = new Map<string, OrderEntity>();

  constructor(private readonly customersService: CustomersService) {
    this.seedInitialOrders();
  }

  async onModuleInit(): Promise<void> {
    if (this.orders.size === 0) {
      this.seedInitialOrders();
    }
  }

  /**
   * Tạo mã đơn hàng duy nhất tự động: DH-YYMM-XXXXX
   */
  private generateOrderCode(): string {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const randomSeq = Math.floor(10000 + Math.random() * 90000);
    return `DH${yy}${mm}-${randomSeq}`;
  }

  /**
   * Tính toán toàn bộ tổng tiền hàng, chiết khấu và tổng phải thu (SN-38)
   */
  private calculateOrderTotals(linesDto: CreateOrderLineDto[]): {
    lines: OrderLineEntity[];
    subtotal: number;
    totalDiscount: number;
    grandTotal: number;
  } {
    let subtotal = 0;
    let totalDiscount = 0;

    const lines: OrderLineEntity[] = linesDto.map((item, index) => {
      const convRate = item.conversionRate > 0 ? item.conversionRate : 1;
      const baseQty = Math.round(item.quantity * convRate);
      const listPrice = item.listPrice >= 0 ? item.listPrice : item.unitPrice;
      const unitPrice = item.unitPrice >= 0 ? item.unitPrice : listPrice;
      const lineTotal = Math.round(item.quantity * unitPrice);
      const listTotal = Math.round(item.quantity * listPrice);

      subtotal += listTotal;
      totalDiscount += Math.max(0, listTotal - lineTotal);

      return new OrderLineEntity({
        id: `line-${Date.now()}-${index + 1}`,
        productId: item.productId,
        productSku: item.productSku,
        productName: item.productName,
        unit: item.unit,
        baseUnit: item.baseUnit,
        conversionRate: convRate,
        quantity: item.quantity,
        baseQuantity: baseQty,
        unitPrice,
        listPrice,
        discountPercent: item.discountPercent || 0,
        lineTotal,
        stockAvailable: item.stockAvailable,
      });
    });

    const grandTotal = Math.max(0, subtotal - totalDiscount);
    return { lines, subtotal, totalDiscount, grandTotal };
  }

  /**
   * Khởi tạo dữ liệu mẫu thực tế cho đơn hàng
   */
  private seedInitialOrders(): void {
    const initialOrders: OrderEntity[] = [
      new OrderEntity({
        id: 'ord-001',
        orderCode: 'DH2610-10023',
        customerId: 'cust-001',
        customerCode: 'DL-HCM-001',
        customerName: 'Cửa Hàng Thực Phẩm Tiêu Dùng Minh Khang',
        customerGroup: 'AGENT_LEVEL_1',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        deliveryPoint: {
          id: 'dp-001-1',
          name: 'Kho Tổng Phú Nhuận',
          address: '123 Nguyễn Trọng Tuyển, Phường 8, Quận Phú Nhuận, TP.HCM',
          receiverName: 'Anh Nguyễn Minh Khang',
          phone: '0901234567',
          roadNote: 'Đường 2 chiều, xe tải 2.5T vào thoải mái, giao giờ hành chính 8h00 - 17h00',
        },
        deliveryDate: '2026-10-12',
        lines: [
          new OrderLineEntity({
            id: 'line-001-1',
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
            unit: 'Thùng (12 lon)',
            baseUnit: 'Lon',
            conversionRate: 12,
            quantity: 5,
            baseQuantity: 60,
            listPrice: 5400000,
            unitPrice: 5130000,
            discountPercent: 5,
            lineTotal: 25650000,
          }),
          new OrderLineEntity({
            id: 'line-001-2',
            productId: 'prod-002',
            productSku: 'LH-NUT-180ML',
            productName: 'Sữa Hạt Óc Chó Yến Mạch LOHA 180ml',
            unit: 'Thùng (48 hộp)',
            baseUnit: 'Hộp',
            conversionRate: 48,
            quantity: 10,
            baseQuantity: 480,
            listPrice: 620000,
            unitPrice: 589000,
            discountPercent: 5,
            lineTotal: 5890000,
          }),
        ],
        subtotal: 33200000,
        totalDiscount: 1660000,
        grandTotal: 31540000,
        note: 'Giao buổi sáng, gọi trước 30 phút để chuẩn bị thủ kho bốc dỡ',
        status: OrderStatus.APPROVED,
        paymentStatus: PaymentStatus.UNPAID,
        createdAt: new Date('2026-10-06T08:30:00Z'),
        updatedAt: new Date('2026-10-06T09:15:00Z'),
      }),
      new OrderEntity({
        id: 'ord-002',
        orderCode: 'DH2610-10045',
        customerId: 'cust-002',
        customerCode: 'DL-HCM-002',
        customerName: 'Đại Lý Bách Hóa Thực Phẩm Bảo Châu',
        customerGroup: 'AGENT_LEVEL_2',
        salesRepId: 'usr-sale-02',
        salesRepName: 'Nguyễn Thị Hằng',
        deliveryPoint: {
          id: 'dp-002-1',
          name: 'Kho Phân Phối Thủ Đức',
          address: '456 Lê Văn Việt, Phường Tăng Nhơn Phú A, TP. Thủ Đức, TP.HCM',
          receiverName: 'Chị Trần Bảo Châu',
          phone: '0912345678',
          roadNote: 'Hẻm xe tải 8m, vào cổng sắt màu xanh, gọi điện trước khi đến 15 phút',
        },
        deliveryDate: '2026-10-15',
        lines: [
          new OrderLineEntity({
            id: 'line-002-1',
            productId: 'prod-003',
            productSku: 'LH-NEST-70ML',
            productName: 'Nước Yến Sào Nhân Sâm Thượng Hạng LOHA 70ml',
            unit: 'Hộp (6 hũ)',
            baseUnit: 'Hũ',
            conversionRate: 6,
            quantity: 20,
            baseQuantity: 120,
            listPrice: 420000,
            unitPrice: 420000,
            discountPercent: 0,
            lineTotal: 8400000,
          }),
        ],
        subtotal: 8400000,
        totalDiscount: 0,
        grandTotal: 8400000,
        note: 'Hàng dễ vỡ, bốc dỡ cẩn thận',
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.UNPAID,
        createdAt: new Date('2026-10-07T10:00:00Z'),
        updatedAt: new Date('2026-10-07T10:00:00Z'),
      }),
      new OrderEntity({
        id: 'ord-003',
        orderCode: 'DH2610-10088',
        customerId: 'cust-003',
        customerCode: 'DL-HCM-003',
        customerName: 'Siêu Thị Mini Phương Nam Mart',
        customerGroup: 'RETAIL',
        salesRepId: 'usr-sale-01',
        salesRepName: 'Trần Văn Long',
        deliveryPoint: {
          id: 'dp-003-1',
          name: 'Điểm Bán Tân Bình (Mặt Tiền)',
          address: '789 Hoàng Văn Thụ, Phường 4, Quận Tân Bình, TP.HCM',
          receiverName: 'Chị Đỗ Thu Phương',
          phone: '0923456789',
          roadNote: 'Giao vào bãi đỗ xe phía sau siêu thị mini, có thang máy vận chuyển hàng',
        },
        deliveryDate: '2026-10-14',
        lines: [
          new OrderLineEntity({
            id: 'line-003-1',
            productId: 'prod-004',
            productSku: 'LH-CEREAL-500G',
            productName: 'Ngũ Cốc Dinh Dưỡng Hạt Granola LOHA 500g',
            unit: 'Gói',
            baseUnit: 'Gói',
            conversionRate: 1,
            quantity: 30,
            baseQuantity: 30,
            listPrice: 145000,
            unitPrice: 145000,
            discountPercent: 0,
            lineTotal: 4350000,
          }),
        ],
        subtotal: 4350000,
        totalDiscount: 0,
        grandTotal: 4350000,
        note: 'Đơn nháp lưu lại kiểm tra thêm tồn kho',
        status: OrderStatus.DRAFT,
        paymentStatus: PaymentStatus.UNPAID,
        createdAt: new Date('2026-10-07T14:20:00Z'),
        updatedAt: new Date('2026-10-07T14:20:00Z'),
      }),
    ];

    for (const ord of initialOrders) {
      this.orders.set(ord.id, ord);
    }
  }

  /**
   * Tạo đơn hàng mới cho Đại lý (SN-38 & SN-39)
   */
  async createOrder(
    dto: CreateOrderDto,
    salesRep?: { id?: string; name?: string },
  ): Promise<OrderEntity> {
    const customer = await this.customersService.getCustomerById(dto.customerId);

    // Kiểm tra trạng thái đại lý (SN-36: Đại lý bị khóa không tạo được đơn mới, kể cả trên cổng đặt hàng)
    if (customer.status === CustomerStatus.LOCKED) {
      throw new BadRequestException(
        `Đại lý "${customer.name}" đang bị KHÓA GIAO DỊCH (Lý do khóa: ${customer.lockReason || 'Không xác định'}). Không thể tạo đơn hàng mới, kể cả trên cổng đặt hàng!`,
      );
    }

    // Xác thực điểm giao hàng (SN-31: Đơn hàng chọn điểm giao trong danh sách của đúng đại lý đó)
    let assignedDeliveryPoint: IOrderDeliveryPoint | undefined;
    if (dto.deliveryPoint?.id) {
      const matchPoint = customer.deliveryPoints.find((p) => p.id === dto.deliveryPoint?.id);
      if (!matchPoint) {
        throw new BadRequestException(
          `Điểm giao hàng đã chọn không thuộc danh sách điểm giao của đại lý ${customer.name}`,
        );
      }
      assignedDeliveryPoint = {
        id: matchPoint.id,
        name: matchPoint.name,
        address: matchPoint.address,
        receiverName: matchPoint.receiverName,
        phone: matchPoint.phone,
        roadNote: matchPoint.roadNote,
      };
    } else if (dto.deliveryPoint?.address) {
      assignedDeliveryPoint = {
        name: dto.deliveryPoint.name || 'Điểm giao tự chỉ định',
        address: dto.deliveryPoint.address,
        receiverName: dto.deliveryPoint.receiverName || customer.name,
        phone: dto.deliveryPoint.phone || customer.phone,
        roadNote: dto.deliveryPoint.roadNote,
      };
    } else {
      // Mặc định lấy điểm giao hàng isDefault của đại lý
      const defaultPoint = customer.deliveryPoints.find((p) => p.isDefault) || customer.deliveryPoints[0];
      if (defaultPoint) {
        assignedDeliveryPoint = {
          id: defaultPoint.id,
          name: defaultPoint.name,
          address: defaultPoint.address,
          receiverName: defaultPoint.receiverName,
          phone: defaultPoint.phone,
          roadNote: defaultPoint.roadNote,
        };
      }
    }

    // Tính toán chi tiết dòng hàng
    const { lines, subtotal, totalDiscount, grandTotal } = this.calculateOrderTotals(
      dto.lines || [],
    );

    const orderId = `ord-${Date.now()}`;
    const orderCode = this.generateOrderCode();
    const orderStatus = dto.status || OrderStatus.PENDING;

    const newOrder = new OrderEntity({
      id: orderId,
      orderCode,
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      customerGroup: customer.customerGroup,
      salesRepId: salesRep?.id || customer.salesRepId,
      salesRepName: salesRep?.name || customer.salesRepName,
      deliveryPoint: assignedDeliveryPoint,
      deliveryDate: dto.deliveryDate,
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      note: dto.note,
      status: orderStatus,
      paymentStatus: PaymentStatus.UNPAID,
      priceListId: dto.priceListId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    this.orders.set(orderId, newOrder);
    return newOrder;
  }

  /**
   * Lấy danh sách đơn hàng có phân trang & bộ lọc (SN-38)
   */
  async findAllOrders(query: QueryOrdersDto): Promise<{
    data: OrderEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    let list = Array.from(this.orders.values());

    // Sắp xếp đơn mới nhất lên đầu
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (query.status && (query.status as string) !== 'ALL') {
      list = list.filter((o) => o.status === query.status);
    }

    if (query.customerId) {
      list = list.filter((o) => o.customerId === query.customerId);
    }

    if (query.salesRepId) {
      list = list.filter((o) => o.salesRepId === query.salesRepId);
    }

    if (query.search) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.orderCode.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerCode.toLowerCase().includes(q) ||
          o.deliveryPoint?.receiverName.toLowerCase().includes(q) ||
          o.deliveryPoint?.phone.includes(q),
      );
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, query.limit || 10);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const data = list.slice(start, start + limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Bổ sung cảnh báo nếu đại lý của đơn hàng dở đang bị khóa giao dịch (SN-36)
   */
  private async checkAndAttachLockWarning(order: OrderEntity): Promise<OrderEntity> {
    try {
      const customer = await this.customersService.getCustomerById(order.customerId);
      if (customer.status === CustomerStatus.LOCKED) {
        order.isCustomerLocked = true;
        order.warningMessage = `CẢNH BÁO (SN-36): Đại lý "${customer.name}" đang bị KHÓA GIAO DỊCH (Lý do: ${customer.lockReason || 'Không xác định'}). Đơn đang dở vẫn xử lý tiếp được nhưng cần cảnh báo trước khi duyệt/xuất kho.`;
      } else {
        order.isCustomerLocked = false;
        order.warningMessage = undefined;
      }
    } catch {
      // Bỏ qua nếu không tìm thấy đại lý
    }
    return order;
  }

  /**
   * Lấy chi tiết đơn hàng theo ID
   */
  async findOrderById(id: string): Promise<OrderEntity> {
    const order = this.orders.get(id);
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng ${id}`);
    }
    return this.checkAndAttachLockWarning(order);
  }

  /**
   * Cập nhật thông tin đơn hàng (đặc biệt là đơn nháp DRAFT để tiếp tục gõ)
   */
  async updateOrder(id: string, dto: UpdateOrderDto): Promise<OrderEntity> {
    const order = await this.findOrderById(id);

    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('Chỉ có thể chỉnh sửa đơn hàng ở trạng thái Nháp hoặc Chờ duyệt');
    }

    if (dto.customerId && dto.customerId !== order.customerId) {
      const customer = await this.customersService.getCustomerById(dto.customerId);

      if (customer.status === CustomerStatus.LOCKED) {
        throw new BadRequestException(
          `Đại lý "${customer.name}" đang bị KHÓA GIAO DỊCH (Lý do: ${customer.lockReason || 'Không có'}). Không thể đổi đơn hàng sang đại lý bị khóa!`,
        );
      }

      order.customerId = customer.id;
      order.customerCode = customer.code;
      order.customerName = customer.name;
      order.customerGroup = customer.customerGroup;
    }

    if (dto.deliveryPoint) {
      order.deliveryPoint = {
        id: dto.deliveryPoint.id,
        name: dto.deliveryPoint.name || order.deliveryPoint?.name || 'Điểm giao hàng',
        address: dto.deliveryPoint.address,
        receiverName: dto.deliveryPoint.receiverName || order.deliveryPoint?.receiverName || '',
        phone: dto.deliveryPoint.phone || order.deliveryPoint?.phone || '',
        roadNote: dto.deliveryPoint.roadNote,
      };
    }

    if (dto.deliveryDate !== undefined) order.deliveryDate = dto.deliveryDate;
    if (dto.note !== undefined) order.note = dto.note;
    if (dto.status !== undefined) order.status = dto.status;

    if (dto.lines && dto.lines.length > 0) {
      const { lines, subtotal, totalDiscount, grandTotal } = this.calculateOrderTotals(dto.lines);
      order.lines = lines;
      order.subtotal = subtotal;
      order.totalDiscount = totalDiscount;
      order.grandTotal = grandTotal;
    }

    order.updatedAt = new Date();
    return this.checkAndAttachLockWarning(order);
  }

  /**
   * Cập nhật trạng thái đơn hàng (Duyệt, Hủy, Xuất kho...)
   */
  async updateOrderStatus(
    id: string,
    dto: UpdateOrderStatusDto,
  ): Promise<OrderEntity> {
    const order = await this.findOrderById(id);
    order.status = dto.status;
    order.updatedAt = new Date();
    return order;
  }

  /**
   * Xóa đơn hàng (chỉ cho phép xóa đơn Nháp hoặc Đã hủy)
   */
  async deleteOrder(id: string): Promise<{ success: boolean; message: string }> {
    const order = await this.findOrderById(id);
    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Chỉ có thể xóa đơn hàng ở trạng thái Nháp hoặc Đã hủy');
    }
    this.orders.delete(id);
    return { success: true, message: 'Đã xóa đơn hàng thành công' };
  }
}
