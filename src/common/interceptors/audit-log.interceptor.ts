import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditAction, AuditEntity } from '../enums';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';

/**
 * Global Interceptor tự động ghi nhận nhật ký kiểm toán (Audit Logs - SN-19):
 * - Tự động bắt các thao tác ghi dữ liệu nhạy cảm (POST, PUT, PATCH, DELETE)
 * - Tự động trích xuất user_id từ JWT Token và IP của Client
 * - Bóc tách old_values và new_values dưới dạng JSONB
 * - Ghi nhận chuẩn xác loại hành động (UPDATE, CREATE, DELETE, APPROVE, CANCEL, STOCK_ADJUST)
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, params, user } = request;

    // Chỉ giám sát các phương thức thay đổi dữ liệu
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (!isMutation) {
      return next.handle();
    }

    // Bỏ qua chính endpoint audit-logs hoặc auth login/refresh
    if (
      url.includes('/audit-logs') ||
      url.includes('/auth/login') ||
      url.includes('/auth/refresh')
    ) {
      return next.handle();
    }

    // Xác định phân hệ nghiệp vụ tác động và hành động thực tế
    const entityName = this.resolveEntityName(url);
    const action = this.resolveAction(method, url, params, body);

    let initialEntityId =
      params?.id ||
      body?.id ||
      body?.sku ||
      body?.productSku ||
      body?.code ||
      body?.customerCode ||
      body?.orderCode;

    if (!initialEntityId) {
      const segments = url.split('?')[0].split('/').filter(Boolean);
      const lastSeg = segments[segments.length - 1];
      if (
        lastSeg &&
        ![
          'adjust',
          'products',
          'users',
          'customers',
          'orders',
          'invoices',
          'price-books',
          'inventory',
        ].includes(lastSeg.toLowerCase())
      ) {
        initialEntityId = lastSeg;
      }
    }

    // Địa chỉ IP client
    const ipAddress =
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      request.ip ||
      request.connection?.remoteAddress ||
      '127.0.0.1';

    // User ID từ JWT token đã qua JwtAuthGuard
    const userId = user?.userId || user?.id || user?.sub || 'usr-admin-001';

    return next.handle().pipe(
      tap({
        next: async (responseData) => {
          try {
            const resObj =
              typeof responseData === 'object' && responseData !== null
                ? (responseData as Record<string, unknown>)
                : {};

            const finalEntityId =
              (resObj?.sku as string) ||
              (body?.sku as string) ||
              (body?.productSku as string) ||
              (resObj?.customerCode as string) ||
              (body?.customerCode as string) ||
              (resObj?.orderCode as string) ||
              (body?.orderCode as string) ||
              initialEntityId ||
              (resObj?.id as string) ||
              (body?.id as string) ||
              'LH-ITEM';

            // Trích xuất old_values và new_values từ request và response
            const { oldValues, newValues, summary } = this.extractDiffValues(
              method,
              url,
              action,
              body,
              responseData,
              finalEntityId,
            );

            await this.auditLogsService.recordLog({
              userId,
              action,
              entityName,
              entityId: String(finalEntityId),
              oldValues,
              newValues,
              ipAddress,
              summary,
            });
          } catch {
            // Không làm gián đoạn response chính nếu có lỗi trong tiến trình log
          }
        },
      }),
    );
  }

  /**
   * Phân giải tên phân hệ nghiệp vụ tác động chuẩn theo SN-19
   */
  private resolveEntityName(url: string): AuditEntity | string {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('/inventory')) return AuditEntity.INVENTORY;
    if (lowerUrl.includes('/customers') || lowerUrl.includes('/debt'))
      return AuditEntity.DEBT;
    if (
      lowerUrl.includes('/price-books') ||
      lowerUrl.includes('/pricing') ||
      lowerUrl.includes('/products')
    ) {
      return AuditEntity.PRICING;
    }
    if (lowerUrl.includes('/orders')) return AuditEntity.ORDER;
    if (lowerUrl.includes('/invoices')) return AuditEntity.INVOICE;
    if (lowerUrl.includes('/users')) return AuditEntity.USER;
    return AuditEntity.PRICING;
  }

  /**
   * Phân giải loại hành động tác động chuẩn:
   * UPDATE (Cập nhật), CREATE (Tạo mới), DELETE (Xóa),
   * APPROVE (Phê duyệt), CANCEL (Hủy bỏ), STOCK_ADJUST (Điều chỉnh tồn kho).
   */
  private resolveAction(
    method: string,
    url: string,
    params?: Record<string, unknown>,
    body?: Record<string, unknown>,
  ): AuditAction {
    const lowerUrl = url.toLowerCase();

    // 1. Phân loại theo nghiệp vụ đặc thù
    if (lowerUrl.includes('/adjust')) return AuditAction.STOCK_ADJUST;
    if (lowerUrl.includes('/approve')) return AuditAction.APPROVE;
    if (lowerUrl.includes('/cancel')) return AuditAction.CANCEL;

    // 2. Thao tác Cập nhật / Sửa dữ liệu (PATCH, PUT hoặc POST mang ý định update)
    if (method === 'PATCH' || method === 'PUT') {
      return AuditAction.UPDATE;
    }

    if (
      lowerUrl.includes('/update') ||
      lowerUrl.includes('/edit') ||
      lowerUrl.includes('/modify') ||
      body?.action === 'UPDATE' ||
      body?._method === 'PUT' ||
      body?._method === 'PATCH'
    ) {
      return AuditAction.UPDATE;
    }

    // 3. Thao tác Xóa
    if (method === 'DELETE') {
      return AuditAction.DELETE;
    }

    // 4. Thao tác Tạo mới (POST)
    if (method === 'POST') {
      const segments = lowerUrl.split('?')[0].split('/').filter(Boolean);
      const lastSeg = segments[segments.length - 1];
      const isCollectionPost = [
        'products',
        'users',
        'orders',
        'customers',
        'invoices',
        'price-books',
        'inventory',
      ].includes(lastSeg);

      // Nếu POST trỏ tới một bản ghi cụ thể (/products/:id) thì đó là thao tác cập nhật
      if (!isCollectionPost && (params?.id || segments.length > 2)) {
        return AuditAction.UPDATE;
      }

      return AuditAction.CREATE;
    }

    return AuditAction.UPDATE;
  }

  /**
   * Bóc tách các giá trị trước và sau khi thay đổi (Old Values & New Values)
   */
  private extractDiffValues(
    method: string,
    url: string,
    action: AuditAction,
    body: Record<string, unknown>,
    response: unknown,
    finalEntityId?: string,
  ): {
    oldValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
    summary?: string;
  } {
    const resObj =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {};

    // 1. Phân hệ điều chỉnh tồn kho (Inventory Adjustment)
    if (url.includes('/inventory/adjust') || action === AuditAction.STOCK_ADJUST) {
      const prevQty =
        resObj.previousQuantity ?? (body?.previousQuantity as number);
      const newQty = resObj.newQuantity ?? (body?.newQuantity as number);
      const sku =
        (resObj.sku as string) ||
        (body?.productSku as string) ||
        finalEntityId ||
        '';

      return {
        oldValues: {
          sku,
          stockQuantity: prevQty,
        },
        newValues: {
          sku,
          stockQuantity: newQty,
          quantityChange: resObj.quantityChange ?? body?.quantityChange,
          reason: body?.reason || resObj.reason,
        },
        summary: `Điều chỉnh tồn kho SKU ${sku}: ${prevQty} -> ${newQty}`,
      };
    }

    // 2. Thao tác Cập nhật sản phẩm (PATCH / PUT /products hoặc POST cập nhật)
    if (
      url.includes('/products') &&
      (action === AuditAction.UPDATE || method === 'PATCH' || method === 'PUT')
    ) {
      const sku =
        (resObj.sku as string) ||
        (body?.sku as string) ||
        finalEntityId ||
        '';
      return {
        oldValues: {
          sku,
          price: resObj.price,
          status: resObj.status,
          stockQuantity: resObj.stockQuantity,
        },
        newValues: {
          ...body,
          sku,
        },
        summary: `Cập nhật thông tin sản phẩm SKU [${sku}]`,
      };
    }

    // 3. Thao tác Tạo mới (POST / CREATE)
    if (action === AuditAction.CREATE) {
      const isExceeded = resObj?.isCreditLimitExceeded;
      const orderCode = (resObj?.orderCode as string) || (body?.orderCode as string);
      return {
        oldValues: null,
        newValues: {
          ...body,
          ...(resObj.id ? { id: resObj.id } : {}),
          ...(isExceeded
            ? {
                isCreditLimitExceeded: true,
                creditLimitExceededAmount: resObj.creditLimitExceededAmount,
                status: resObj.status,
              }
            : {}),
        },
        summary: isExceeded
          ? `Tạo đơn hàng ${orderCode || finalEntityId} - VƯỢT HẠN MỨC CÔNG NỢ (Tự động chuyển Chờ duyệt)`
          : `Khởi tạo dữ liệu mới thành công cho [${finalEntityId || ''}]`,
      };
    }

    // 4. Thao tác Xóa (DELETE)
    if (action === AuditAction.DELETE) {
      return {
        oldValues: resObj || body || null,
        newValues: null,
        summary: `Xóa bỏ dữ liệu đối tượng [${finalEntityId || ''}]`,
      };
    }

    // 5. Thao tác Cập nhật chung (UPDATE)
    return {
      oldValues: resObj.previousData
        ? (resObj.previousData as Record<string, unknown>)
        : null,
      newValues: { ...body },
      summary: `Cập nhật thông tin đối tượng [${finalEntityId || ''}]`,
    };
  }
}
