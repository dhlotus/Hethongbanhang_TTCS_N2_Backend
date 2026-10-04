import { Pool } from 'pg';
import { databaseConnectionConfig } from '../src/database/database.config';

const pool = new Pool(databaseConnectionConfig);

async function checkTreeAndProducts(): Promise<void> {
  try {
    console.log('=== 1. CÂY DANH MỤC TRONG POSTGRESQL ===');
    const catRes = await pool.query(`
      SELECT c.id, c.code, c.name, c.level, c.path, c.parent_id,
             p.name as parent_name,
             (SELECT COUNT(*) FROM products pr WHERE pr.category_id = c.id) as direct_product_count
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id
      ORDER BY c.level ASC, c.id ASC;
    `);

    catRes.rows.forEach(r => {
      const indent = '  '.repeat(r.level - 1);
      console.log(`${indent}├─ [ID ${r.id}] ${r.name} (${r.code}) [Cấp ${r.level}] -> ${r.direct_product_count} sản phẩm trực tiếp`);
    });

    console.log('\n=== 2. TẤT CẢ SẢN PHẨM & NHÓM HÀNG ĐÃ GẮN ===');
    const prodRes = await pool.query(`
      SELECT p.sku, p.name, p.category_id, c.name as category_name, c.code as category_code,
             pcat.name as parent_category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN categories pcat ON c.parent_id = pcat.id
      ORDER BY p.category_id ASC, p.sku ASC;
    `);

    console.log(`Tổng cộng: ${prodRes.rows.length} sản phẩm`);
    prodRes.rows.forEach(r => {
      const parent = r.parent_category_name ? `${r.parent_category_name} > ` : '';
      console.log(`[${r.sku}] ${r.name} --> Nhóm: [${r.category_id}] ${parent}${r.category_name || 'CHƯA GÁN'}`);
    });
  } catch (err) {
    console.error('Lỗi kiểm tra:', err);
  } finally {
    await pool.end();
  }
}

void checkTreeAndProducts();
