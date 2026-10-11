const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  user: process.env.DB_USERNAME || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_DATABASE || 'lohasales',
  password: process.env.DB_PASSWORD || '123456',
  port: process.env.DB_PORT || 5432,
});

async function run() {
  await client.connect();
  const res = await client.query('SELECT * FROM warehouses');
  if (res.rows.length === 0) {
    console.log('Inserting default warehouse...');
    await client.query("INSERT INTO warehouses (id, code, name, type, address, is_active) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING", ['WH01', 'WH01', 'Kho T?ng Mi?n Nam - LOHA WH01', 'TOTAL', 'HCM', true]);
  }
  console.log('Warehouses OK');
  await client.end();
}

run().catch(console.error);
