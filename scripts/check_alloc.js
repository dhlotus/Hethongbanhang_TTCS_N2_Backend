const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', user: 'postgres', password: 'huong123', database: 'htbh_db' });

async function test() {
  const client = await pool.connect();
  const orderId = 'ord-0e8082a2-047c-488e-a48a-c1a35509ea0c';
  try {
    await client.query('BEGIN');
    console.log('1. Loading locked order...');
    const result = await client.query(
      'SELECT payload FROM app_order_records WHERE id = $1 OR order_code = $1 LIMIT 1 FOR UPDATE',
      [orderId]
    );
    const order = typeof result.rows[0].payload === 'string' ? JSON.parse(result.rows[0].payload) : result.rows[0].payload;
    console.log('Order loaded, lines:', order.lines?.length);

    console.log('2. Updating stock_reservations...');
    await client.query(
      `UPDATE stock_reservations
       SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
       WHERE order_id = $1 AND status IN ('ACTIVE', 'RESERVED')`,
      [order.id]
    );

    console.log('3. Updating app_order_inventory_reservations...');
    await client.query(
      `UPDATE app_order_inventory_reservations
       SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
       WHERE order_id = $1 AND status = 'RESERVED'`,
      [order.id]
    );

    console.log('4. Updating inventories...');
    if (order.lines) {
      const whId = order.warehouseId || '11111111-0000-0000-0000-000000000001';
      for (const line of order.lines) {
        const qty = line.baseQuantity || line.quantity;
        console.log('Updating line:', line.productSku, 'qty:', qty, 'whId:', whId);
        await client.query(
          `UPDATE inventories
           SET allocated = GREATEST(0, allocated - $1), updated_at = CURRENT_TIMESTAMP
           WHERE warehouse_id = $2::uuid AND product_id = (SELECT id FROM products WHERE UPPER(sku) = UPPER($3) LIMIT 1)`,
          [qty, whId, line.productSku.trim()]
        );
      }
    }

    console.log('5. Updating app_order_records...');
    order.status = 'CANCELLED';
    order.cancelReason = 'test cancel';
    order.updatedAt = new Date();
    await client.query(
      `UPDATE app_order_records SET payload = $2::jsonb, updated_at = $3 WHERE id = $1`,
      [order.id, JSON.stringify(order), order.updatedAt]
    );

    console.log('6. Inserting app_order_approval_history...');
    await client.query(
      `INSERT INTO app_order_approval_history
       (order_id, action, comment, approver_id, approver_name, approver_roles)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        order.id,
        'REJECT',
        'Hủy đơn hàng: test cancel',
        'usr-admin-01',
        'Admin',
        ['ADMIN']
      ]
    );

    console.log('7. Updating customer debt with id::text = $2 OR code = $2...');
    if (order.grandTotal > 0 && order.customerId) {
      await client.query(
        `UPDATE customers SET current_debt = GREATEST(0, COALESCE(current_debt, 0) - $1), updated_at = NOW() WHERE id::text = $2 OR code = $2`,
        [order.grandTotal, order.customerId]
      );
    }

    console.log('ALL QUERIES IN CANCELORDER SUCCEEDED 100%!');
    await client.query('ROLLBACK');
  } catch (err) {
    console.error('ERROR OCCURRED:', err);
    await client.query('ROLLBACK');
  } finally {
    client.release();
    pool.end();
  }
}
test();
