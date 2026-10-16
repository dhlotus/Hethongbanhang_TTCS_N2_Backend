const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:huong123@localhost:5432/htbh_db',
});

async function run() {
  await client.connect();
  console.log('Connected to PostgreSQL');

  const mb = '11111111-0000-0000-0000-000000000002';
  const mt = '11111111-0000-0000-0000-000000000004';
  const mn = '11111111-0000-0000-0000-000000000001';
  const west = '11111111-0000-0000-0000-000000000003';
  const all4 = [mb, mt, mn, west];

  // Đảm bảo 4 kho chuẩn đều tồn tại
  const whs = [
    { id: mb, code: 'KHO-MB-01', name: 'Kho Miền Bắc (Hà Nội)', address: 'Lô CN-05 KCN Ninh Hiệp, Gia Lâm, Hà Nội', phone: '0243889002' },
    { id: mt, code: 'KHO-MT-01', name: 'Kho Miền Trung (Đà Nẵng)', address: 'KCN Hòa Khánh, Liên Chiểu, Đà Nẵng', phone: '0236389004' },
    { id: mn, code: 'KHO-MN-01', name: 'Kho Miền Nam (TP. Hồ Chí Minh)', address: 'Số 18 Đại lộ Độc Lập, KCN Sóng Thần 1, Dĩ An, Bình Dương', phone: '0274379001' },
    { id: west, code: 'KHO-WEST-01', name: 'Kho Miền Tây (Cần Thơ)', address: 'Đường số 3 KCN Trà Nóc 1, Bình Thủy, Cần Thơ', phone: '0292389003' },
  ];

  for (const w of whs) {
    await client.query(
      `INSERT INTO warehouses (id, code, name, address, phone, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO UPDATE SET
         code = EXCLUDED.code,
         name = EXCLUDED.name,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         status = 'ACTIVE',
         updated_at = CURRENT_TIMESTAMP`,
      [w.id, w.code, w.name, w.address, w.phone],
    );
  }

  // Dọn dẹp kho cũ nếu còn
  await client.query(`DELETE FROM warehouses WHERE id NOT IN ($1, $2, $3, $4)`, all4);

  const products = await client.query('SELECT id, sku, name, status FROM products ORDER BY sku');
  console.log(`Found ${products.rows.length} products to distribute.`);

  for (const prod of products.rows) {
    const inv = await client.query(
      'SELECT warehouse_id, on_hand::numeric as on_hand FROM inventories WHERE product_id = $1',
      [prod.id],
    );
    const total = inv.rows.reduce((sum, r) => sum + Number(r.on_hand), 0);

    let totalToDist = total;
    if (totalToDist <= 0 && prod.status === 'ACTIVE') {
      totalToDist = 4000;
    }

    const base = Math.floor(totalToDist / 4);
    const rem = totalToDist - base * 4;

    const dist = {
      [mb]: base,
      [mt]: base,
      [mn]: base + rem,
      [west]: base,
    };

    for (const whId of all4) {
      const qty = dist[whId];
      await client.query(
        `INSERT INTO inventories (product_id, warehouse_id, on_hand, allocated)
         VALUES ($1, $2::uuid, $3, 0)
         ON CONFLICT (warehouse_id, product_id)
         DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = CURRENT_TIMESTAMP`,
        [prod.id, whId, qty],
      );

      await client.query(
        `INSERT INTO app_inventory_stock_balances (product_sku, warehouse_id, physical_quantity)
         VALUES ($1, $2::uuid, $3)
         ON CONFLICT (product_sku, warehouse_id)
         DO UPDATE SET physical_quantity = EXCLUDED.physical_quantity, updated_at = CURRENT_TIMESTAMP`,
        [prod.sku.toUpperCase(), whId, qty],
      );
    }
  }

  const check = await client.query(`
    SELECT w.code, w.name, count(*) as sku_count, sum(i.on_hand) as total_stock
    FROM inventories i
    JOIN warehouses w ON w.id = i.warehouse_id
    GROUP BY w.code, w.name
    ORDER BY w.code
  `);
  console.log('--- PHÂN BỔ TỒN KHO THÀNH CÔNG ---');
  console.table(check.rows);

  await client.end();
}

run().catch((err) => {
  console.error('Migration Error:', err);
  process.exit(1);
});
