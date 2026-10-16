const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:huong123@localhost:5432/htbh_db' });

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT p.id, p.sku, p.name, COALESCE(SUM(i.on_hand), 0) AS total_on_hand,
           COUNT(i.id) AS wh_count
    FROM products p
    LEFT JOIN inventories i ON i.product_id = p.id
    GROUP BY p.id, p.sku, p.name
    ORDER BY p.sku;
  `);
  console.table(res.rows);
  await client.end();
}
run();
