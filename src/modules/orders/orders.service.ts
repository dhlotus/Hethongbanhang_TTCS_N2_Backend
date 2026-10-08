import { Injectable, BadRequestException } from '@nestjs/common';
import { OrderStatus } from '../../common/enums/order-status.enum';

@Injectable()
export class OrdersService {
  createOrder(createOrderDto: any) {
    const { items } = createOrderDto;
    
    // Giả lập check tồn kho, logic thực tế sẽ query từ inventory
    // Ở đây ta giả sử nếu tổng số lượng đặt > 1000 là thiếu hàng
    let isOutOfStock = false;
    let totalQuantity = 0;
    
    if (items && Array.isArray(items)) {
      for (const item of items) {
        totalQuantity += item.quantity || 0;
        if (item.quantity > 500) { // Giả lập ngưỡng thiếu hàng cho 1 sản phẩm
          isOutOfStock = true;
        }
      }
    }
    
    if (totalQuantity > 1000) {
      isOutOfStock = true;
    }

    const orderStatus = isOutOfStock ? OrderStatus.PENDING_INVENTORY_APPROVAL : OrderStatus.DRAFT;

    return {
      success: true,
      orderId: `ORD-${Date.now()}`,
      status: orderStatus,
      message: isOutOfStock 
        ? 'Đơn hàng vượt quá tồn kho khả dụng, chuyển sang trạng thái chờ phê duyệt.'
        : 'Tạo đơn hàng thành công.',
    };
  }
}
