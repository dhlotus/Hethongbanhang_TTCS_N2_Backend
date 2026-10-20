const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const c = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await c.connect();

  const constraints = await c.query(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint 
    WHERE contype = 'c';
  `);
  console.log('CHECK CONSTRAINTS:');
  for (const r of constraints.rows) {
    console.log(r.conname, '=>', r.def);
  }

  const enums = await c.query(`
    SELECT t.typname, string_agg(e.enumlabel, ', ') as labels
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    GROUP BY t.typname;
  `);
  console.log('\nENUMS:');
  for (const r of enums.rows) {
    console.log(r.typname, '=>', r.labels);
  }

  // Also check distinct statuses currently in tables
  const invStatuses = await c.query(`SELECT DISTINCT payment_status FROM invoices;`);
  console.log('\nCurrent invoice payment_status in DB:', invStatuses.rows.map(r => r.payment_status));

  const orderStatuses = await c.query(`SELECT DISTINCT status FROM orders;`);
  console.log('\nCurrent order status in DB:', orderStatuses.rows.map(r => r.status));

  await c.end();
}
main().catch(console.error);
