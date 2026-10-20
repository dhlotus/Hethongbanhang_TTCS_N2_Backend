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

  // 1. Tạo các đơn hàng tương ứng trong bảng orders
  const orders = [
    { id: '77777777-0000-0000-0000-000000000021', code: 'DH2610-08811', amount: 15000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000022', code: 'DH2610-08822', amount: 20000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000023', code: 'DH2610-08833', amount: 9000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000024', code: 'DH2610-08844', amount: 18000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000025', code: 'DH2610-08855', amount: 10000000, status: 'CANCELLED' },
    { id: '77777777-0000-0000-0000-000000000026', code: 'DH2610-08866', amount: 14000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000027', code: 'DH2610-08877', amount: 16000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000028', code: 'DH2610-08888', amount: 6000000, status: 'DELIVERED' },
    { id: '77777777-0000-0000-0000-000000000029', code: 'DH2610-08899', amount: 8000000, status: 'DELIVERED' },
  ];

  for (const ord of orders) {
    await c.query(
      `INSERT INTO orders (id, code, customer_id, total_amount, status, created_at, updated_at)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET total_amount = $4, status = $5;`,
      [ord.id, ord.code, anBinhCustId, ord.amount, ord.status]
    );
  }

  // 2. Danh sách 10 hóa đơn thực tế khớp đầy đủ các tình huống SN-207 & SN-208
  const invoices = [
    // 1. Quá hạn 5 ngày
    {
      id: '88888888-0000-0000-0000-000000000021',
      code: 'HD2610-AB-01',
      orderId: '77777777-0000-0000-0000-000000000021',
      issueDate: '2026-09-25',
      dueDate: '2026-10-14', // Quá hạn 5 ngày
      totalAmount: 15000000,
      paidAmount: 5000000,
      remainingAmount: 10000000,
      status: 'OVERDUE',
      note: 'Đơn hàng An Bình - Quá hạn 5 ngày (SN-208 Cảnh báo nợ quá hạn)',
    },
    // 2. Quá hạn 1 ngày
    {
      id: '88888888-0000-0000-0000-000000000028',
      code: 'HD2610-AB-OD01',
      orderId: '77777777-0000-0000-0000-000000000028',
      issueDate: '2026-09-28',
      dueDate: '2026-10-18', // Quá hạn 1 ngày
      totalAmount: 6000000,
      paidAmount: 0,
      remainingAmount: 6000000,
      status: 'OVERDUE',
      note: 'Đơn hàng An Bình - Vừa quá hạn 1 ngày (SN-208 B Bắt đầu tính quá hạn)',
    },
    // 3. Đến hạn hôm nay
    {
      id: '88888888-0000-0000-0000-000000000023',
      code: 'HD2610-AB-03',
      orderId: '77777777-0000-0000-0000-000000000023',
      issueDate: '2026-10-05',
      dueDate: '2026-10-19', // Đến hạn hôm nay
      totalAmount: 9000000,
      paidAmount: 0,
      remainingAmount: 9000000,
      status: 'UNPAID',
      note: 'Đơn hàng An Bình - Đến hạn thanh toán hôm nay 19/10/2026 (SN-207)',
    },
    // 4. Còn đúng 1 ngày
    {
      id: '88888888-0000-0000-0000-000000000029',
      code: 'HD2610-AB-DUE1',
      orderId: '77777777-0000-0000-0000-000000000029',
      issueDate: '2026-09-30',
      dueDate: '2026-10-20', // Còn 1 ngày
      totalAmount: 8000000,
      paidAmount: 3000000,
      remainingAmount: 5000000,
      status: 'PARTIAL',
      note: 'Đơn hàng An Bình - Còn 1 ngày đến hạn thanh toán (SN-208 Sắp đến hạn)',
    },
    // 5. Còn đúng 2 ngày
    {
      id: '88888888-0000-0000-0000-000000000026',
      code: 'HD2610-AB-DUE2',
      orderId: '77777777-0000-0000-0000-000000000026',
      issueDate: '2026-10-01',
      dueDate: '2026-10-21', // Còn 2 ngày
      totalAmount: 14000000,
      paidAmount: 4000000,
      remainingAmount: 10000000,
      status: 'PARTIAL',
      note: 'Đơn hàng An Bình - Còn 2 ngày đến hạn (SN-208 Kiểm thử loại trừ)',
    },
    // 6. Đúng 3 ngày tới hạn (Kích hoạt email nhắc nợ tự động SN-208 A)
    {
      id: '88888888-0000-0000-0000-000000000022',
      code: 'HD2610-AB-02',
      orderId: '77777777-0000-0000-0000-000000000022',
      issueDate: '2026-10-01',
      dueDate: '2026-10-22', // Đúng 3 ngày tới hạn
      totalAmount: 20000000,
      paidAmount: 12000000,
      remainingAmount: 8000000,
      status: 'PARTIAL',
      note: 'Đơn hàng An Bình - Còn 3 ngày đến hạn (SN-208 A Kích hoạt email nhắc nợ)',
    },
    // 7. Còn 4 ngày (Chưa tới kỳ nhắc 3 ngày)
    {
      id: '88888888-0000-0000-0000-000000000027',
      code: 'HD2610-AB-DUE4',
      orderId: '77777777-0000-0000-0000-000000000027',
      issueDate: '2026-10-05',
      dueDate: '2026-10-23', // Còn 4 ngày
      totalAmount: 16000000,
      paidAmount: 0,
      remainingAmount: 16000000,
      status: 'UNPAID',
      note: 'Đơn hàng An Bình - Còn 4 ngày đến hạn (SN-208 Chưa đến kỳ nhắc trước 3 ngày)',
    },
    // 8. Đơn trong hạn bình thường (Còn 12 ngày)
    {
      id: '88888888-0000-0000-0000-000000000005',
      code: 'HD2609-005',
      orderId: '77777777-0000-0000-0000-000000000005',
      issueDate: '2026-10-01',
      dueDate: '2026-10-31', // Còn 12 ngày
      totalAmount: 12000000,
      paidAmount: 5000000,
      remainingAmount: 7000000,
      status: 'PARTIAL',
      note: 'Đơn hàng An Bình - Dư nợ trong hạn thông thường',
    },
    // 9. Đã thanh toán toàn bộ 100%
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
      note: 'Đơn hàng An Bình - Đã tất toán đủ 100% (SN-207 Thanh toán hết)',
    },
    // 10. Hóa đơn đã hủy
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

  let calculatedCurrentDebt = 0;
  for (const inv of invoices) {
    if (inv.status !== 'CANCELLED' && inv.status !== 'PAID') {
      calculatedCurrentDebt += inv.remainingAmount;
    }

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

    // Ghi chi tiết sản phẩm
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

  // Cập nhật current_debt chính xác
  await c.query(
    `UPDATE customers SET current_debt = $1 WHERE id = $2;`,
    [calculatedCurrentDebt, anBinhCustId]
  );

  console.log(`✅ Đã nạp thành công ${invoices.length} hóa đơn cho Đại Lý An Bình!`);
  console.log(`Tổng dư nợ cập nhật trong PostgreSQL: ${calculatedCurrentDebt.toLocaleString('vi-VN')} đ`);

  await c.end();
}

main().catch(console.error);
