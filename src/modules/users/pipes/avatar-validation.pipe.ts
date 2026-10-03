import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import * as path from 'path';
import {
  ALLOWED_AVATAR_EXTENSIONS,
  ALLOWED_AVATAR_MIME_TYPES,
  AVATAR_MESSAGES,
  MAX_AVATAR_SIZE,
} from '../constants/avatar.constant';

/**
 * Pipe kiểm tra hợp lệ của file ảnh đại diện (SN-144):
 * - Bắt buộc có file gửi lên
 * - Kiểm tra định dạng (MIME type và Extension): Chỉ chấp nhận JPG và PNG
 * - Kiểm tra dung lượng: Không vượt quá 2MB (2,097,152 bytes)
 * - Ném BadRequestException chuẩn với thông điệp rõ ràng, không để crash ứng dụng
 */
@Injectable()
export class AvatarValidationPipe
  implements PipeTransform<Express.Multer.File | undefined, Express.Multer.File>
{
  transform(file?: Express.Multer.File): Express.Multer.File {
    // 1. Kiểm tra sự tồn tại của file
    if (!file) {
      throw new BadRequestException(AVATAR_MESSAGES.FILE_REQUIRED);
    }

    // 2. Kiểm tra định dạng file (JPG/PNG qua Extension & MimeType)
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const isExtensionAllowed = (ALLOWED_AVATAR_EXTENSIONS as readonly string[]).includes(
      rawExt,
    );
    const isMimeTypeAllowed = (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(
      file.mimetype,
    );

    if (!isExtensionAllowed || !isMimeTypeAllowed) {
      throw new BadRequestException(AVATAR_MESSAGES.INVALID_FILE_TYPE);
    }

    // 3. Kiểm tra dung lượng tối đa 2MB
    if (file.size > MAX_AVATAR_SIZE) {
      throw new BadRequestException(AVATAR_MESSAGES.FILE_TOO_LARGE);
    }

    return file;
  }
}
