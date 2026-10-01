import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UserRole } from '../enums/user-role.enum';

/**
 * Guard kiểm soát phân quyền người dùng theo vai trò (RBAC - SN-10):
 * - Áp dụng nguyên tắc Mặc định từ chối (Deny by default) khi không thỏa vai trò
 * - ADMIN có quyền lực tối cao (Super admin bypass)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Nếu route là Public thì bỏ qua kiểm tra quyền
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // 2. Lấy danh sách các vai trò được phép truy cập
    const requiredRoles = this.reflector.getAllAndOverride<
      (UserRole | string)[]
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    // Nếu endpoint không yêu cầu vai trò cụ thể, chỉ cần đã qua JwtAuthGuard
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 3. Trích xuất thông tin người dùng từ request (được gắn từ JwtStrategy)
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException(
        'Từ chối truy cập: Chưa xác thực danh tính người dùng.',
      );
    }

    // Đồng bộ danh sách vai trò của user (hỗ trợ cả mảng roles và thuộc tính role đơn)
    const userRoles: string[] = Array.isArray(user.roles)
      ? user.roles
      : user.role
        ? [user.role]
        : [];

    // 4. Quản trị hệ thống (ADMIN) luôn có toàn quyền trên toàn bộ hệ thống
    if (userRoles.includes(UserRole.ADMIN)) {
      return true;
    }

    // 5. Kiểm tra vai trò của user có nằm trong danh sách được cấp phép hay không
    const hasPermission = requiredRoles.some((requiredRole) =>
      userRoles.includes(requiredRole),
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `Từ chối truy cập: Bạn không có quyền thực hiện chức năng này. Chức năng yêu cầu một trong các vai trò: [${requiredRoles.join(', ')}].`,
      );
    }

    return true;
  }
}

