require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const c = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'htbh_db',
  });
  await c.connect();
  const tables = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  console.log('Tables:', tables.rows.map(r => r.table_name));

  // Count rows in key tables
  for (const t of ['customers', 'users', 'invoices', 'receipts', 'returns', 'orders', 'payments']) {
    try {
      const res = await c.query(`SELECT COUNT(*) FROM ${t}`);
      console.log(`Count ${t}:`, res.rows[0].count);
    } catch (e) {
      console.log(`Table ${t} does not exist or error:`, e.message);
    }
  }

  await c.end();
}
run().catch(console.error);
