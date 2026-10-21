const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const c = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await c.connect();

  const anBinhCustId = '55555555-0000-0000-0000-000000000002';

  // 1. Kiểm tra hoặc tạo các đơn hàng tương ứng
  const ordersData = [
    { id: '77777777-0000-0000-0000-000000000021', code: 'DH2610-08811', amount: 15000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000022', code: 'DH2610-08822', amount: 20000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000023', code: 'DH2610-08833', amount: 9000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000024', code: 'DH2610-08844', amount: 18000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000025', code: 'DH2610-08855', amount: 10000000, status: 'CANCELLED' },
  ];

  for (const ord of ordersData) {
    await c.query(
      `INSERT INTO orders (id, code, customer_id, total_amount, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET total_amount = $4, status = $5;`,
      [ord.id, ord.code, anBinhCustId, ord.amount, ord.status]
    );
  }

  // 2. Thêm các hóa đơn ví dụ chuẩn các tình huống SN-207 và SN-208
  const invoicesData = [
    {
      id: '88888888-0000-0000-0000-000000000021',
      code: 'HD2610-AB-01',
      orderId: '77777777-0000-0000-0000-000000000021',
      issueDate: '2026-09-25',
      dueDate: '2026-10-14', // Quá hạn 5 ngày -> Cảnh báo nợ quá hạn (SN-208 B)
      totalAmount: 15000000,
      paidAmount: 5000000,
      remainingAmount: 10000000,
      status: 'OVERDUE',
      note: 'Đơn hàng An Bình - Quá hạn 5 ngày (SN-208 B Cảnh báo nợ quá hạn)',
    },
    {
      id: '88888888-0000-0000-0000-000000000022',
      code: 'HD2610-AB-02',
      orderId: '77777777-0000-0000-0000-000000000022',
      issueDate: '2026-10-01',
      dueDate: '2026-10-22', // Đúng 3 ngày tới hạn -> Nhắc hạn thanh toán tự động (SN-208 A)
      totalAmount: 20000000,
      paidAmount: 12000000,
      remainingAmount: 8000000,
      status: 'PARTIAL',
      note: 'Đơn hàng An Bình - Còn 3 ngày đến hạn (SN-208 A Nhắc nợ tự động)',
    },
    {
      id: '88888888-0000-0000-0000-000000000023',
      code: 'HD2610-AB-03',
      orderId: '77777777-0000-0000-0000-000000000023',
      issueDate: '2026-10-05',
      dueDate: '2026-10-19', // Đến hạn hôm nay (SN-207)
      totalAmount: 9000000,
      paidAmount: 0,
      remainingAmount: 9000000,
      status: 'UNPAID',
      note: 'Đơn hàng An Bình - Đến hạn hôm nay 19/10/2026 (SN-207)',
    },
    {
      id: '88888888-0000-0000-0000-000000000024',
      code: 'HD2610-AB-04',
      orderId: '77777777-0000-0000-0000-000000000024',
      issueDate: '2026-09-15',
      dueDate: '2026-10-15',
      totalAmount: 18000000,
      paidAmount: 18000000,
      remainingAmount: 0,
      status: 'PAID',
      note: 'Đơn hàng An Bình - Đã tất toán đủ 100% chuyển khoản ngân hàng (SN-207)',
    },
    {
      id: '88888888-0000-0000-0000-000000000025',
      code: 'HD2610-AB-CAN',
      orderId: '77777777-0000-0000-0000-000000000025',
      issueDate: '2026-10-10',
      dueDate: '2026-10-25',
      totalAmount: 10000000,
      paidAmount: 0,
      remainingAmount: 0,
      status: 'CANCELLED',
      note: 'Hóa đơn đã hủy do đổi đơn hàng - Không tính vào công nợ (SN-207 Hóa đơn hủy)',
    },
  ];

  for (const inv of invoicesData) {
    const subtotal = Math.round(inv.totalAmount / 1.1);
    const tax = inv.totalAmount - subtotal;
    await c.query(
      `INSERT INTO invoices (
        id, code, customer_id, order_id, subtotal, discount_amount, tax_amount, total_amount, paid_amount, remaining_amount, payment_status, issue_date, due_date, notes, created_at, updated_at
      ) VALUES (
        $1::uuid, $2, $3::uuid, $4::uuid, $5, 0, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
      ) ON CONFLICT (code) DO UPDATE SET
        total_amount = $7,
        paid_amount = $8,
        remaining_amount = $9,
        payment_status = $10,
        due_date = $12,
        notes = $13;`,
      [
        inv.id,
        inv.code,
        anBinhCustId,
        inv.orderId,
        subtotal,
        tax,
        inv.totalAmount,
        inv.paidAmount,
        inv.remainingAmount,
        inv.status,
        inv.issueDate,
        inv.dueDate,
        inv.note,
      ]
    );

    // Ghi invoice_items mẫu
    await c.query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
    await c.query(
      `INSERT INTO invoice_items (
        invoice_id, product_id, product_sku, product_name, unit, quantity, ordered_quantity, unit_price, line_total, created_at
      ) VALUES (
        $1, '33333333-0000-4000-8000-000000000003', 'LH-NEST-70ML', 'Nước Yến Sào Chưng Đường Phèn Loha Nest 70ml', 'Hộp', 10, 10, $2, $3, NOW()
      );`,
      [inv.id, Math.round(inv.totalAmount / 10), inv.totalAmount]
    );
  }

  // 3. Cập nhật dư nợ tổng hợp cho đại lý An Bình
  // 7M (HD2609-005) + 10M (HD2610-AB-01) + 8M (HD2610-AB-02) + 9M (HD2610-AB-03) = 34.000.000 đ
  await c.query(
    `UPDATE customers SET current_debt = 34000000 WHERE id = $1;`,
    [anBinhCustId]
  );

  console.log('✅ Đã tạo thành công bộ dữ liệu hóa đơn SN-207 & SN-208 cho Đại Lý Bán Buôn An Bình:');
  const check = await c.query(
    `SELECT code, payment_status, total_amount, paid_amount, remaining_amount, due_date, notes FROM invoices WHERE customer_id = $1 ORDER BY due_date ASC;`,
    [anBinhCustId]
  );
  console.table(check.rows);

  await c.end();
}

main().catch(console.error);
