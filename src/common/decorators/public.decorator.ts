import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../modules/auth/constants/auth.constant';

export { IS_PUBLIC_KEY };

/**
 * Decorator đánh dấu endpoint không yêu cầu xác thực JWT
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
