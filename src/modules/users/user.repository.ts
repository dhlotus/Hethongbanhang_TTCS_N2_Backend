import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { UserEntity } from './entities/user.entity';

const USER_COLUMNS = {
  username: 'username', email: 'email', passwordHash: 'password_hash',
  fullName: 'full_name', phone: 'phone', roles: 'roles', status: 'status',
  avatarUrl: 'avatar_url', assignedWarehouse: 'assigned_warehouse',
  lockReason: 'lock_reason', resetCode: 'reset_code',
  resetCodeCreatedAt: 'reset_code_created_at', failedAttempts: 'failed_attempts',
  lockedUntil: 'locked_until',
} as const;

export type UserField = keyof typeof USER_COLUMNS;
type UserRow = Partial<UserEntity> & { id: string };
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const USER_SELECT = `SELECT u.id, u.username, u.email,
  u.password_hash AS "passwordHash", u.full_name AS "fullName", u.phone,
  r.code AS role, COALESCE(u.roles, ARRAY[r.code]) AS roles, u.status,
  u.avatar_url AS "avatarUrl", u.assigned_warehouse AS "assignedWarehouse",
  u.lock_reason AS "lockReason", u.reset_code AS "resetCode",
  u.reset_code_created_at AS "resetCodeCreatedAt",
  u.failed_attempts AS "failedAttempts", u.locked_until AS "lockedUntil",
  u.created_at AS "createdAt", u.updated_at AS "updatedAt"
  FROM users u JOIN roles r ON r.id = u.role_id`;

@Injectable()
export class UserRepository implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    // Dừng khởi động nếu thiếu schema/kết nối, không âm thầm quay về dữ liệu RAM.
    await this.database.query(`${USER_SELECT} LIMIT 0`);
  }

  async findAll(): Promise<UserEntity[]> {
    return this.getUsers(USER_SELECT);
  }

  async findById(id: string): Promise<UserEntity | null> {
    if (!UUID_PATTERN.test(id)) return null;
    return (await this.getUsers(`${USER_SELECT} WHERE u.id = $1`, [id]))[0] ?? null;
  }

  async findByIdentifier(identifier: string): Promise<UserEntity | null> {
    const sql = `${USER_SELECT} WHERE LOWER(u.email) = $1 OR LOWER(u.username) = $1`;
    return (await this.getUsers(sql, [identifier]))[0] ?? null;
  }

  async create(user: UserEntity): Promise<UserEntity> {
    const fields = Object.keys(USER_COLUMNS) as UserField[];
    const columns = fields.map((field) => USER_COLUMNS[field]);
    const values: unknown[] = [user.id, user.role, ...fields.map((field) => user[field])];
    const placeholders = fields.map((_field, index) => `$${index + 3}`);
    await this.executeWrite(
      `INSERT INTO users (id, role_id, ${columns.join(', ')})
       VALUES ($1, (SELECT id FROM roles WHERE code = $2), ${placeholders.join(', ')})`,
      values,
    );
    return this.getRequiredUser(user.id);
  }

  async update(user: UserEntity, fields: UserField[]): Promise<UserEntity> {
    const values: unknown[] = [user.id];
    const assignments = fields.map((field) => {
      values.push(user[field]);
      return `${USER_COLUMNS[field]} = $${values.length}`;
    });
    if (fields.includes('roles')) {
      values.push(user.role);
      assignments.push(`role_id = (SELECT id FROM roles WHERE code = $${values.length})`);
    }
    assignments.push('updated_at = CURRENT_TIMESTAMP');
    const count = await this.executeWrite(
      `UPDATE users SET ${assignments.join(', ')} WHERE id = $1`, values,
    );
    if (!count) throw new NotFoundException('Không tìm thấy người dùng');
    return this.getRequiredUser(user.id);
  }

  private async getRequiredUser(id: string): Promise<UserEntity> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    return user;
  }

  private async getUsers(sql: string, values: unknown[] = []): Promise<UserEntity[]> {
    try {
      const result = await this.database.query<UserRow>(sql, values);
      return result.rows.map((row) => new UserEntity(row));
    } catch {
      throw new ServiceUnavailableException('Không thể đọc dữ liệu người dùng từ PostgreSQL');
    }
  }

  private async executeWrite(sql: string, values: unknown[]): Promise<number> {
    try {
      return (await this.database.query(sql, values)).rowCount ?? 0;
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new ConflictException('Tên đăng nhập hoặc email đã tồn tại');
      }
      throw new ServiceUnavailableException('Không thể lưu dữ liệu người dùng vào PostgreSQL');
    }
  }
}
