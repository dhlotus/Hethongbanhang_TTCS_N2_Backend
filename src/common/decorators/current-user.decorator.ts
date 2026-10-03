import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ICurrentUser } from '../../modules/auth/interfaces/current-user.interface';

/**
 * Custom Decorator lấy thông tin người dùng đăng nhập hiện tại từ Request
 * Hỗ trợ trích xuất toàn bộ user hoặc trường cụ thể (ví dụ: @CurrentUser('userId'))
 */
export const CurrentUser = createParamDecorator(
  (
    data: keyof ICurrentUser | undefined,
    ctx: ExecutionContext,
  ): ICurrentUser | string | string[] | null | undefined => {

    const request = ctx.switchToHttp().getRequest<{ user?: ICurrentUser }>();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    return data ? user[data] : user;
  },
);
