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

    // Bỏ qua chính endpoint audit-logs hoặc auth login
    if (url.includes('/audit-logs') || url.includes('/auth/login') || url.includes('/auth/refresh')) {
      return next.handle();
    }

    // Xác định phân hệ nghiệp vụ tác động dựa vào URL
    const entityName = this.resolveEntityName(url);
    const action = this.resolveAction(method, url);
    let initialEntityId = params?.id || body?.id || body?.sku || body?.productSku || body?.code;
    if (!initialEntityId) {
      const segments = url.split('?')[0].split('/').filter(Boolean);
      const lastSeg = segments[segments.length - 1];
      if (lastSeg && !['adjust', 'products', 'users', 'customers', 'orders', 'invoices'].includes(lastSeg.toLowerCase())) {
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
    const userId = user?.userId || user?.id || 'usr-admin-001';

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
              initialEntityId ||
              (resObj?.id as string) ||
              'SYSTEM';

            // Trích xuất old_values và new_values từ request và response
            const { oldValues, newValues, summary } = this.extractDiffValues(
              method,
              url,
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
   * Phân giải tên phân hệ nghiệp vụ tác động
   */
  private resolveEntityName(url: string): AuditEntity | string {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('/inventory')) return AuditEntity.INVENTORY;
    if (lowerUrl.includes('/customers') || lowerUrl.includes('/debt')) return AuditEntity.DEBT;
    if (lowerUrl.includes('/price-books') || lowerUrl.includes('/products')) return AuditEntity.PRICING;
    if (lowerUrl.includes('/orders')) return AuditEntity.ORDER;
    if (lowerUrl.includes('/invoices')) return AuditEntity.INVOICE;
    if (lowerUrl.includes('/users')) return AuditEntity.USER;
    return 'SYSTEM';
  }

  /**
   * Phân giải loại hành động tác động
   */
  private resolveAction(method: string, url: string): AuditAction {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('/adjust')) return AuditAction.STOCK_ADJUST;
    if (lowerUrl.includes('/approve')) return AuditAction.APPROVE;
    if (lowerUrl.includes('/cancel')) return AuditAction.CANCEL;

    switch (method) {
      case 'POST':
        return AuditAction.CREATE;
      case 'PUT':
      case 'PATCH':
        return AuditAction.UPDATE;
      case 'DELETE':
        return AuditAction.DELETE;
      default:
        return AuditAction.UPDATE;
    }
  }

  /**
   * Bóc tách các giá trị trước và sau khi thay đổi (Old Values & New Values)
   */
  private extractDiffValues(
    method: string,
    url: string,
    body: Record<string, unknown>,
    response: unknown,
    finalEntityId?: string,
  ): {
    oldValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
    summary?: string;
  } {
    const resObj = typeof response === 'object' && response !== null ? (response as Record<string, unknown>) : {};

    // 1. Phân hệ điều chỉnh tồn kho (Inventory Adjustment)
    if (url.includes('/inventory/adjust')) {
      const prevQty = resObj.previousQuantity ?? (body?.previousQuantity as number);
      const newQty = resObj.newQuantity ?? (body?.newQuantity as number);
      const sku = (resObj.sku as string) || (body?.productSku as string) || finalEntityId || '';

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

    // 2. Thao tác Cập nhật sản phẩm (PATCH / PUT /products)
    if (url.includes('/products') && (method === 'PATCH' || method === 'PUT')) {
      const sku = (resObj.sku as string) || (body?.sku as string) || finalEntityId || '';
      return {
        oldValues: {
          sku,
          price: resObj.price,
          status: resObj.status,
        },
        newValues: {
          ...body,
          sku,
        },
        summary: `Cập nhật thông tin sản phẩm SKU [${sku}]`,
      };
    }

    // 3. Thao tác Tạo mới (POST)
    if (method === 'POST') {
      return {
        oldValues: null,
        newValues: { ...body, ...(resObj.id ? { id: resObj.id } : {}) },
        summary: `Khởi tạo dữ liệu mới thành công`,
      };
    }

    // 4. Thao tác Xóa (DELETE)
    if (method === 'DELETE') {
      return {
        oldValues: resObj || body || null,
        newValues: null,
        summary: `Xóa bỏ dữ liệu khỏi hệ thống`,
      };
    }

    // 5. Thao tác Cập nhật chung (PUT / PATCH)
    return {
      oldValues: resObj.previousData ? (resObj.previousData as Record<string, unknown>) : null,
      newValues: { ...body },
      summary: `Cập nhật thông tin đối tượng [${finalEntityId || ''}]`,
    };
  }
}
