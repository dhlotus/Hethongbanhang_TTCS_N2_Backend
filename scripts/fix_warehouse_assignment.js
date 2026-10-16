const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: 'postgresql://postgres:huong123@localhost:5432/htbh_db',
  });
  await client.connect();

  console.log('--- 1. Warehouse Users ---');
  const usersRes = await client.query(`
    SELECT u.id, u.username, u.full_name, r.code as role
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE r.code LIKE '%WAREHOUSE%' OR r.code LIKE '%WH%'
  `);
  console.log(usersRes.rows);

  console.log('--- 2. Warehouses Before ---');
  const whRes = await client.query(`
    SELECT id, code, name, manager_id
    FROM warehouses
    ORDER BY code
  `);
  console.log(whRes.rows);

  console.log('--- 3. Applying 1-1 Assignment ---');
  // 1. Reset all manager_id to NULL
  await client.query(`UPDATE warehouses SET manager_id = NULL`);

  // 2. Assign keepers:
  // Hoàng Minh Tuấn (thukho) -> KHO-MB-01
  // Phạm Hùng Kho (warehouse) -> KHO-MN-01
  const mbRes = await client.query(`
    UPDATE warehouses 
    SET manager_id = '00000000-0000-0000-0000-000000000015'
    WHERE code = 'KHO-MB-01'
    RETURNING id, code, name, manager_id
  `);
  console.log('Assigned KHO-MB-01:', mbRes.rows);

  const mnRes = await client.query(`
    UPDATE warehouses 
    SET manager_id = '00000000-0000-0000-0000-000000000005'
    WHERE code = 'KHO-MN-01'
    RETURNING id, code, name, manager_id
  `);
  console.log('Assigned KHO-MN-01:', mnRes.rows);

  // 3. Sync user_warehouses
  await client.query(`DELETE FROM user_warehouses`);
  await client.query(`
    INSERT INTO user_warehouses (user_id, warehouse_id, is_primary)
    SELECT manager_id, id, true FROM warehouses WHERE manager_id IS NOT NULL
  `);

  console.log('--- 4. Verify Warehouses After Fix ---');
  const whAfter = await client.query(`
    SELECT w.id, w.code, w.name, w.manager_id, u.full_name as manager_name, r.code as role
    FROM warehouses w
    LEFT JOIN users u ON w.manager_id = u.id
    LEFT JOIN roles r ON r.id = u.role_id
    ORDER BY w.code
  `);
  console.log(whAfter.rows);

  const uwAfter = await client.query(`SELECT * FROM user_warehouses`);
  console.log('user_warehouses:', uwAfter.rows);

  await client.end();
  console.log('Database updated successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
