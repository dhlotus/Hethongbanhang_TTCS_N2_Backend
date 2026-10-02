import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Custom Decorator trích xuất file ảnh đại diện từ Request (SN-144):
 * - Hỗ trợ cả trường tên là 'file' hoặc 'avatar'
 * - Tương thích với cả Single FileInterceptor và FileFieldsInterceptor / AnyFilesInterceptor
 */
export const UploadedAvatarFile = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Express.Multer.File | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<
        Request & {
          file?: Express.Multer.File;
          files?:
            | { [fieldname: string]: Express.Multer.File[] }
            | Express.Multer.File[];
        }
      >();

    // 1. Kiểm tra request.file (từ FileInterceptor)
    if (request.file) {
      return request.file;
    }

    // 2. Kiểm tra request.files (từ FileFieldsInterceptor / AnyFilesInterceptor)
    if (request.files) {
      if (Array.isArray(request.files)) {
        return request.files[0];
      }

      const filesMap = request.files as {
        [fieldname: string]: Express.Multer.File[];
      };

      if (filesMap['file'] && filesMap['file'].length > 0) {
        return filesMap['file'][0];
      }

      if (filesMap['avatar'] && filesMap['avatar'].length > 0) {
        return filesMap['avatar'][0];
      }

      const firstKey = Object.keys(filesMap)[0];
      if (firstKey && filesMap[firstKey].length > 0) {
        return filesMap[firstKey][0];
      }
    }

    return undefined;
  },
);
