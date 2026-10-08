import { CustomersService } from '../src/modules/customers/customers.service';
import { DiscountPoliciesService } from '../src/modules/discount-policies/discount-policies.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrderStatus } from '../src/modules/orders/entities/order-status.enum';
import { PriceListsService } from '../src/modules/price-lists/price-lists.service';

describe('Order pricing (SN-40)', () => {
  let ordersService: OrdersService;

  beforeEach(() => {
    ordersService = new OrdersService(
      new CustomersService(),
      new PriceListsService(),
      new DiscountPoliciesService(),
    );
  });

  it('applies the active customer price and recalculates volume discount when quantity changes', async () => {
    const order = await ordersService.createOrder({
      customerId: 'cust-001',
      status: OrderStatus.DRAFT,
      lines: [
        {
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa bột',
          unit: 'Lon',
          baseUnit: 'Lon',
          conversionRate: 1,
          quantity: 9,
        },
      ],
    });

    expect(order.priceListId).toBe('pl-002');
    expect(order.lines[0].listPrice).toBe(440000);
    expect(order.lines[0].unitPrice).toBe(440000);

    const updatedOrder = await ordersService.updateOrder(order.id, {
      lines: [
        {
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa bột',
          unit: 'Lon',
          baseUnit: 'Lon',
          conversionRate: 1,
          quantity: 50,
        },
      ],
    });

    expect(updatedOrder.lines[0].discountPercent).toBe(5);
    expect(updatedOrder.lines[0].unitPrice).toBe(418000);
    expect(updatedOrder.grandTotal).toBe(20900000);
  });

  it('marks a manual price below the floor for approval', async () => {
    const order = await ordersService.createOrder({
      customerId: 'cust-001',
      status: OrderStatus.APPROVED,
      lines: [
        {
          productId: 'prod-001',
          productSku: 'LH-MILK-900G',
          productName: 'Sữa bột',
          unit: 'Lon',
          baseUnit: 'Lon',
          conversionRate: 1,
          quantity: 1,
          unitPrice: 390000,
          isPriceManuallyEdited: true,
        },
      ],
    });

    expect(order.lines[0].minPrice).toBe(400000);
    expect(order.lines[0].requiresApproval).toBe(true);
    expect(order.requiresApproval).toBe(true);
    expect(order.approvalReasons).toHaveLength(1);
    expect(order.status).toBe(OrderStatus.PENDING);
  });

  it('blocks adding an SKU that has no current price', async () => {
    await expect(
      ordersService.createOrder({
        customerId: 'cust-001',
        lines: [
          {
            productId: 'prod-missing',
            productSku: 'SKU-MISSING',
            productName: 'Sản phẩm chưa có giá',
            unit: 'Cái',
            baseUnit: 'Cái',
            conversionRate: 1,
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow('không có trong bảng giá đang hiệu lực');
  });
});
