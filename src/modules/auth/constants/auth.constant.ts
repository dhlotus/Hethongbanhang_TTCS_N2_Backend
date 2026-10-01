export const AUTH_CONSTANTS = {
  TOKEN_TYPE: 'Bearer',
  DEFAULT_ACCESS_EXPIRES_IN: '1h',
  DEFAULT_REFRESH_EXPIRES_IN: '7d',
  LOGOUT_SUCCESS_MESSAGE: 'Đăng xuất thành công',
  INVALID_REFRESH_TOKEN_MESSAGE: 'Refresh token không hợp lệ hoặc đã hết hạn',
  REVOKED_REFRESH_TOKEN_MESSAGE: 'Refresh token đã bị thu hồi hoặc phiên làm việc đã kết thúc',
  UNAUTHORIZED_ACCESS_MESSAGE: 'Không có quyền truy cập, vui lòng đăng nhập lại',
} as const;

export const IS_PUBLIC_KEY = 'isPublic';
