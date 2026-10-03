import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import { UsersService } from '../src/modules/users/users.service';
import { SafeUser } from '../src/modules/users/entities/user.entity';
import { UserRepository } from '../src/modules/users/user.repository';

let app: INestApplication;
let baseUrl: string;
let users: UsersService;
let jwt: JwtService;
const SALES_ID = 'usr-sales-002';

before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(UserRepository).useValue(null).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  users = app.get(UsersService);
  jwt = app.get(JwtService);
});

after(async () => { await app?.close(); });

async function sendRequest(
  method: string,
  body?: unknown,
  userId: string | null = SALES_ID,
  route = '/users/me',
): Promise<Response> {
  const user = userId ? await users.findById(userId) : null;
  const token = user ? jwt.sign({ sub: user.id, roles: user.roles }) : '';
  return fetch(`${baseUrl}/api${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('GET/PATCH yêu cầu đăng nhập', async () => {
  for (const method of ['GET', 'PATCH']) {
    assert.equal((await sendRequest(method, undefined, null)).status, 401);
  }
});

test('Mọi vai trò đều xem và cập nhật hồ sơ của chính mình', async () => {
  const ids = ['usr-admin-001', SALES_ID, 'usr-salesmgr-003', 'usr-wh-004',
    'usr-whmgr-005', 'usr-acc-006', 'usr-cust-007'];
  for (const id of ids) {
    const read = await sendRequest('GET', undefined, id);
    assert.equal(read.status, 200);
    const profile = await read.json() as SafeUser;
    assert.equal(profile.id, id);
    assert.equal('passwordHash' in profile, false);
    const result = await sendRequest('PATCH', { fullName: '  Nguyễn Văn An  ', phone: '+84912345678' }, id);
    assert.equal(result.status, 200);
    const updated = await result.json() as SafeUser;
    assert.equal(updated.fullName, 'Nguyễn Văn An');
    assert.equal(updated.phone, '0912345678');
    assert.equal((await users.findById(id))?.phone, updated.phone);
  }
});

test('Không sửa tài khoản, phân quyền, kho, địa bàn hoặc người khác', async () => {
  const beforeUser = { ...await users.findSafeById(SALES_ID) };
  const result = await sendRequest('PATCH', {
    fullName: 'Tên mới', id: 'usr-admin-001', userId: 'usr-admin-001',
    username: 'hacked', email: 'hacked@example.com', password: 'Hacked123',
    role: UserRole.ADMIN, roles: [UserRole.ADMIN], assignedWarehouse: 'Kho khác',
    region: 'Địa bàn khác', status: 'LOCKED',
  });
  assert.equal(result.status, 200);
  const updated = await users.findSafeById(SALES_ID);
  for (const field of ['id', 'username', 'email', 'role', 'roles', 'assignedWarehouse', 'status'] as const) {
    assert.deepEqual(updated[field], beforeUser[field]);
  }
  assert.equal((await users.findById('usr-admin-001'))?.fullName, 'Nguyễn Văn An');
  assert.equal((await sendRequest('PATCH', { fullName: 'Hack' }, SALES_ID, '/users/usr-admin-001')).status, 403);
});

test('Dữ liệu không hợp lệ bị từ chối nguyên tử', async () => {
  const invalidBodies: unknown[] = [
    {}, { roles: [UserRole.ADMIN] }, { fullName: '' }, { fullName: '  ' },
    { fullName: null }, { fullName: 12 }, { fullName: 'a'.repeat(101) },
    { phone: '' }, { phone: null }, { phone: 912345678 }, { phone: '0123456789' },
    { phone: '091234567' }, { phone: '09123456789' }, { phone: '+840912345678' },
    { fullName: 'Không được lưu', phone: 'abc' },
  ];
  const original = { ...await users.findSafeById(SALES_ID) };
  for (const body of invalidBodies) {
    assert.equal((await sendRequest('PATCH', body)).status, 400, JSON.stringify(body));
    assert.deepEqual(await users.findSafeById(SALES_ID), original);
  }
});

test('Cập nhật từng trường, hỗ trợ số cố định và đọc lại sau lưu', async () => {
  const previousName = (await users.findSafeById(SALES_ID)).fullName;
  assert.equal((await sendRequest('PATCH', { phone: ' 02412345678 ' })).status, 200);
  const result = await sendRequest('GET');
  const profile = await result.json() as SafeUser;
  assert.equal(profile.phone, '02412345678');
  assert.equal(profile.fullName, previousName);
});
