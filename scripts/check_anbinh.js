const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const c = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await c.connect();
  const res = await c.query('SELECT code, customer_id, issue_date, due_date, total_amount, paid_amount, remaining_amount, payment_status, notes FROM invoices WHERE customer_id = $1', ['55555555-0000-0000-0000-000000000002']);
  console.log('An Binh invoices in DB count:', res.rows.length);
  console.log(res.rows);
  await c.end();
}
run().catch(console.error);
