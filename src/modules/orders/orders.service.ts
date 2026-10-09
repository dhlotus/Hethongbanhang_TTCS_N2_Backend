import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { DiscountPoliciesService } from '../discount-policies/discount-policies.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import { PriceListItemEntity } from '../price-lists/entities/price-list-item.entity';
import { CustomersService } from '../customers/customers.service';
import { CustomerStatus } from '../customers/entities/customer.entity';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto, CreateOrderLineDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/create-order.dto';
import { OrderLineEntity } from './entities/order-line.entity';
import { OrderEntity, IOrderDeliveryPoint } from './entities/order.entity';
import { OrderStatus, PaymentStatus } from './entities/order-status.enum';

interface PricedOrderLineDto extends CreateOrderLineDto {
  minPrice?: number;
  requiresApproval?: boolean;
}

interface ResolvedOrderPricing {
  lines: PricedOrderLineDto[];
  priceListId?: string;
}

interface OrderLineCalculation {
  line: OrderLineEntity;
  subtotal: number;
  approvalReason?: string;
}

/**
 * Async Lock ngắn phòng ngừa race condition khi 2 Sales cùng chốt đơn (SN-39)
 */
class AsyncLock {
  private queue: Promise<void> = Promise.resolve();

  async acquire<T>(fn: () => Promise<T> | T): Promise<T> {
    let release: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.queue;
    this.queue = this.queue.then(() => wait);
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }
}

