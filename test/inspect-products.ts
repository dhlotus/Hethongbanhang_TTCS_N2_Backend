import { Pool } from 'pg';
import { databaseConnectionConfig } from '../src/database/database.config';

const pool = new Pool(databaseConnectionConfig);

async function main() {
  try {
    const cats = await pool.query('SELECT id, code, name, level, parent_id FROM categories ORDER BY id ASC;');
    console.log('--- ALL CATEGORIES IN DB ---');
    cats.rows.forEach(c => console.log(`   [ID: ${c.id}] [${c.code}] ${c.name} (level: ${c.level}, parent: ${c.parent_id})`));

    const prods = await pool.query(`
      SELECT p.id, p.sku, p.name, p.category_id, c.code as cat_code, c.name as cat_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      ORDER BY p.created_at ASC;
    `);
    console.log(`\n--- ALL PRODUCTS IN DB (${prods.rows.length}) ---`);
    prods.rows.forEach(p => console.log(`   [${p.sku}] ${p.name} | category_id: ${p.category_id} (${p.cat_code} - ${p.cat_name})`));
  } finally {
    await pool.end();
  }
}

main().catch(console.error);
