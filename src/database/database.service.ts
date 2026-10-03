import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      host: config.get<string>('DB_HOST', 'localhost'),
      port: Number(config.get<string>('DB_PORT', '5432')),
      user: config.get<string>('DB_USERNAME', 'postgres'),
      password: config.get<string>('DB_PASSWORD', ''),
      database: config.get<string>('DB_NAME', 'htbh_db'),
      connectionTimeoutMillis: 5000,
      max: 10,
    });
    this.pool.on('error', () => {
      console.error('Kết nối PostgreSQL nhàn rỗi bị ngắt; kết nối mới sẽ được tạo khi cần.');
    });
  }

  /**
   * @param sql Câu SQL với placeholder $1, $2, ...
   * @param values Giá trị bind, không ghép trực tiếp vào SQL.
   * @returns Kết quả truy vấn PostgreSQL.
   */
  query<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql, values);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