/**
 * Service Quản lý Đặt hàng B2B (SN-38 & SN-39)
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly orders = new Map<string, OrderEntity>();
  private readonly orderLock = new AsyncLock();

  constructor(
    private readonly customersService: CustomersService,
    @Optional() private readonly priceListsService?: PriceListsService,
    @Optional() private readonly discountPoliciesService?: DiscountPoliciesService,
    @Optional()
    @Inject(forwardRef(() => ProductsService))
    private readonly productsService?: ProductsService,
  ) {
    this.seedInitialOrders();
  }

  async onModuleInit(): Promise<void> {
    if (this.orders.size === 0) {
      this.seedInitialOrders();
    }
  }

  /**
   * Tính toán lượng tồn giữ chỗ (reservedStock) của tất cả SKU (SN-39):
   * reservedStock = Tổng số lượng của SKU đó trong các đơn hàng đang ở trạng thái
   * "Chờ duyệt" (PENDING, PENDING_APPROVAL, PENDING_INVENTORY_APPROVAL) hoặc "Đã duyệt - Chưa xuất kho" (APPROVED, PROCESSING).
   */
  getReservedStockMap(excludeOrderId?: string): Map<string, number> {
    const map = new Map<string, number>();
    const reservedStatuses = new Set<OrderStatus>([
      OrderStatus.PENDING,
      OrderStatus.PENDING_APPROVAL,
      OrderStatus.PENDING_INVENTORY_APPROVAL,
      OrderStatus.APPROVED,
      OrderStatus.PROCESSING,
    ]);

    for (const order of this.orders.values()) {
      if (excludeOrderId && order.id === excludeOrderId) continue;
      if (!reservedStatuses.has(order.status)) continue;
      if (!order.lines) continue;

      for (const line of order.lines) {
        const baseQty =
          line.baseQuantity ||
          Math.round((line.quantity || 0) * (line.conversionRate || 1));
        if (line.productId) {
          map.set(line.productId, (map.get(line.productId) || 0) + baseQty);
        }
        if (line.productSku) {
          const upperSku = line.productSku.toUpperCase();
          map.set(upperSku, (map.get(upperSku) || 0) + baseQty);
        }
      }
    }
    return map;
  }

  /**
   * Lấy lượng tồn giữ chỗ của một SKU hoặc Product ID cụ thể (SN-39)
   */
  getReservedStock(productIdOrSku: string, excludeOrderId?: string): number {
    if (!productIdOrSku) return 0;
    const map = this.getReservedStockMap(excludeOrderId);
    return (
      map.get(productIdOrSku) ||
      map.get(productIdOrSku.toUpperCase()) ||
      0
    );
  }

  /**
   * Validation Guard kiểm tra số lượng đặt với tồn khả dụng (SN-39):
   * availableStock = physicalStock - reservedStock
   * Nếu orderQuantity > availableStock: Chặn không cho lưu vào DB, trả về lỗi HTTP 400 Bad Request:
   * "Sản phẩm [Tên SKU] vượt quá tồn khả dụng (Còn tối đa [availableStock] [Đơn vị])"
   */
  validateOrderLinesAvailableStock(
    lines: CreateOrderLineDto[],
    excludeOrderId?: string,
  ): void {
    if (!this.productsService || !lines || lines.length === 0) return;

    for (const line of lines) {
      const product = this.productsService.findProductInternal(
        line.productId || line.productSku,
      );
      if (!product) continue;

      const physicalStock = product.stockQuantity ?? 0;
      const reservedStock = this.getReservedStock(
        product.id || product.sku,
        excludeOrderId,
      );
      const availableStock = Math.max(0, physicalStock - reservedStock);

      const conversionRate = line.conversionRate > 0 ? line.conversionRate : 1;
      const orderBaseQuantity = Math.round(line.quantity * conversionRate);

      if (orderBaseQuantity > availableStock) {
        const maxAllowedInUnit =
          conversionRate > 1
            ? Math.floor(availableStock / conversionRate)
            : availableStock;
        const unitName = line.unit || product.baseUnit;
        const skuName = product.name || line.productName || line.productSku;
        throw new BadRequestException(
          `Sản phẩm ${skuName} vượt quá tồn khả dụng (Còn tối đa ${maxAllowedInUnit} ${unitName})`,
        );
      }
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
  private calculateOrderTotals(linesDto: PricedOrderLineDto[]): {
    lines: OrderLineEntity[];
    subtotal: number;
    totalDiscount: number;
    grandTotal: number;
    requiresApproval: boolean;
    approvalReasons: string[];
  } {
    const calculations = linesDto.map((item, index) =>
      this.calculateOrderLine(item, index),
    );
    const lines = calculations.map(({ line }) => line);
    const subtotal = calculations.reduce((sum, item) => sum + item.subtotal, 0);
    const grandTotal = lines.reduce((sum, item) => sum + item.lineTotal, 0);
    const totalDiscount = subtotal - grandTotal;
    const approvalReasons = calculations
      .map((item) => item.approvalReason)
      .filter((reason): reason is string => Boolean(reason));

    return {
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      requiresApproval: approvalReasons.length > 0,
      approvalReasons,
    };
  }

  private calculateOrderLine(
    item: PricedOrderLineDto,
    index: number,
  ): OrderLineCalculation {
    const conversionRate = item.conversionRate > 0 ? item.conversionRate : 1;
    const baseQuantity = Math.round(item.quantity * conversionRate);
    const listPrice = item.listPrice !== undefined ? item.listPrice : item.unitPrice || 0;
    const unitPrice = item.unitPrice !== undefined ? item.unitPrice : listPrice;
    const lineTotal = Math.round(item.quantity * unitPrice);
    const listTotal = Math.round(item.quantity * listPrice);

    return {
      line: new OrderLineEntity({
        id: `line-${Date.now()}-${index + 1}`,
        productId: item.productId,
        productSku: item.productSku,
        productName: item.productName,
        unit: item.unit,
        baseUnit: item.baseUnit,
        conversionRate,
        quantity: item.quantity,
        baseQuantity,
        unitPrice,
        listPrice,
        discountPercent: item.discountPercent || 0,
        lineTotal,
        stockAvailable: item.stockAvailable,
        minPrice: item.minPrice,
        requiresApproval: item.requiresApproval,
      }),
      subtotal: listTotal,
      approvalReason: item.requiresApproval
        ? `Giá bán SKU ${item.productSku} thấp hơn giá sàn ${item.minPrice?.toLocaleString('vi-VN')} đ`
        : undefined,
    };
  }

  /**
   * Áp giá theo nhóm đại lý và tính lại chiết khấu mỗi khi thay đổi số lượng.
   */
  private resolveOrderPricing(
    lines: CreateOrderLineDto[],
    customerGroup: string,
    requestedPriceListId?: string,
  ): ResolvedOrderPricing {
    if (!this.priceListsService) return { lines };

    let selectedPriceListId: string | undefined;
    const pricedLines = lines.map((line) => {
      const resolved = this.resolveOrderLinePricing(
        line,
        customerGroup,
        requestedPriceListId,
      );
      if (selectedPriceListId && selectedPriceListId !== resolved.priceListId) {
        throw new BadRequestException(
          'Các SKU trong đơn không thuộc cùng một bảng giá đang hiệu lực',
        );
      }
      selectedPriceListId = resolved.priceListId;
      return resolved.line;
    });

    return { lines: pricedLines, priceListId: selectedPriceListId };
  }

  /**
   * Áp giá hiệu lực, chiết khấu theo sản lượng và kiểm tra giá sàn cho một dòng hàng.
   */
  private resolveOrderLinePricing(
    line: CreateOrderLineDto,
    customerGroup: string,
    requestedPriceListId?: string,
  ): { line: PricedOrderLineDto; priceListId: string } {
    const { item, priceListId } = this.findEffectivePriceItem(
      line,
      customerGroup,
      requestedPriceListId,
    );
    const conversionRate = line.conversionRate > 0 ? line.conversionRate : 1;
    if (item.baseUnit && line.baseUnit && item.baseUnit.toLowerCase() !== line.baseUnit.toLowerCase()) {
      // Tự động chuẩn hóa theo đơn vị cơ sở của Bảng giá hiện hành
      line.baseUnit = item.baseUnit;
    } else if (item.baseUnit && !line.baseUnit) {
      line.baseUnit = item.baseUnit;
    }

    const calculatedPrice = this.calculateLinePrices(line, item, conversionRate);

    return {
      priceListId,
      line: {
        ...line,
        ...calculatedPrice,
      },
    };
  }

  private findEffectivePriceItem(
    line: CreateOrderLineDto,
    customerGroup: string,
    requestedPriceListId?: string,
  ): { item: PriceListItemEntity; priceListId: string } {
    const { priceList, item } = this.priceListsService!.findEffectivePrice(
      customerGroup,
      line.productId,
      line.productSku,
    );
    if (requestedPriceListId && requestedPriceListId !== priceList.id) {
      throw new BadRequestException(
        'Bảng giá được chọn không phải bảng giá đang hiệu lực của đại lý',
      );
    }
    return { item, priceListId: priceList.id };
  }

  private calculateLinePrices(
    line: CreateOrderLineDto,
    item: PriceListItemEntity,
    conversionRate: number,
  ): Pick<PricedOrderLineDto, 'listPrice' | 'unitPrice' | 'discountPercent' | 'minPrice' | 'requiresApproval'> {
    const listPrice = Math.round(item.price * conversionRate);
    const baseQuantity = Math.round(line.quantity * conversionRate);
    const tierDiscount =
      this.discountPoliciesService?.calculateBestDiscount(
        line.productId,
        '',
        baseQuantity,
        line.productSku,
      ) || 0;
    const automaticUnitPrice = Math.round(
      (listPrice * (100 - tierDiscount)) / 100,
    );
    if (line.isPriceManuallyEdited && line.unitPrice === undefined) {
      throw new BadRequestException(
        `Vui lòng nhập giá bán thủ công cho SKU ${line.productSku}`,
      );
    }

    const unitPrice = line.isPriceManuallyEdited
      ? line.unitPrice!
      : automaticUnitPrice;
    const minPrice = Math.round(item.minPrice * conversionRate);
    const discountPercent =
      listPrice > 0
        ? Number((((listPrice - unitPrice) / listPrice) * 100).toFixed(2))
        : 0;

    return { listPrice, unitPrice, discountPercent, minPrice, requiresApproval: unitPrice < minPrice };
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
        region: 'Miền Nam',
        note: 'Đơn nháp lưu lại kiểm tra thêm tồn kho',
        status: OrderStatus.DRAFT,
        paymentStatus: PaymentStatus.UNPAID,
        createdAt: new Date('2026-10-07T14:20:00Z'),
        updatedAt: new Date('2026-10-07T14:20:00Z'),
      }),
      new OrderEntity({
        id: 'ord-004',
        orderCode: 'DH2610-10101',
        customerId: 'cust-hn-001',
        customerCode: 'DL-HN-001',
        customerName: 'Đại Lý Thực Phẩm Sạch Thăng Long',
        customerGroup: 'AGENT_LEVEL_1',
        salesRepId: 'usr-sales-002',
        salesRepName: 'Trần Văn Nam',
        region: 'Miền Bắc',
        deliveryPoint: {
          id: 'dp-hn-001-1',
          name: 'Kho Phân Phối Cầu Giấy',
          address: '102 Cầu Giấy, Q. Cầu Giấy, Hà Nội',
          receiverName: 'Anh Vũ Hoàng',
          phone: '0981234561',
        },
        deliveryDate: '2026-10-18',
        lines: [
          new OrderLineEntity({
            id: 'line-004-1',
            productId: 'prod-001',
            productSku: 'LH-MILK-900G',
            productName: 'Sữa Bột Dinh Dưỡng LOHA Gold 900g',
            unit: 'Thùng (12 lon)',
            baseUnit: 'Lon',
            conversionRate: 12,
            quantity: 4,
            baseQuantity: 48,
            listPrice: 5000000,
            unitPrice: 4750000,
            discountPercent: 5,
            lineTotal: 19000000,
          }),
        ],
        subtotal: 20000000,
        totalDiscount: 1000000,
        grandTotal: 19000000,
        note: 'Đơn hàng đại lý miền Bắc',
        status: OrderStatus.APPROVED,
        paymentStatus: PaymentStatus.PAID,
        createdAt: new Date('2026-10-08T09:00:00Z'),
        updatedAt: new Date('2026-10-08T09:30:00Z'),
      }),
      new OrderEntity({
        id: 'ord-005',
        orderCode: 'DH2610-10102',
        customerId: 'cust-dl-0004',
        customerCode: 'DL-0004',
        customerName: 'Công Ty CP Bách Hóa Tiện Lợi Sao Mai',
        customerGroup: 'AGENT_LEVEL_2',
        salesRepId: 'usr-sales-003',
        salesRepName: 'Lê Hoàng Trưởng Phòng',
        region: 'Miền Trung',
        deliveryPoint: {
          id: 'dp-004-1',
          name: 'Kho Đà Nẵng',
          address: '88 Nguyễn Văn Linh, Q. Hải Châu, TP. Đà Nẵng',
          receiverName: 'Anh Nguyễn Sao Mai',
          phone: '0909554433',
        },
        deliveryDate: '2026-10-19',
        lines: [
          new OrderLineEntity({
            id: 'line-005-1',
            productId: 'prod-002',
            productSku: 'LH-NUT-180ML',
            productName: 'Sữa Hạt Óc Chó Yến Mạch LOHA 180ml',
            unit: 'Thùng (48 hộp)',
            baseUnit: 'Hộp',
            conversionRate: 48,
            quantity: 15,
            baseQuantity: 720,
            listPrice: 620000,
            unitPrice: 589000,
            discountPercent: 5,
            lineTotal: 8835000,
          }),
        ],
        subtotal: 9300000,
        totalDiscount: 465000,
        grandTotal: 8835000,
        note: 'Đơn hàng khu vực Miền Trung',
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
        createdAt: new Date('2026-10-08T15:00:00Z'),
        updatedAt: new Date('2026-10-09T08:00:00Z'),
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
    return this.orderLock.acquire(async () => {
      // 0. API Validation Guard (SN-39): Kiểm tra số lượng đặt với tồn khả dụng
      this.validateOrderLinesAvailableStock(dto.lines || []);

      const customer = await this.customersService.getCustomerById(dto.customerId);

    // Kiểm tra trạng thái đại lý (SN-36: Đại lý bị khóa không tạo được đơn mới, kể cả trên cổng đặt hàng)
    if (customer.status === CustomerStatus.LOCKED) {
      throw new BadRequestException(
        `Đại lý "${customer.name}" đang bị KHÓA GIAO DỊCH (Lý do khóa: ${customer.lockReason || 'Không xác định'}). Không thể tạo đơn hàng mới, kể cả trên cổng đặt hàng!`,
      );
    }

    // 1. Kiểm tra điều kiện công nợ của đại lý (Task SN-41)
    const debtStatus = await this.customersService.getCustomerDebtStatus(dto.customerId);

    // Trường hợp 1: Chặn hoàn toàn (Hard Block) nếu nợ quá hạn vượt quá số ngày cho phép
    if (!debtStatus.canCreateOrder) {
      throw new BadRequestException(
        debtStatus.blockReason ||
          'Đại lý có khoản nợ quá hạn vượt quá thời hạn cho phép. Không thể tạo đơn hàng mới.',
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
    const pricing = this.resolveOrderPricing(
      dto.lines || [],
      customer.customerGroup,
      dto.priceListId,
    );
    const {
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      requiresApproval,
      approvalReasons,
    } = this.calculateOrderTotals(pricing.lines);

    // 2. Kiểm tra hạn mức công nợ (Task SN-41 - Approval Flow)
    // Trường hợp 2: Nếu (Tổng tiền đơn hàng mới + Công nợ hiện tại) > Hạn mức công nợ
    const currentDebt = customer.currentDebt || 0;
    const creditLimit = customer.creditLimit || 0;
    const projectedDebt = currentDebt + grandTotal;
    const isCreditLimitExceeded = creditLimit > 0 && projectedDebt > creditLimit;
    const creditLimitExceededAmount = isCreditLimitExceeded
      ? projectedDebt - creditLimit
      : 0;

    const requestedStatus = dto.status || OrderStatus.PENDING;
    let orderStatus =
      requestedStatus === OrderStatus.APPROVED
        ? OrderStatus.PENDING
        : requestedStatus;
    let orderNote = dto.note;

    if (isCreditLimitExceeded && requestedStatus !== OrderStatus.DRAFT) {
      // Tự động đánh dấu đơn hàng ở trạng thái "Cần phê duyệt" (PENDING_APPROVAL)
      orderStatus = OrderStatus.PENDING_APPROVAL;
      const warningNote = `[SN-41 CẢNH BÁO: Đơn hàng làm tổng công nợ đạt ${projectedDebt.toLocaleString('vi-VN')} đ, vượt hạn mức ${creditLimit.toLocaleString('vi-VN')} đ (vượt ${creditLimitExceededAmount.toLocaleString('vi-VN')} đ). Chờ Quản lý/Kế toán phê duyệt]`;
      orderNote = orderNote ? `${orderNote}\n${warningNote}` : warningNote;
    } else if (isCreditLimitExceeded) {
      const warningNote = `[SN-41 CẢNH BÁO: Đơn hàng làm tổng công nợ đạt ${projectedDebt.toLocaleString('vi-VN')} đ, vượt hạn mức ${creditLimit.toLocaleString('vi-VN')} đ (vượt ${creditLimitExceededAmount.toLocaleString('vi-VN')} đ)]`;
      orderNote = orderNote ? `${orderNote}\n${warningNote}` : warningNote;
    }

    const orderId = `ord-${Date.now()}`;
    const orderCode = this.generateOrderCode();

    const newOrder = new OrderEntity({
      id: orderId,
      orderCode,
      customerId: customer.id,
      customerCode: customer.code,
      customerName: customer.name,
      customerGroup: customer.customerGroup,
      salesRepId: salesRep?.id || customer.salesRepId,
      salesRepName: salesRep?.name || customer.salesRepName,
      region: customer.region || (assignedDeliveryPoint?.address?.includes('Hà Nội') ? 'Miền Bắc' : 'Miền Nam'),
      deliveryPoint: assignedDeliveryPoint,
      deliveryDate: dto.deliveryDate,
      lines,
      subtotal,
      totalDiscount,
      grandTotal,
      note: orderNote,
      status: orderStatus,
      paymentStatus: PaymentStatus.UNPAID,
      priceListId: pricing.priceListId || dto.priceListId,
      requiresApproval,
      approvalReasons,
      isCreditLimitExceeded,
      creditLimitExceededAmount,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

      this.orders.set(orderId, newOrder);
      return newOrder;
    });
  }

  /**
   * Lấy danh sách đơn hàng có phân trang & bộ lọc (SN-38, SN-39 & SN-46)
   * - Hỗ trợ lọc theo trạng thái, đại lý, nhân viên, khu vực, khoảng thời gian
   * - Hiển thị tổng tiền của tập kết quả đang lọc (totalAmount)
   * - Phân quyền: Nhân viên kinh doanh (SALES_REP) chỉ thấy đơn của đại lý mình phụ trách
   */
  async findAllOrders(
    query: QueryOrdersDto,
    currentUser?: { id?: string; role?: string; username?: string; roles?: string[] },
  ): Promise<{
    data: OrderEntity[];
    total: number;
    totalAmount: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    let list = Array.from(this.orders.values());

    // Sắp xếp đơn mới nhất lên đầu
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // 1. Phân quyền theo vai trò (SN-46):
    // Nhân viên kinh doanh (SALES_REP) chỉ thấy đơn do mình phụ trách
    const userRole = currentUser?.role || (currentUser?.roles && currentUser.roles[0]);
    const isOnlySalesRep = userRole === 'SALES_REP';

    if (isOnlySalesRep && (currentUser?.id || currentUser?.username)) {
      const repId = currentUser.id;
      const repName = currentUser.username?.toLowerCase();
      list = list.filter((o) => {
        const matchId = repId && o.salesRepId === repId;
        const matchName = repName && o.salesRepName?.toLowerCase().includes(repName);
        return matchId || matchName;
      });
    }

    // 2. Lọc theo trạng thái
    if (query.status && (query.status as string) !== 'ALL') {
      list = list.filter((o) => o.status === query.status);
    }

    // 3. Lọc theo đại lý (customerId)
    if (query.customerId && query.customerId !== 'ALL') {
      list = list.filter(
        (o) => o.customerId === query.customerId || o.customerCode === query.customerId,
      );
    }

    // 4. Lọc theo nhân viên kinh doanh (salesRepId / assignedUser)
    const salesRepFilter = query.salesRepId || query.assignedUser;
    if (salesRepFilter && salesRepFilter !== 'ALL') {
      const repQuery = salesRepFilter.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.salesRepId === salesRepFilter ||
          (o.salesRepName && o.salesRepName.toLowerCase().includes(repQuery)),
      );
    }

    // 5. Lọc theo khu vực (region: Miền Bắc, Miền Trung, Miền Nam...)
    if (query.region && query.region !== 'ALL') {
      const reg = query.region.toLowerCase().trim();
      list = list.filter((o) => {
        const inOrder = o.region && o.region.toLowerCase().includes(reg);
        const inDelivery = o.deliveryPoint?.address?.toLowerCase().includes(reg);
        return inOrder || inDelivery;
      });
    }

    // 6. Lọc theo khoảng thời gian (fromDate, toDate)
    if (query.fromDate) {
      const fromTime = new Date(query.fromDate).getTime();
      if (!isNaN(fromTime)) {
        list = list.filter((o) => new Date(o.createdAt).getTime() >= fromTime);
      }
    }
    if (query.toDate) {
      const toDateObj = new Date(query.toDate);
      toDateObj.setHours(23, 59, 59, 999);
      const toTime = toDateObj.getTime();
      if (!isNaN(toTime)) {
        list = list.filter((o) => new Date(o.createdAt).getTime() <= toTime);
      }
    }

    // 7. Tìm kiếm tự do (mã đơn, mã đại lý, tên đại lý, sđt, người nhận, nhân viên)
    if (query.search) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(
        (o) =>
          o.orderCode.toLowerCase().includes(q) ||
          o.customerName.toLowerCase().includes(q) ||
          o.customerCode.toLowerCase().includes(q) ||
          (o.salesRepName && o.salesRepName.toLowerCase().includes(q)) ||
          o.deliveryPoint?.receiverName.toLowerCase().includes(q) ||
          o.deliveryPoint?.phone.includes(q),
      );
    }

    // 8. Tính tổng tiền của tập kết quả đang lọc (Yêu cầu cốt lõi SN-46)
    const totalAmount = list.reduce((sum, o) => sum + (o.grandTotal || 0), 0);

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, query.limit || 10);
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const data = list.slice(start, start + limit);

    return {
      data,
      total,
      totalAmount,
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
    return this.orderLock.acquire(async () => {
      const order = await this.findOrderById(id);

      if (dto.status !== undefined) {
        if (
          order.status === OrderStatus.DRAFT &&
          (dto.status === OrderStatus.DRAFT || dto.status === OrderStatus.PENDING)
        ) {
          order.status = dto.status;
        } else {
          throw new BadRequestException(
            'Vui lòng cập nhật trạng thái qua chức năng duyệt đơn',
          );
        }
      }

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
      if (dto.lines && dto.lines.length > 0) {
        // API Validation Guard (SN-39): Kiểm tra số lượng đặt với tồn khả dụng (trừ đi đơn hiện tại)
        this.validateOrderLinesAvailableStock(dto.lines, id);

        const pricing = this.resolveOrderPricing(
          dto.lines,
          order.customerGroup || '',
          dto.priceListId,
        );
        const {
          lines,
          subtotal,
          totalDiscount,
          grandTotal,
          requiresApproval,
          approvalReasons,
        } = this.calculateOrderTotals(pricing.lines);
        order.lines = lines;
        order.subtotal = subtotal;
        order.totalDiscount = totalDiscount;
        order.grandTotal = grandTotal;
        order.requiresApproval = requiresApproval;
        order.approvalReasons = approvalReasons;
        order.priceListId = pricing.priceListId || order.priceListId;
      }

      order.updatedAt = new Date();
      return this.checkAndAttachLockWarning(order);
    });
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

  /**
   * Sao chép một đơn cũ thành đơn mới (SN-48)
   * - Sao chép toàn bộ dòng hàng của đơn đã chọn
   * - Giá và chiết khấu được áp lại theo bảng giá hiện hành, không kế thừa giá cũ
   * - Bản sao luôn bắt đầu ở trạng thái Nháp (DRAFT)
   */
  async cloneOrder(
    id: string,
    salesRep?: { id?: string; name?: string },
  ): Promise<OrderEntity> {
    const sourceOrder = await this.findOrderById(id);

    // Sao chép toàn bộ dòng hàng, nhưng KHÔNG truyền unitPrice / listPrice / discountPercent
    // để createOrder tự động tính lại theo bảng giá và chính sách chiết khấu hiện hành
    const linesDto: CreateOrderLineDto[] = sourceOrder.lines.map((line) => ({
      productId: line.productId,
      productSku: line.productSku,
      productName: line.productName,
      unit: line.unit,
      baseUnit: line.baseUnit || line.unit,
      conversionRate: line.conversionRate,
      quantity: line.quantity,
    }));

    const createDto: CreateOrderDto = {
      customerId: sourceOrder.customerId,
      deliveryPoint: sourceOrder.deliveryPoint
        ? {
            id: sourceOrder.deliveryPoint.id,
            address: sourceOrder.deliveryPoint.address,
            name: sourceOrder.deliveryPoint.name,
            receiverName: sourceOrder.deliveryPoint.receiverName,
            phone: sourceOrder.deliveryPoint.phone,
            roadNote: sourceOrder.deliveryPoint.roadNote,
          }
        : undefined,
      deliveryDate: sourceOrder.deliveryDate,
      lines: linesDto,
      note: sourceOrder.note
        ? `[Bản sao từ ${sourceOrder.orderCode}] ${sourceOrder.note}`
        : `Bản sao từ ${sourceOrder.orderCode}`,
      status: OrderStatus.DRAFT,
    };

    return this.createOrder(
      createDto,
      salesRep || { id: sourceOrder.salesRepId, name: sourceOrder.salesRepName },
    );
  }
}
