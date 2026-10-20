const { Client } = require('pg');
const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'huong123',
  database: 'htbh_db',
});

async function run() {
  await client.connect();

  // Reset HD2610-003 to exactly 3 days in the future
  await client.query(`
    UPDATE invoices 
    SET due_date = CURRENT_DATE + INTERVAL '3 days',
        payment_status = 'PARTIAL',
        total_amount = 8500000,
        paid_amount = 6000000,
        remaining_amount = 2500000
    WHERE code = 'HD2610-003'
  `);

  // Reset HD2610-004 to exactly 5 days overdue
  await client.query(`
    UPDATE invoices 
    SET due_date = CURRENT_DATE - INTERVAL '5 days',
        payment_status = 'OVERDUE',
        total_amount = 6000000,
        paid_amount = 0,
        remaining_amount = 6000000
    WHERE code = 'HD2610-004'
  `);

  // Clear reminder logs for today so idempotency test can run fresh
  await client.query(`DELETE FROM app_debt_reminder_logs WHERE sent_date = CURRENT_DATE::text`);

  // Update customer current_debt
  const debtRes = await client.query(`
    SELECT COALESCE(SUM(remaining_amount), 0) as total_debt 
    FROM invoices 
    WHERE customer_id = '55555555-0000-0000-0000-000000000001' AND payment_status != 'CANCELLED';
  `);
  const totalDebt = Number(debtRes.rows[0].total_debt);
  await client.query(`UPDATE customers SET current_debt = $1 WHERE id = '55555555-0000-0000-0000-000000000001'`, [totalDebt]);

  console.log('SUCCESS: Invoices and customer debt updated! Total debt:', totalDebt);
  await client.end();
}

run().catch(console.error);
