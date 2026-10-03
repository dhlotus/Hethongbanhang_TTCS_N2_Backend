import 'reflect-metadata';
import 'dotenv/config';
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { UserRepository } from '../src/modules/users/user.repository';
import { UserEntity, SafeUser } from '../src/modules/users/entities/user.entity';
import { UserRole } from '../src/common/enums/user-role.enum';

async function startApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

async function login(app: INestApplication, username: string): Promise<string> {
  const response = await fetch(`${await app.getUrl()}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'Persistence123!' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { accessToken: string };
  assert.ok(body.accessToken);
  return body.accessToken;
}

async function updateProfile(app: INestApplication, token: string): Promise<void> {
  const response = await fetch(`${await app.getUrl()}/api/users/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fullName: 'Tên được lưu trong PostgreSQL', phone: '+84912345678' }),
  });
  assert.equal(response.status, 200);
}

test('PostgreSQL: hồ sơ và đăng nhập tồn tại sau khi đóng và khởi tạo lại ứng dụng', async () => {
  const database = new DatabaseService(new ConfigService());
  const repository = new UserRepository(database);
  const id = randomUUID();
  const username = `sn17-${id}`;
  let app: INestApplication | undefined;
  try {
    await repository.create(new UserEntity({
      id, username, email: `${username}@example.com`, fullName: 'Trước khi lưu',
      phone: '0987654321', role: UserRole.SALES_REP,
      passwordHash: await bcrypt.hash('Persistence123!', 10),
    }));
    app = await startApplication();
    await updateProfile(app, await login(app, username));
    await app.close();
    app = undefined;
    assert.equal((await repository.findById(id))?.phone, '0912345678');
    app = await startApplication();
    const token = await login(app, username);
    const response = await fetch(`${await app.getUrl()}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    const profile = await response.json() as SafeUser;
    assert.equal(profile.fullName, 'Tên được lưu trong PostgreSQL');
    assert.equal(profile.phone, '0912345678');
    assert.equal(profile.id, id);
    assert.deepEqual(profile.roles, [UserRole.SALES_REP]);
  } finally {
    await app?.close();
    await database.query('DELETE FROM users WHERE id = $1', [id]);
    await database.onModuleDestroy();
  }
});
