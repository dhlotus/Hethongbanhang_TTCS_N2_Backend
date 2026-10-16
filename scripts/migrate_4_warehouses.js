const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres:huong123@localhost:5432/htbh_db' });

async function run() {
  await client.connect();
  console.log('--- MIGRATION: CỐ ĐỊNH 4 KHO CHÍNH ---');

  // 1. Cập nhật hoặc xóa kho phụ WH01 nếu có
  try {
    await client.query(`DELETE FROM app_inventory_stock_balances WHERE warehouse_id = '11111111-0000-4000-8000-000000000001'`);
    await client.query(`DELETE FROM warehouses WHERE id = '11111111-0000-4000-8000-000000000001'`);
  } catch (err) {
    console.warn('Note on WH01 cleanup:', err.message);
  }

  // 2. Tạm thời rename code để tránh đụng constraint warehouses_code_key
  await client.query(`
    UPDATE warehouses
    SET code = 'TMP_' || id
    WHERE id NOT IN ('11111111-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002');
  `);

  // 3. Chuẩn hóa 4 kho chính
  const standardWarehouses = [
    {
      id: '11111111-0000-0000-0000-000000000002',
      code: 'KHO-MB-01',
      name: 'Kho Miền Bắc (Hà Nội)',
      address: 'Lô CN-05 KCN Ninh Hiệp, Gia Lâm, Hà Nội',
      phone: '0243889002',
    },
    {
      id: '11111111-0000-0000-0000-000000000004',
      code: 'KHO-MT-01',
      name: 'Kho Miền Trung (Đà Nẵng)',
      address: 'KCN Hòa Khánh, Liên Chiểu, Đà Nẵng',
      phone: '0236389004',
    },
    {
      id: '11111111-0000-0000-0000-000000000001',
      code: 'KHO-MN-01',
      name: 'Kho Miền Nam (TP. Hồ Chí Minh)',
      address: 'Số 18 Đại lộ Độc Lập, KCN Sóng Thần 1, Dĩ An, Bình Dương',
      phone: '0274379001',
    },
    {
      id: '11111111-0000-0000-0000-000000000003',
      code: 'KHO-WEST-01',
      name: 'Kho Miền Tây (Cần Thơ)',
      address: 'Đường số 3 KCN Trà Nóc 1, Bình Thủy, Cần Thơ',
      phone: '0292389003',
    },
  ];

  for (const wh of standardWarehouses) {
    await client.query(`
      INSERT INTO warehouses (id, code, name, address, phone, status, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        code = EXCLUDED.code,
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        status = 'ACTIVE',
        updated_at = CURRENT_TIMESTAMP;
    `, [wh.id, wh.code, wh.name, wh.address, wh.phone]);
  }

  // 4. Không xóa các kho mới do người dùng tạo (giữ nguyên kho mở rộng)
  // const validIds = standardWarehouses.map(w => w.id);
  // await client.query(`DELETE FROM warehouses WHERE id NOT IN ($1, $2, $3, $4)`, validIds);

  const finalWhs = await client.query(`SELECT id, code, name, address FROM warehouses ORDER BY code`);
  console.log('✅ Đã chuẩn hóa 4 kho chính thành công trong DB:');
  console.table(finalWhs.rows);

  await client.end();
}

run().catch(console.error);
