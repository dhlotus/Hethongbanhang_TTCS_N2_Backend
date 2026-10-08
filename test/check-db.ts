import { Pool } from 'pg';
import { databaseConnectionConfig } from '../src/database/database.config';

/**
 * Script kiểm tra trạng thái dữ liệu bảng categories & products trong PostgreSQL
 */
const pool = new Pool(databaseConnectionConfig);

async function checkDatabase(): Promise<void> {
  try {
    const cols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'categories'
      ORDER BY ordinal_position;
    `);
    console.log('--- 1. CẤU TRÚC BẢNG categories ---');
    console.log(cols.rows);

    const rows = await pool.query(`
      SELECT id, code, name, parent_id, level, path, status 
      FROM categories 
      ORDER BY id ASC;
    `);
    console.log(`\n--- 2. CÂY DANH MỤC TRONG POSTGRESQL (${rows.rows.length} nhóm) ---`);
    console.log(rows.rows);

    const pRows = await pool.query(`
      SELECT id, sku, name, category_id 
      FROM products 
      ORDER BY created_at DESC 
      LIMIT 10;
    `);
    console.log(`\n--- 3. SẢN PHẨM TRONG POSTGRESQL (${pRows.rows.length} SKU mới nhất) ---`);
    console.log(pRows.rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Lỗi kết nối hoặc truy vấn cơ sở dữ liệu:', msg);
  } finally {
    await pool.end();
  }
}

void checkDatabase();
