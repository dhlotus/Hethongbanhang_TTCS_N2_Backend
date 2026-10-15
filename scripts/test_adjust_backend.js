const http = require('http');

async function loginAdmin() {
  const data = JSON.stringify({
    username: 'admin',
    password: '123456',
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch (e) {
            reject(new Error('Parse error: ' + body));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function adjustStock(token, payload) {
  const data = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: '/api/inventory/adjust',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, body });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function getStock(token, warehouseId) {
  return new Promise((resolve, reject) => {
    const query = warehouseId ? `?warehouse=${encodeURIComponent(warehouseId)}` : '';
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: `/api/inventory/stock${query}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, body });
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('1. Đăng nhập Admin...');
  const loginRes = await loginAdmin();
  const token = loginRes.accessToken || loginRes.access_token || loginRes.token;
  if (!token) {
    console.error('Login failed:', loginRes);
    return;
  }
  console.log('Đăng nhập thành công! User:', loginRes.user?.fullName);

  console.log('\n2. Kiểm tra tồn kho LOHA-COLA-330 tại KHO-MB-01 trước điều chỉnh:');
  const mbStockBefore = await getStock(token, 'KHO-MB-01');
  const mbItemBefore = mbStockBefore.data?.find?.((i) => i.sku === 'LOHA-COLA-330');
  console.log(`Kho Miền Bắc trước: ${mbItemBefore?.physicalStock} (Thực tế) | Kho: ${mbItemBefore?.warehouse}`);

  console.log('\n3. Thử điều chỉnh tồn kho KHÔNG gửi warehouseId (phải báo lỗi):');
  const missingWhRes = await adjustStock(token, {
    productSku: 'LOHA-COLA-330',
    quantityChange: 100,
    unit: 'Lon',
    reason: 'Test không có kho',
  });
  console.log('Response không có warehouseId (Status):', missingWhRes.status);
  console.log('Message:', missingWhRes.data?.message);

  console.log('\n4. Điều chỉnh tồn kho NHẬP +500 Lon vào KHO-MB-01 (KHO-MB-01):');
  const adjustMbRes = await adjustStock(token, {
    productSku: 'LOHA-COLA-330',
    warehouseId: '11111111-0000-0000-0000-000000000002',
    quantityChange: 500,
    unit: 'Lon',
    reason: 'Nhập bổ sung lô hàng chi nhánh Hà Nội',
  });
  console.log('Kết quả điều chỉnh:', adjustMbRes.data?.message);

  console.log('\n5. Kiểm tra lại tồn kho KHO-MB-01 sau khi nhập:');
  const mbStockAfter = await getStock(token, 'KHO-MB-01');
  const mbItemAfter = mbStockAfter.data?.find?.((i) => i.sku === 'LOHA-COLA-330');
  console.log(`Kho Miền Bắc sau: ${mbItemAfter?.physicalStock} (Thực tế) | Kho: ${mbItemAfter?.warehouse}`);

  console.log('\n6. Kiểm tra lại tồn kho KHO-MN-01 (phải không bị ảnh hưởng, vẫn là 9000):');
  const mnStock = await getStock(token, 'KHO-MN-01');
  const mnItem = mnStock.data?.find?.((i) => i.sku === 'LOHA-COLA-330');
  console.log(`Kho Miền Nam: ${mnItem?.physicalStock} (Thực tế) | Kho: ${mnItem?.warehouse}`);

  console.log('\n7. Kiểm tra tổng tồn kho toàn bộ hệ thống (Tất cả kho hàng):');
  const allStock = await getStock(token, 'ALL');
  const allItem = allStock.data?.find?.((i) => i.sku === 'LOHA-COLA-330');
  console.log(`Tất cả kho: ${allItem?.physicalStock} (Tổng = 9500 + 9000 + 9000 + 9000 = 36500)`);
}

main().catch(console.error);
