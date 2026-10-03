/**
 * Các hằng số cấu hình tải lên ảnh đại diện (SN-144)
 */

export const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB (2,097,152 bytes)

export const ALLOWED_AVATAR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
] as const;

export const ALLOWED_AVATAR_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
] as const;

export const AVATAR_UPLOAD_DIR = 'uploads/avatars';
export const AVATAR_URL_PREFIX = '/uploads/avatars/';

export const AVATAR_MESSAGES = {
  UPLOAD_SUCCESS: 'Cập nhật ảnh đại diện thành công',
  FILE_REQUIRED: 'Vui lòng chọn file ảnh để tải lên.',
  FILE_TOO_LARGE: 'Dung lượng ảnh không được vượt quá 2MB',
  INVALID_FILE_TYPE: 'Chỉ chấp nhận file ảnh định dạng JPG hoặc PNG',
  USER_NOT_FOUND: 'Không tìm thấy người dùng trong hệ thống.',
} as const;
