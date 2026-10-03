import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let formattedMessage = 'Đã có lỗi xảy ra trên hệ thống';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const rawMessage =
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'message' in exceptionResponse
          ? (exceptionResponse as { message: string | string[] }).message
          : exception.message;

      formattedMessage = Array.isArray(rawMessage)
        ? rawMessage.join('; ')
        : rawMessage;
    } else if (exception instanceof MulterError) {
      status = HttpStatus.BAD_REQUEST;
      if (exception.code === 'LIMIT_FILE_SIZE') {
        formattedMessage = 'Dung lượng ảnh không được vượt quá 2MB';
      } else {
        formattedMessage = `Lỗi tải file: ${exception.message}`;
      }
    } else if (exception instanceof Error) {
      formattedMessage = exception.message;
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message: formattedMessage,
      data: null,
      timestamp: new Date().toISOString(),
    });
  }
}

