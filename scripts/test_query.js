const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'huong123',
  database: 'htbh_db'
});
async function main() {
  try {
    const r = await pool.query(`
      SELECT r.id, r.order_id, r.product_id, r.quantity::text
      FROM stock_reservations r
      WHERE (r.warehouse_id = $1::uuid OR r.warehouse_id::text = $1)
    `, ['11111111-0000-0000-0000-000000000004']);
    console.log('Query without cast:', r.rows);
  } catch (e) {
    console.log('QUERY FAILED:', e.message);
  }

  try {
    const r2 = await pool.query(`
      SELECT r.id, r.order_id, r.product_id, r.quantity::text
      FROM stock_reservations r
      WHERE r.warehouse_id = $1
    `, ['11111111-0000-0000-0000-000000000004']);
    console.log('Query r.warehouse_id = $1 success, rows:', r2.rows.length);
  } catch (e) {
    console.log('r2 failed:', e.message);
  }
  await pool.end();
}
main().catch(console.error);
