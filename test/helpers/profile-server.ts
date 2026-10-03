import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';

async function start(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  process.on('message', (message: unknown) => {
    if (message === 'stop') {
      void app.close().then(() => process.exit(0));
    }
  });
  process.send?.({ url: await app.getUrl() });
}

void start().catch(() => process.exit(1));
