import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { UserRole } from '../enums/user-role.enum';

/**
 * Interceptor bảo mật dữ liệu nhạy cảm (Cost Price / Margin - SN-10 & SN-138):
 * - Chỉ cho phép ADMIN và SALES_MANAGER nhìn thấy thông tin giá vốn (cost_price / costPrice)
 *   và biên lợi nhuận (margin / profitMargin / margin_percentage).
 * - Tự động loại bỏ hoàn toàn các trường dữ liệu nhạy cảm đối với các vai trò khác
 *   (Thủ kho WAREHOUSE_KEEPER, Nhân viên kinh doanh SALES_REP, Đại lý CUSTOMER, Kế toán ACCOUNTANT, v.v.).
 * - Tuân thủ nghiêm ngặt chuẩn Strict TypeScript (Zero any).
 */
@Injectable()
export class CostPriceSanitizerInterceptor implements NestInterceptor {
  private static readonly SENSITIVE_KEYS = new Set<string>([
    'cost_price',
    'costPrice',
    'margin',
    'profitMargin',
    'profit_margin',
    'margin_percentage',
    'marginPercentage',
    'rawCost',
    'unitCost',
  ]);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string; roles?: string[] } }>();
    const user = request?.user;

    // Trích xuất danh sách vai trò của người dùng hiện tại
    const userRoles: string[] = Array.isArray(user?.roles)
      ? user.roles
      : user?.role
        ? [user.role]
        : [];

    // Kiểm tra quyền hạn: Chỉ ADMIN và SALES_MANAGER mới được phép truy xuất giá vốn
    const canViewCostPrice = userRoles.some(
      (role) =>
        role === UserRole.ADMIN ||
        role === UserRole.SALES_MANAGER ||
        role === 'ADMIN' ||
        role === 'SALES_MANAGER',
    );

    if (canViewCostPrice) {
      return next.handle();
    }

    // Nếu không có quyền, lọc sạch toàn bộ dữ liệu nhạy cảm trên luồng phản hồi
    return next.handle().pipe(
      map((data: unknown) => this.sanitizeData(data)),
    );
  }

  /**
   * Đệ quy lọc bỏ các trường nhạy cảm trong Object và Array (Type-safe, Zero any)
   */
  public sanitizeData<T>(data: T): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item: unknown) => this.sanitizeData(item));
    }

    if (typeof data === 'object') {
      // Giữ nguyên instance đặc biệt như Date hoặc RegExp nếu có
      if (data instanceof Date || data instanceof RegExp) {
        return data;
      }

      // Xử lý instance có hàm toJSON()
      const dataObj = data as Record<string, unknown>;
      const sourceObj =
        typeof dataObj.toJSON === 'function'
          ? (dataObj.toJSON as () => Record<string, unknown>)()
          : dataObj;

      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(sourceObj)) {
        if (!CostPriceSanitizerInterceptor.SENSITIVE_KEYS.has(key)) {
          sanitized[key] = this.sanitizeData(value);
        }
      }
      return sanitized;
    }

    return data;
  }
}
