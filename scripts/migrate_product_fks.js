const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'huong123',
    database: 'htbh_db'
  });
  await client.connect();

  const alters = [
    `ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_product_id_fkey,
     ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;`,
    `ALTER TABLE goods_receipt_items DROP CONSTRAINT IF EXISTS goods_receipt_items_product_id_fkey,
     ADD CONSTRAINT goods_receipt_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;`,
    `ALTER TABLE goods_issue_items DROP CONSTRAINT IF EXISTS goods_issue_items_product_id_fkey,
     ADD CONSTRAINT goods_issue_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;`,
    `ALTER TABLE inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_product_id_fkey,
     ADD CONSTRAINT inventory_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;`,
    `ALTER TABLE return_order_items DROP CONSTRAINT IF EXISTS return_order_items_product_id_fkey,
     ADD CONSTRAINT return_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;`,
    `ALTER TABLE inventory_batches DROP CONSTRAINT IF EXISTS inventory_batches_product_id_fkey,
     ADD CONSTRAINT inventory_batches_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;`,
  ];

  for (const sql of alters) {
    try {
      await client.query(sql);
      console.log('Executed:', sql.split('\n')[0]);
    } catch (err) {
      console.error('Error executing alter:', err.message);
    }
  }

  console.log('Updated FK constraints to ON DELETE CASCADE successfully.');
  await client.end();
}

main().catch(console.error);
