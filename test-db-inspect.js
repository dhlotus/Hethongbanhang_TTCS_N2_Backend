const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: 'postgresql://postgres:huong123@localhost:5432/htbh_db' });
  await client.connect();

  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  console.log('Tables:', tables.rows.map(r => r.table_name));

  const hasTransfers = tables.rows.some(r => r.table_name === 'internal_transfers');
  console.log('hasTransfers:', hasTransfers);
  if (hasTransfers) {
    const cols = await client.query("SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name='internal_transfers'");
    console.log('internal_transfers columns:', cols.rows);
    const itemCols = await client.query("SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name='internal_transfer_items'");
    console.log('internal_transfer_items columns:', itemCols.rows);
  }

  // Check inventory for KHO-MB-01 and LOHA-COLA-330
  const inv = await client.query("SELECT * FROM inventories WHERE product_sku = 'LOHA-COLA-330'");
  console.log('Inventories for LOHA-COLA-330:', inv.rows);

  await client.end();
}

run().catch(console.error);
