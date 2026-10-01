export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCK_TIME_MINUTES = 15;
export const LOCK_TIME_MS = LOCK_TIME_MINUTES * 60 * 1000;
export const BCRYPT_SALT_ROUNDS = 10;

export const AUTH_ERROR_MESSAGES = {
  INVALID_CREDENTIALS: 'Tài khoản hoặc mật khẩu không chính xác',
  ACCOUNT_TEMPORARILY_LOCKED:
    'Tài khoản tạm thời bị khóa do nhập sai nhiều lần. Vui lòng thử lại sau 15 phút.',
  ACCOUNT_INACTIVE:
    'Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa',
} as const;
