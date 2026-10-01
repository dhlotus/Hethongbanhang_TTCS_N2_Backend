// Khung khởi động NestJS Application
import { appConfig } from './config/app.config';

export async function bootstrap(): Promise<void> {
  // Khởi tạo ứng dụng NestJS sẽ được kết nối cùng @nestjs/core
  console.log(`Backend service initialized on port ${appConfig.port}`);
}

bootstrap();
