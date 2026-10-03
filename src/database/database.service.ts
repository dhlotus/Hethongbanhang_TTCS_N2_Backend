import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { databaseConnectionConfig } from './database.config';

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
      this.pool = new Pool(databaseConnectionConfig);

      // Thử kết nối kiểm tra
      const client = await this.pool.connect();
      const res = await client.query('SELECT current_database() as db_name, version();');
      client.release();

      this.connected = true;
      const dbName = res.rows[0]?.db_name || databaseConnectionConfig.database;
      this.logger.log(`[PostgreSQL] Kết nối thành công tới database: ${dbName}`);
    } catch (err: unknown) {
      this.connected = false;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[PostgreSQL] Chưa thể kết nối cơ sở dữ liệu: ${message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('[PostgreSQL] Đã đóng kết nối pool.');
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
      throw new Error('Cơ sở dữ liệu PostgreSQL chưa sẵn sàng hoặc mất kết nối!');
    }
    const result = await this.pool.query<T>(text, params);
    return result.rows;
  }

  /**
   * Lấy client độc lập từ pool phục vụ giao dịch (Transaction)
   */
  async getClient(): Promise<PoolClient> {
    if (!this.pool || !this.connected) {
      throw new Error('Cơ sở dữ liệu PostgreSQL chưa sẵn sàng hoặc mất kết nối!');
    }
    return await this.pool.connect();
  }
}
