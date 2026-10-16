const http = require('http');

function post(path, body, cb) {
  const payload = JSON.stringify(body);
  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => cb(JSON.parse(d)));
  });
  req.write(payload);
  req.end();
}

function get(path, token, cb) {
  http.get({
    hostname: 'localhost',
    port: 3000,
    path,
    headers: { 'Authorization': 'Bearer ' + token }
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => cb(JSON.parse(d)));
  });
}

const pwd = '$2a$10$PMMYKzSVcu9izGpiFQMm0OokRLz9l6pHB7oulH9G9ijkKBimxKa9a';

post('/api/auth/login', { username: 'admin', password: pwd }, loginRes => {
  const token = loginRes?.accessToken || loginRes?.token;
  if (!token) {
    console.log('Login failed:', loginRes);
    return;
  }

  const mtId = '11111111-0000-0000-0000-000000000004';
  const mbId = '11111111-0000-0000-0000-000000000002';

  get('/api/inventory/stock?warehouseId=ALL', token, all => {
    const allReserved = (all || []).reduce((s, x) => s + (x.reservedStock || 0), 0);
    console.log('=== TẤT CẢ KHO HÀNG (ALL) === Total Reserved:', allReserved);
    const cola = (all || []).find(x => x.sku === 'LOHA-COLA-330');
    console.log('ALL Cola:', { onHand: cola.physicalStock, reserved: cola.reservedStock, avail: cola.availableStock });

    get('/api/inventory/stock?warehouseId=' + mtId, token, mt => {
      const mtTotalReserved = (mt || []).reduce((s, x) => s + (x.reservedStock || 0), 0);
      console.log('=== KHO MIỀN TRUNG === Total Reserved:', mtTotalReserved);
      const mtCola = (mt || []).find(x => x.sku === 'LOHA-COLA-330');
      console.log('Cola at Kho Miền Trung:', { onHand: mtCola.physicalStock, reserved: mtCola.reservedStock, avail: mtCola.availableStock });

      get('/api/inventory/stock?warehouseId=' + mbId, token, mb => {
        const mbTotalReserved = (mb || []).reduce((s, x) => s + (x.reservedStock || 0), 0);
        console.log('=== KHO MIỀN BẮC === Total Reserved:', mbTotalReserved);
        const mbCola = (mb || []).find(x => x.sku === 'LOHA-COLA-330');
        console.log('Cola at Kho Miền Bắc:', { onHand: mbCola.physicalStock, reserved: mbCola.reservedStock, avail: mbCola.availableStock });
      });
    });
  });
});
