const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'huong123',
  database: 'htbh_db'
});

async function checkWarehouse(warehouseId, warehouseName) {
  // 1. Get on_hand and allocated from inventories
  const invRows = await pool.query(`
    SELECT UPPER(p.sku) as sku, p.name,
           COALESCE(i.on_hand, 0)::numeric as on_hand,
           COALESCE(i.allocated, 0)::numeric as allocated
    FROM products p
    LEFT JOIN inventories i ON i.product_id = p.id AND i.warehouse_id = $1::uuid
    ORDER BY p.sku;
  `, [warehouseId]);

  // 2. Get active stock reservations for this warehouse
  const resRows = await pool.query(`
    SELECT product_id, SUM(quantity)::numeric as reserved
    FROM stock_reservations
    WHERE status IN ('ACTIVE', 'RESERVED') AND expired_at > CURRENT_TIMESTAMP
      AND warehouse_id = $1
    GROUP BY product_id;
  `, [warehouseId]);

  const resMap = new Map(resRows.rows.map(r => [r.product_id.toUpperCase(), Number(r.reserved)]));

  console.log(`\n=== ${warehouseName} (${warehouseId}) ===`);
  let totalOnHand = 0;
  let totalReserved = 0;
  let totalAvailable = 0;

  for (const row of invRows.rows) {
    const onHand = Number(row.on_hand);
    const dbAlloc = Number(row.allocated);
    const resQty = resMap.get(row.sku) || 0;
    const reserved = Math.max(dbAlloc, resQty);
    const available = Math.max(0, onHand - reserved);

    totalOnHand += onHand;
    totalReserved += reserved;
    totalAvailable += available;

    if (reserved > 0 || row.sku === 'LOHA-COLA-330') {
      console.log(`  SKU: ${row.sku.padEnd(16)} | OnHand: ${String(onHand).padStart(6)} | Reserved: ${String(reserved).padStart(5)} | Available: ${String(available).padStart(6)}`);
    }
  }
  console.log(`Summary: Total OnHand: ${totalOnHand} | Total Reserved: ${totalReserved} | Total Available: ${totalAvailable}`);
}

async function main() {
  const mb = '11111111-0000-0000-0000-000000000002';
  const mt = '11111111-0000-0000-0000-000000000004';
  const mn = '11111111-0000-0000-0000-000000000001';
  const west = '11111111-0000-0000-0000-000000000003';

  await checkWarehouse(mb, 'Kho Miền Bắc');
  await checkWarehouse(mt, 'Kho Miền Trung');
  await checkWarehouse(mn, 'Kho Miền Nam');
  await checkWarehouse(west, 'Kho Miền Tây');

  await pool.end();
}
main().catch(console.error);
