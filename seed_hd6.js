const { Client } = require('pg');
const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'huong123', database: 'htbh_db' });

async function seedDedicated() {
  await c.connect();
  const whRes = await c.query('SELECT id FROM warehouses LIMIT 1');
  const whId = whRes.rows[0]?.id || '11111111-0000-0000-0000-000000000001';

  // 1. Order
  await c.query(`
    INSERT INTO orders (id, code, customer_id, warehouse_id, status, total_amount, order_source, created_at, updated_at)
    VALUES ('77777777-0000-0000-0000-000000000006', 'DH2610-09999', '55555555-0000-0000-0000-000000000001', $1, 'DELIVERED', 5000000, 'PORTAL_CUSTOMER', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET total_amount = 5000000;
  `, [whId]);

  // 2. Invoice
  await c.query(`
    INSERT INTO invoices (id, code, order_id, customer_id, issue_date, due_date, total_amount, paid_amount, remaining_amount, payment_status, notes, created_at, updated_at)
    VALUES ('88888888-0000-0000-0000-000000000006', 'HD2610-006', '77777777-0000-0000-0000-000000000006', '55555555-0000-0000-0000-000000000001',
      NOW(), NOW() + INTERVAL '15 days', 5000000, 0, 5000000, 'UNPAID', 'Hóa đơn chưa thanh toán - Nguyên nợ 100%', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET total_amount = 5000000, paid_amount = 0, remaining_amount = 5000000, payment_status = 'UNPAID';
  `);

  // 3. Sync customer debt
  const debtRes = await c.query(`
    SELECT COALESCE(SUM(remaining_amount), 0) as total_debt 
    FROM invoices 
    WHERE customer_id = '55555555-0000-0000-0000-000000000001' AND payment_status != 'CANCELLED';
  `);
  const totalDebt = Number(debtRes.rows[0].total_debt);
  await c.query(`UPDATE customers SET current_debt = $1 WHERE id = '55555555-0000-0000-0000-000000000001'`, [totalDebt]);

  console.log(`SEEDED HD2610-006 (UNPAID). Total customer debt updated to: ${totalDebt}`);
  await c.end();
}

seedDedicated();
