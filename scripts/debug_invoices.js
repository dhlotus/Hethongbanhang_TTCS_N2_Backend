const { Client } = require('pg');
require('dotenv').config();

async function check() {
  const c = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await c.connect();
  const dbInvs = await c.query('SELECT code, customer_id FROM invoices WHERE customer_id = $1', ['55555555-0000-0000-0000-000000000001']);
  console.log('DB Invoices count:', dbInvs.rows.length);
  console.log('DB Invoices codes:', dbInvs.rows.map(r => r.code));
  await c.end();

  const loginRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dealer', password: '123456' })
  });
  const loginData = await loginRes.json();
  const token = loginData.accessToken || loginData.token;

  const res = await fetch('http://localhost:3000/api/invoices', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const apiInvs = await res.json();
  console.log('API Invoices count:', apiInvs.length);
  console.log('API Invoices codes:', apiInvs.map(r => r.invoiceCode));

  const diff = apiInvs.filter(a => !dbInvs.rows.some(d => d.code === a.invoiceCode));
  console.log('In API but not in DB count:', diff.length);
  console.log('In API but not in DB:', diff.map(d => ({ code: d.invoiceCode, id: d.id, customerId: d.customerId })));
}

check().catch(console.error);
