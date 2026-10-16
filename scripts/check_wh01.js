const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:huong123@localhost:5432/htbh_db' });

async function run() {
  await client.connect();
  const tables = [
    'warehouse_locations', 'user_warehouses', 'inventories', 'inventory_batches',
    'inventory_transactions', 'goods_receipts', 'goods_issues', 'orders', 'return_orders',
    'app_inventory_stock_balances'
  ];
  for (const t of tables) {
    try {
      const res = await client.query(`SELECT count(*) FROM ${t} WHERE warehouse_id = '11111111-0000-4000-8000-000000000001'`);
      console.log(t, 'count for WH01:', res.rows[0].count);
    } catch (e) {
      console.log(t, 'error:', e.message);
    }
  }
  await client.end();
}
run();
