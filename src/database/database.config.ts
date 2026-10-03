import { PoolConfig } from 'pg';

/**
 * Cấu hình kết nối Cơ sở dữ liệu PostgreSQL cho LOHA SALES
 */
export const databaseConnectionConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'htbh_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};
