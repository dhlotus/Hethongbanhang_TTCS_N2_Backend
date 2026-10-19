const { Client } = require('pg');
const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'huong123',
  database: 'htbh_db'
});

async function main() {
  await client.connect();
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '%transfer%'");
  console.log('Tables matching transfer:', tables.rows);

  const cols1 = await client.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'internal_transfers'");
  console.log('internal_transfers columns:', cols1.rows);

  const cols2 = await client.query("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'internal_transfer_items'");
  console.log('internal_transfer_items columns:', cols2.rows);

  await client.end();
}
main().catch(console.error);
