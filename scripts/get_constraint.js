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
  const res = await c.query(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'invoices_payment_status_check'`);
  console.log('Constraint:', res.rows[0]);
  await c.end();
}
run().catch(console.error);
