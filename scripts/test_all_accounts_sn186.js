const BASE_URL = 'http://localhost:3000/api';

const ACCOUNTS = [
  { username: 'warehouse', role: 'Thủ kho (Phạm Hùng Kho)', expectAccess: true },
  { username: 'thukho', role: 'Thủ kho (Hoàng Minh Tuấn)', expectAccess: true },
  { username: 'warehousemanager', role: 'Quản lý kho (Đỗ Quốc Bảo)', expectAccess: true },
  { username: 'quanlykho', role: 'Quản lý kho (Vũ Thành Long)', expectAccess: true },
  { username: 'admin', role: 'Quản trị hệ thống (Admin)', expectAccess: true },
  { username: 'sales', role: 'Nhân viên kinh doanh (Trần Văn Nam)', expectAccess: false },
  { username: 'salesmanager', role: 'Quản lý kinh doanh (Lê Hoàng)', expectAccess: false }, // Sales Manager có thể xem danh sách nhưng không tạo/sửa phiếu kho
  { username: 'accountant', role: 'Kế toán (Vũ Mai Hoa)', expectAccess: false },
  { username: 'ketoan', role: 'Kế toán (Đặng Thu Hương)', expectAccess: false },
  { username: 'dealer', role: 'Đại lý B2B (Minh Khang)', expectAccess: false },
  { username: 'daily', role: 'Đại lý B2B (An Bình)', expectAccess: false },
];

async function login(username, password = '123456') {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login fail: ${res.status} - ${text}`);
  }
  const data = await res.json();
  return data.accessToken || data.token || data.access_token;
}

async function testAccount(acc) {
  const report = { username: acc.username, role: acc.role, login: false, viewEligible: null, createSheet: null };

  try {
    const token = await login(acc.username);
    report.login = true;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 1. Kiểm tra xem danh sách đơn đủ điều kiện soạn
    const resEligible = await fetch(`${BASE_URL}/picking-sheets/eligible-orders`, { headers });
    report.viewEligible = resEligible.status;

    // 2. Thử tạo phiếu soạn hàng
    const resCreate = await fetch(`${BASE_URL}/picking-sheets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        warehouseId: '11111111-0000-0000-0000-000000000001',
        selectedOrderIds: ['dummy-id-test'],
      }),
    });
    // Nếu có quyền tạo: trả về 400 (vì dummy id)
    // Nếu không có quyền: trả về 403 Forbidden
    report.createSheet = resCreate.status;
  } catch (err) {
    report.error = err.message;
  }

  return report;
}

async function main() {
  console.log('========================================================================');
  console.log('  KIỂM TRA TẤT CẢ TÀI KHOẢN ĐỐI VỚI PHÂN HỆ SOẠN HÀNG KHO (SN-186)');
  console.log('========================================================================\n');

  const results = [];
  for (const acc of ACCOUNTS) {
    const res = await testAccount(acc);
    results.push(res);
    console.log(`[${acc.username}] - ${acc.role}:`);
    console.log(`   + Đăng nhập: ${res.login ? 'Thành công' : 'Thất bại'}`);
    console.log(`   + GET /eligible-orders: HTTP ${res.viewEligible} (${res.viewEligible === 200 ? 'Được phép' : 'Bị chặn 403'})`);
    console.log(`   + POST /picking-sheets (Tạo phiếu): HTTP ${res.createSheet} (${res.createSheet === 400 ? 'Có quyền (Đã vào Controller xử lý)' : res.createSheet === 403 ? 'Bị chặn 403 (Không có quyền)' : res.createSheet})`);
    console.log('');
  }

  console.table(results);
}

main().catch(console.error);
