import 'reflect-metadata';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../src/database/database.service';
import { UserRepository } from '../src/modules/users/user.repository';
import { UsersService } from '../src/modules/users/users.service';
import { UserRole } from '../src/common/enums/user-role.enum';

async function createDatabase(): Promise<void> {
  const config = new ConfigService();
  const name = config.get<string>('DB_NAME', 'htbh_db');
  const admin = new DatabaseService(new ConfigService({ DB_NAME: 'postgres' }));
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!existing.rowCount) {
      const quotedName = '"' + name.replace(/"/g, '""') + '"';
      await admin.query(`CREATE DATABASE ${quotedName}`);
    }
    console.log(`Database đã sẵn sàng: ${name}`);
  } finally {
    await admin.onModuleDestroy();
  }
}

async function migrate(database: DatabaseService): Promise<void> {
  const files = [
    '001_initial_schema_core_and_auth.sql',
    '008_user_profile_persistence.sql',
  ];
  for (const file of files) {
    const sql = await readFile(join(process.cwd(), 'src/database/migrations', file), 'utf8');
    await database.query(sql);
    console.log(`Đã áp dụng: ${file}`);
  }
}

async function seedUsers(database: DatabaseService): Promise<void> {
  for (const role of Object.values(UserRole)) {
    await database.query(
      'INSERT INTO roles (code, name) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING', [role],
    );
  }
  const repository = new UserRepository(database);
  const demoUsers = new UsersService();
  const { data } = await demoUsers.findAll({ page: 1, limit: 100 });
  for (const profile of data) {
    if (await repository.findByIdentifier(profile.username)) continue;
    if (await repository.findByIdentifier(profile.email)) continue;
    const user = await demoUsers.findById(profile.id);
    if (!user) continue;
    user.id = randomUUID();
    await repository.create(user);
  }
  console.log('Đã thêm tài khoản mẫu còn thiếu; không thay đổi tài khoản hiện có.');
}

async function run(): Promise<void> {
  if (process.argv[2] === 'create') return createDatabase();
  const database = new DatabaseService(new ConfigService());
  try {
    if (process.argv[2] === 'migrate') await migrate(database);
    else if (process.argv[2] === 'seed-users') await seedUsers(database);
    else throw new Error('Dùng create, migrate hoặc seed-users');
  } finally {
    await database.onModuleDestroy();
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Thao tác database thất bại');
  process.exitCode = 1;
});
