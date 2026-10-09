import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DiscountPoliciesService } from '../discount-policies/discount-policies.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import { PriceListItemEntity } from '../price-lists/entities/price-list-item.entity';
import { CustomersService } from '../customers/customers.service';
import { CreateOrderDto, CreateOrderLineDto } from './dto/create-order.dto';
import { QueryOrdersDto } from './dto/query-orders.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { UpdateOrderStatusDto } from './dto/create-order.dto';
import { OrderLineEntity } from './entities/order-line.entity';
import { OrderEntity, IOrderDeliveryPoint } from './entities/order.entity';
import { OrderStatus, PaymentStatus } from './entities/order-status.enum';
import { DatabaseService } from '../../database/database.service';
import { ProductsService } from '../products/products.service';
import { DecideOrderDto } from './dto/decide-order.dto';
import { OrderApprovalAction } from './entities/order-approval-action.enum';
import { OrderApprovalHistoryEntity } from './entities/order-approval-history.entity';
import { ICurrentUser } from '../auth/interfaces/current-user.interface';
import { InventoryService } from '../inventory/inventory.service';

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
 * Service Quản lý Đặt hàng B2B (SN-38 & SN-39)
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly orders = new Map<string, OrderEntity>();
  private readonly memoryApprovalHistory = new Map<string, OrderApprovalHistoryEntity[]>();

  constructor(
    private readonly customersService: CustomersService,
    @Optional() private readonly priceListsService?: PriceListsService,
    @Optional() private readonly discountPoliciesService?: DiscountPoliciesService,
    @Optional() private readonly databaseService?: DatabaseService,
    @Optional() private readonly productsService?: ProductsService,
    @Optional() private readonly inventoryService?: InventoryService,
  ) {
    if (!this.databaseService) {
      for (const order of this.seedInitialOrders()) this.orders.set(order.id, order);
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.databaseService) return;

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_records (
        id TEXT PRIMARY KEY,
        order_code TEXT NOT NULL UNIQUE,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.databaseService.query(
      'CREATE INDEX IF NOT EXISTS idx_app_order_records_created_at ON app_order_records(created_at DESC)',
    );

    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_storage_state (
        state_key TEXT PRIMARY KEY,
        seeded BOOLEAN NOT NULL DEFAULT FALSE
      )
    `);
    await this.ensureApprovalTables();
    const client = await this.databaseService.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app_order_storage_state (state_key, seeded)
         VALUES ('orders', FALSE) ON CONFLICT (state_key) DO NOTHING`,
      );
      const stateResult = await client.query(
        `SELECT seeded FROM app_order_storage_state WHERE state_key = 'orders' FOR UPDATE`,
      );
      if (!stateResult.rows[0]?.seeded) {
        const countResult = await client.query(
          'SELECT COUNT(*)::int AS count FROM app_order_records',
        );
        if (Number(countResult.rows[0]?.count ?? 0) === 0) {
          for (const order of this.seedInitialOrders()) {
            await client.query(
              `INSERT INTO app_order_records (id, order_code, payload, created_at, updated_at)
               VALUES ($1, $2, $3::jsonb, $4, $5)
               ON CONFLICT (id) DO NOTHING`,
              [order.id, order.orderCode, JSON.stringify(order), order.createdAt, order.updatedAt],
            );
          }
        }
        await client.query(
          `UPDATE app_order_storage_state SET seeded = TRUE WHERE state_key = 'orders'`,
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ensureApprovalTables(): Promise<void> {
    if (!this.databaseService) return;
    await this.ensureApprovalHistoryTable();
    await this.ensureInventoryReservationTable();
    await this.ensureApprovalHistoryImmutability();
  }

  private async ensureApprovalHistoryTable(): Promise<void> {
    if (!this.databaseService) return;
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_approval_history (
        id BIGSERIAL PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES app_order_records(id) ON DELETE RESTRICT,
        action VARCHAR(30) NOT NULL CHECK (action IN ('APPROVE', 'REJECT', 'RETURN_FOR_UPDATE')),
        comment TEXT,
        approver_id TEXT NOT NULL,
        approver_name TEXT NOT NULL,
        approver_roles TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.databaseService.query(`
      CREATE INDEX IF NOT EXISTS idx_app_order_approval_history_order
      ON app_order_approval_history(order_id, created_at DESC, id DESC)
    `);
  }

  private async ensureInventoryReservationTable(): Promise<void> {
    if (!this.databaseService) return;
    await this.databaseService.query(`
      CREATE TABLE IF NOT EXISTS app_order_inventory_reservations (
        id BIGSERIAL PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES app_order_records(id) ON DELETE RESTRICT,
        order_line_id TEXT NOT NULL,
        product_sku TEXT NOT NULL,
        base_quantity NUMERIC(15, 2) NOT NULL CHECK (base_quantity > 0),
        status VARCHAR(20) NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'RELEASED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        released_at TIMESTAMPTZ
      )
    `);
    await this.databaseService.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_app_order_active_line_reservation
      ON app_order_inventory_reservations(order_id, order_line_id)
      WHERE status = 'RESERVED'
    `);
    await this.databaseService.query(`
      CREATE INDEX IF NOT EXISTS idx_app_order_active_sku_reservations
      ON app_order_inventory_reservations(product_sku)
      WHERE status = 'RESERVED'
    `);
  }

  private async ensureApprovalHistoryImmutability(): Promise<void> {
    if (!this.databaseService) return;
    await this.databaseService.query(`
      CREATE OR REPLACE FUNCTION app_reject_order_approval_history_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Order approval history is append-only';
      END;
      $$ LANGUAGE plpgsql
    `);
    await this.databaseService.query(`
      DROP TRIGGER IF EXISTS trg_app_order_approval_history_immutable
      ON app_order_approval_history
    `);
    await this.databaseService.query(`
      CREATE TRIGGER trg_app_order_approval_history_immutable
      BEFORE UPDATE OR DELETE ON app_order_approval_history
      FOR EACH ROW EXECUTE FUNCTION app_reject_order_approval_history_mutation()
    `);
  }

  private restoreOrder(payload: unknown): OrderEntity {
    const parsed = (typeof payload === 'string' ? JSON.parse(payload) : payload) as
      | (Partial<OrderEntity> & { createdAt?: string | Date; updatedAt?: string | Date })
      | null;
    if (!parsed) throw new Error('Bản ghi đơn hàng trong PostgreSQL không hợp lệ.');
    return new OrderEntity({
      ...parsed,
      createdAt: parsed.createdAt ? new Date(parsed.createdAt) : new Date(),
      updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : new Date(),
    });
  }

  private async saveOrder(order: OrderEntity): Promise<void> {
    if (!this.databaseService) {
      this.orders.set(order.id, order);
      return;
    }
    await this.databaseService.query(
      `INSERT INTO app_order_records (id, order_code, payload, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         order_code = EXCLUDED.order_code,
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at`,
      [order.id, order.orderCode, JSON.stringify(order), order.createdAt, order.updatedAt],
    );
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
        ? `SKU ${item.productSku}: giá bán ${unitPrice.toLocaleString('vi-VN')} đ thấp hơn giá sàn ${item.minPrice?.toLocaleString('vi-VN')} đ`
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
    if (item.baseUnit && item.baseUnit.toLowerCase() !== line.baseUnit.toLowerCase()) {
      throw new BadRequestException(
        `Đơn vị cơ sở của SKU ${line.productSku} không khớp với bảng giá`,
      );
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
  private seedInitialOrders(): OrderEntity[] {
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

    return initialOrders;
  }

  /**
   * Tạo đơn hàng mới cho Đại lý (SN-38 & SN-39)
   */
  async createOrder(
    dto: CreateOrderDto,
    salesRep?: { id?: string; name?: string },
  ): Promise<OrderEntity> {
    const customer = await this.customersService.getCustomerById(dto.customerId);

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
    const requiresOrderApproval = requiresApproval || isCreditLimitExceeded;
    let orderStatus = requestedStatus === OrderStatus.APPROVED
      ? OrderStatus.PENDING
      : requestedStatus;
    let orderNote = dto.note;
    const orderApprovalReasons = [...approvalReasons];

    if (isCreditLimitExceeded) {
      orderApprovalReasons.push(
        `Vượt hạn mức công nợ ${creditLimitExceededAmount.toLocaleString('vi-VN')} đ (công nợ dự kiến ${projectedDebt.toLocaleString('vi-VN')} đ / hạn mức ${creditLimit.toLocaleString('vi-VN')} đ)`,
      );
      const warningNote = `[SN-41 CẢNH BÁO: Đơn hàng làm tổng công nợ đạt ${projectedDebt.toLocaleString('vi-VN')} đ, vượt hạn mức ${creditLimit.toLocaleString('vi-VN')} đ (vượt ${creditLimitExceededAmount.toLocaleString('vi-VN')} đ). Chờ Quản lý/Kế toán phê duyệt]`;
      orderNote = orderNote ? `${orderNote}\n${warningNote}` : warningNote;
    }
    if (requiresOrderApproval && orderStatus !== OrderStatus.DRAFT) {
      orderStatus = OrderStatus.PENDING_APPROVAL;
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
      requiresApproval: requiresOrderApproval,
      approvalReasons: orderApprovalReasons,
      isCreditLimitExceeded,
      creditLimitExceededAmount,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await this.saveOrder(newOrder);
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
    let list = this.databaseService
      ? (await this.databaseService.query<{ [key: string]: unknown; payload: unknown }>(
          'SELECT payload FROM app_order_records ORDER BY created_at DESC',
        )).map((row) => this.restoreOrder(row.payload))
      : Array.from(this.orders.values());

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
   * Lấy chi tiết đơn hàng theo ID
   */
  async findOrderById(id: string): Promise<OrderEntity> {
    const rows = this.databaseService
      ? await this.databaseService.query<{ [key: string]: unknown; payload: unknown }>(
          'SELECT payload FROM app_order_records WHERE id = $1',
          [id],
        )
      : [];
    const order = this.databaseService
      ? (rows[0] ? this.restoreOrder(rows[0].payload) : undefined)
      : this.orders.get(id);
    if (!order) {
      throw new NotFoundException(`Không tìm thấy đơn hàng ${id}`);
    }
    return order;
  }

  async getApprovalHistory(orderId: string): Promise<OrderApprovalHistoryEntity[]> {
    await this.findOrderById(orderId);
    if (!this.databaseService) return this.memoryApprovalHistory.get(orderId) ?? [];
    const rows = await this.databaseService.query<{
      [key: string]: unknown;
      id: number;
      order_id: string;
      action: OrderApprovalAction;
      comment: string | null;
      approver_id: string;
      approver_name: string;
      approver_roles: string[];
      created_at: Date;
    }>(
      `SELECT id, order_id, action, comment, approver_id, approver_name,
              approver_roles, created_at
       FROM app_order_approval_history
       WHERE order_id = $1
       ORDER BY created_at DESC, id DESC`,
      [orderId],
    );
    return rows.map((row) => this.toApprovalHistoryEntity(row));
  }

  private toApprovalHistoryEntity(row: {
    id: number;
    order_id: string;
    action: OrderApprovalAction;
    comment: string | null;
    approver_id: string;
    approver_name: string;
    approver_roles: string[];
    created_at: Date;
  }): OrderApprovalHistoryEntity {
    return new OrderApprovalHistoryEntity({
      id: row.id,
      orderId: row.order_id,
      action: row.action,
      comment: row.comment,
      approverId: row.approver_id,
      approverName: row.approver_name,
      approverRoles: row.approver_roles,
      createdAt: new Date(row.created_at),
    });
  }

  async decideOrder(
    orderId: string,
    dto: DecideOrderDto,
    reviewer: ICurrentUser,
  ): Promise<OrderEntity> {
    if (dto.action !== OrderApprovalAction.APPROVE && !dto.comment?.trim()) {
      throw new BadRequestException('Từ chối hoặc trả lại đơn cần có ý kiến.');
    }
    if (!this.databaseService) {
      return this.decideOrderInMemory(orderId, dto, reviewer);
    }

    if (dto.action === OrderApprovalAction.APPROVE) {
      if (!this.inventoryService) {
        throw new InternalServerErrorException('Dịch vụ tồn kho chưa được cấu hình.');
      }
      await this.inventoryService.ensureStockBalanceTable();
    }

    const client = await this.databaseService.getClient();
    try {
      await client.query('BEGIN');
      const order = await this.loadLockedOrder(client, orderId);
      this.ensureOrderCanBeDecided(order, dto.action);
      if (dto.action === OrderApprovalAction.APPROVE) {
        await this.reserveOrderInventory(client, order);
      }
      this.applyApprovalDecision(order, dto.action);
      await this.saveDecision(client, order, dto, reviewer);
      await client.query('COMMIT');
      return order;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadLockedOrder(client: PoolClient, orderId: string): Promise<OrderEntity> {
    const result = await client.query<{ payload: unknown }>(
      'SELECT payload FROM app_order_records WHERE id = $1 FOR UPDATE',
      [orderId],
    );
    if (!result.rows[0]) throw new NotFoundException(`Không tìm thấy đơn hàng ${orderId}`);
    return this.restoreOrder(result.rows[0].payload);
  }

  private ensureOrderCanBeDecided(order: OrderEntity, action: OrderApprovalAction): void {
    const canApprove = [OrderStatus.PENDING, OrderStatus.PENDING_APPROVAL].includes(order.status);
    const canRejectOrReturn = canApprove;
    if (!canApprove || (action !== OrderApprovalAction.APPROVE && !canRejectOrReturn)) {
      throw new BadRequestException('Đơn hàng không còn ở trạng thái có thể xét duyệt.');
    }
  }

  private applyApprovalDecision(order: OrderEntity, action: OrderApprovalAction): void {
    const statusByAction: Record<OrderApprovalAction, OrderStatus> = {
      [OrderApprovalAction.APPROVE]: OrderStatus.APPROVED,
      [OrderApprovalAction.REJECT]: OrderStatus.REJECTED,
      [OrderApprovalAction.RETURN_FOR_UPDATE]: OrderStatus.RETURNED_FOR_UPDATE,
    };
    order.status = statusByAction[action];
    order.updatedAt = new Date();
  }

  private async saveDecision(
    client: PoolClient,
    order: OrderEntity,
    dto: DecideOrderDto,
    reviewer: ICurrentUser,
  ): Promise<void> {
    await client.query(
      `UPDATE app_order_records SET payload = $2::jsonb, updated_at = $3 WHERE id = $1`,
      [order.id, JSON.stringify(order), order.updatedAt],
    );
    await client.query(
      `INSERT INTO app_order_approval_history
       (order_id, action, comment, approver_id, approver_name, approver_roles)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        order.id,
        dto.action,
        dto.comment?.trim() || null,
        reviewer.userId,
        reviewer.username || reviewer.email || reviewer.userId,
        reviewer.roles,
      ],
    );
  }

  private async reserveOrderInventory(client: PoolClient, order: OrderEntity): Promise<void> {
    if (!this.productsService || !this.inventoryService) {
      throw new InternalServerErrorException('Dịch vụ tồn kho chưa được cấu hình.');
    }
    const linesBySku = this.groupOrderLinesBySku(order.lines);
    for (const [sku, lines] of [...linesBySku.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sku]);
      const product = await this.productsService.findById(sku);
      const physicalQuantity = await this.inventoryService.getStockBalanceForUpdate(client, product);
      const reservationResult = await client.query<{ reserved: string }>(
        `SELECT COALESCE(SUM(base_quantity), 0)::text AS reserved
         FROM app_order_inventory_reservations
         WHERE product_sku = $1 AND status = 'RESERVED'`,
        [sku],
      );
      const required = lines.reduce((sum, line) => sum + line.baseQuantity, 0);
      const available = physicalQuantity - Number(reservationResult.rows[0]?.reserved ?? 0);
      if (required > available) {
        throw new BadRequestException(
          `Không đủ tồn khả dụng cho SKU ${sku}: còn ${available}, cần giữ ${required}.`,
        );
      }
    }
    for (const line of order.lines) {
      await client.query(
        `INSERT INTO app_order_inventory_reservations
         (order_id, order_line_id, product_sku, base_quantity)
         VALUES ($1, $2, $3, $4)`,
        [order.id, line.id, line.productSku.trim().toUpperCase(), line.baseQuantity],
      );
    }
  }

  private groupOrderLinesBySku(lines: OrderLineEntity[]): Map<string, OrderLineEntity[]> {
    const grouped = new Map<string, OrderLineEntity[]>();
    for (const line of lines) {
      const sku = line.productSku.trim().toUpperCase();
      const skuLines = grouped.get(sku) ?? [];
      skuLines.push(line);
      grouped.set(sku, skuLines);
    }
    return grouped;
  }

  private async decideOrderInMemory(
    orderId: string,
    dto: DecideOrderDto,
    reviewer: ICurrentUser,
  ): Promise<OrderEntity> {
    const order = await this.findOrderById(orderId);
    this.ensureOrderCanBeDecided(order, dto.action);
    this.applyApprovalDecision(order, dto.action);
    await this.saveOrder(order);
    const history = this.memoryApprovalHistory.get(orderId) ?? [];
    history.push(new OrderApprovalHistoryEntity({
      id: Date.now(),
      orderId,
      action: dto.action,
      comment: dto.comment?.trim() || null,
      approverId: reviewer.userId,
      approverName: reviewer.username || reviewer.email || reviewer.userId,
      approverRoles: reviewer.roles,
      createdAt: new Date(),
    }));
    this.memoryApprovalHistory.set(orderId, history);
    return order;
  }

  /**
   * Cập nhật thông tin đơn hàng (đặc biệt là đơn nháp DRAFT để tiếp tục gõ)
   */
  async updateOrder(id: string, dto: UpdateOrderDto): Promise<OrderEntity> {
    const order = await this.findOrderById(id);

    if (dto.status !== undefined) {
      throw new BadRequestException(
        'Vui lòng cập nhật trạng thái qua chức năng duyệt đơn',
      );
    }

    if (
      order.status !== OrderStatus.DRAFT &&
      order.status !== OrderStatus.PENDING &&
      order.status !== OrderStatus.RETURNED_FOR_UPDATE
    ) {
      throw new BadRequestException('Chỉ có thể chỉnh sửa đơn hàng ở trạng thái Nháp hoặc Chờ duyệt');
    }

    if (dto.customerId && dto.customerId !== order.customerId) {
      const customer = await this.customersService.getCustomerById(dto.customerId);
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

    await this.refreshApprovalState(order);
    if (order.status === OrderStatus.RETURNED_FOR_UPDATE) {
      order.status = order.requiresApproval ? OrderStatus.PENDING_APPROVAL : OrderStatus.PENDING;
    }
    order.updatedAt = new Date();
    await this.saveOrder(order);
    return order;
  }

  /**
   * Cập nhật trạng thái đơn hàng (Duyệt, Hủy, Xuất kho...)
   */
  async updateOrderStatus(
    id: string,
    dto: UpdateOrderStatusDto,
  ): Promise<OrderEntity> {
    const order = await this.findOrderById(id);
    if (
      dto.status === OrderStatus.APPROVED ||
      dto.status === OrderStatus.REJECTED ||
      dto.status === OrderStatus.RETURNED_FOR_UPDATE
    ) {
      throw new BadRequestException('Dùng chức năng xét duyệt để quyết định đơn chờ duyệt.');
    }
    if (order.status === OrderStatus.PENDING_APPROVAL) {
      throw new BadRequestException('Đơn chờ duyệt chỉ được xử lý qua chức năng xét duyệt.');
    }
    if (this.databaseService && dto.status === OrderStatus.SHIPPED) {
      const reservations = await this.databaseService.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM app_order_inventory_reservations
         WHERE order_id = $1 AND status = 'RESERVED'`,
        [order.id],
      );
      if (Number(reservations[0]?.count ?? 0) > 0) {
        throw new BadRequestException(
          `Đơn ${order.orderCode} vẫn còn hàng đang giữ. Hãy xuất kho theo mã đơn này trước khi chuyển sang Đã xuất kho.`,
        );
      }
    }
    order.status = dto.status;
    order.updatedAt = new Date();
    if (this.databaseService && dto.status === OrderStatus.CANCELLED) {
      await this.databaseService.query(
        `UPDATE app_order_inventory_reservations
         SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
         WHERE order_id = $1 AND status = 'RESERVED'`,
        [order.id],
      );
    }
    await this.saveOrder(order);
    return order;
  }

  private async refreshApprovalState(order: OrderEntity): Promise<void> {
    const debtStatus = await this.customersService.getCustomerDebtStatus(order.customerId);
    const projectedDebt = debtStatus.currentDebt + order.grandTotal;
    const isCreditLimitExceeded =
      debtStatus.creditLimit > 0 && projectedDebt > debtStatus.creditLimit;
    const creditLimitExceededAmount = isCreditLimitExceeded
      ? projectedDebt - debtStatus.creditLimit
      : 0;
    const priceFloorReasons = order.lines
      .filter((line) => line.requiresApproval)
      .map((line) =>
        `SKU ${line.productSku}: giá bán ${line.unitPrice.toLocaleString('vi-VN')} đ thấp hơn giá sàn ${line.minPrice?.toLocaleString('vi-VN')} đ`,
      );
    if (isCreditLimitExceeded) {
      priceFloorReasons.push(
        `Vượt hạn mức công nợ ${creditLimitExceededAmount.toLocaleString('vi-VN')} đ (công nợ dự kiến ${projectedDebt.toLocaleString('vi-VN')} đ / hạn mức ${debtStatus.creditLimit.toLocaleString('vi-VN')} đ)`,
      );
    }
    order.isCreditLimitExceeded = isCreditLimitExceeded;
    order.creditLimitExceededAmount = creditLimitExceededAmount;
    order.approvalReasons = priceFloorReasons;
    order.requiresApproval = priceFloorReasons.length > 0;
  }

  /**
   * Xóa đơn hàng (chỉ cho phép xóa đơn Nháp hoặc Đã hủy)
   */
  async deleteOrder(id: string): Promise<{ success: boolean; message: string }> {
    const order = await this.findOrderById(id);
    if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('Chỉ có thể xóa đơn hàng ở trạng thái Nháp hoặc Đã hủy');
    }
    if (this.databaseService) {
      await this.databaseService.query('DELETE FROM app_order_records WHERE id = $1', [id]);
    } else {
      this.orders.delete(id);
    }
    return { success: true, message: 'Đã xóa đơn hàng thành công' };
  }
}
