const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:huong123@localhost:5432/htbh_db' });

async function run() {
  await client.connect();
  const fks = await client.query(`
    SELECT
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'warehouses';
  `);
  console.log('FKs referencing warehouses:');
  console.table(fks.rows);
  await client.end();
}
run();
