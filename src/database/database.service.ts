import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { databaseConnectionConfig, getDatabaseConnectionConfig } from './database.config';

/**
 * Service quản lý kết nối và thực thi truy vấn tới cơ sở dữ liệu PostgreSQL
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;
  private connected = false;

  async onModuleInit(): Promise<void> {
    try {
      const config = getDatabaseConnectionConfig();
      this.pool = new Pool(config);

      // Thử kết nối kiểm tra
      const client = await this.pool.connect();
      const res = await client.query('SELECT current_database() as db_name, version();');
      client.release();

      this.connected = true;
      const dbName = res.rows[0]?.db_name || config.database;

      this.logger.log(`[PostgreSQL] Kết nối thành công tới database: ${dbName}`);

      await this.ensureEssentialTables();
    } catch (err: unknown) {
      this.connected = false;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PostgreSQL] Chưa thể kết nối cơ sở dữ liệu: ${message}`);
    }
  }

  private async ensureEssentialTables(): Promise<void> {
    if (!this.pool || !this.connected) return;
    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS app_agency_default_warehouses (
          agency_key TEXT PRIMARY KEY,
          warehouse_id UUID NOT NULL,
          assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_inventory_stock_balances') THEN
            ALTER TABLE app_inventory_stock_balances
              ADD COLUMN IF NOT EXISTS warehouse_id UUID NOT NULL DEFAULT '11111111-0000-0000-0000-000000000001';
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'app_order_inventory_reservations') THEN
            ALTER TABLE app_order_inventory_reservations
              ADD COLUMN IF NOT EXISTS warehouse_id UUID NOT NULL DEFAULT '11111111-0000-0000-0000-000000000001';
          END IF;
        END $$;

        CREATE TABLE IF NOT EXISTS stock_reservations (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          warehouse_id TEXT NOT NULL DEFAULT '11111111-0000-0000-0000-000000000001',
          quantity NUMERIC(15, 2) NOT NULL CHECK (quantity > 0),
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          expired_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          released_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS product_price_histories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          product_id VARCHAR(255) NOT NULL,
          old_price NUMERIC(15, 2) NOT NULL,
          new_price NUMERIC(15, 2) NOT NULL,
          changed_by VARCHAR(255) NOT NULL,
          changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_product_price_histories_product_id
          ON product_price_histories(product_id);

        CREATE INDEX IF NOT EXISTS idx_product_price_histories_changed_at
          ON product_price_histories(changed_at DESC);
      `);
      this.logger.log('[PostgreSQL] Đã khởi tạo / đồng bộ các bảng cấu trúc kho và lịch sử giá thành công.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PostgreSQL] Lỗi khởi tạo cấu trúc bảng kho: ${msg}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('[PostgreSQL] Đã đóng kết nối pool.');
    }
  }

  /**
   * Đảm bảo kết nối tới PostgreSQL luôn sẵn sàng (Tự động kết nối lại nếu ban đầu bị mất kết nối)
   */
  async ensureConnection(): Promise<boolean> {
    if (this.connected && this.pool) {
      return true;
    }
    try {
      const config = getDatabaseConnectionConfig();
      if (this.pool) {
        await this.pool.end().catch(() => {});
      }
      this.pool = new Pool(config);
      const client = await this.pool.connect();
      const res = await client.query('SELECT current_database() as db_name, version();');
      client.release();

      this.connected = true;
      const dbName = res.rows[0]?.db_name || config.database;
      this.logger.log(`[PostgreSQL] Kết nối thành công tới database: ${dbName}`);
      await this.ensureEssentialTables();
      return true;
    } catch (err: unknown) {
      this.connected = false;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PostgreSQL] Chưa thể kết nối cơ sở dữ liệu: ${message}`);
      return false;
    }
  }

  /**
   * Kiểm tra trạng thái kết nối tới PostgreSQL
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Thực thi câu lệnh SQL với parameters và trả về mảng kết quả
   */
  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<T[]> {
    if (!this.pool || !this.connected) {
      const ok = await this.ensureConnection();
      if (!ok || !this.pool) {
        throw new Error('Cơ sở dữ liệu PostgreSQL chưa sẵn sàng hoặc mất kết nối!');
      }
    }
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  /**
   * Lấy client độc lập từ pool phục vụ giao dịch (Transaction)
   */
  async getClient(): Promise<PoolClient> {
    if (!this.pool || !this.connected) {
      const ok = await this.ensureConnection();
      if (!ok || !this.pool) {
        throw new Error('Cơ sở dữ liệu PostgreSQL chưa sẵn sàng hoặc mất kết nối!');
      }
    }
    return await this.pool.connect();
  }
}

