const ExcelJS = require('exceljs');

const BASE_URL = 'http://localhost:3000/api';

async function testSn220Filters() {
  console.log('================================================================');
  console.log('   KIỂM THỬ MỞ RỘNG BỘ LỌC XUẤT EXCEL TỒN KHO (SN-220)');
  console.log('================================================================\n');

  // Đăng nhập tài khoản Quản lý kho / Admin
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: '123456',
    }),
  });
  let loginJson = await loginRes.json();
  let token = loginJson.accessToken || loginJson.data?.accessToken;
  if (!token) {
    const fallbackRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'warehouse',
        password: 'password',
      }),
    });
    loginJson = await fallbackRes.json();
    token = loginJson.accessToken || loginJson.data?.accessToken;
  }
  const headers = { Authorization: `Bearer ${token}` };

  const testCases = [
    {
      name: '1. Xuất tồn kho Tất cả kho (ALL)',
      params: { warehouseId: 'ALL' },
      expectedCodeInFileName: 'ALL',
    },
    {
      name: '2. Xuất tồn kho theo Kho Miền Nam (KHO-MN-01)',
      params: { warehouseId: '11111111-0000-0000-0000-000000000001' },
      expectedCodeInFileName: 'KHO-MN-01',
    },
    {
      name: '3. Xuất tồn kho theo Kho Miền Bắc (KHO-MB-01)',
      params: { warehouseId: '11111111-0000-0000-0000-000000000002' },
      expectedCodeInFileName: 'KHO-MB-01',
    },
    {
      name: '4. Xuất tồn kho kết hợp bộ lọc danh mục và trạng thái (Kho Miền Nam - Hết hàng)',
      params: {
        warehouseId: '11111111-0000-0000-0000-000000000001',
        category: 'Sữa & Chế phẩm sữa',
        status: 'OUT_OF_STOCK',
      },
      expectedCodeInFileName: 'KHO-MN-01',
    },
    {
      name: '5. Xuất tồn kho kèm từ khóa tìm kiếm sản phẩm',
      params: {
        warehouseId: 'ALL',
        search: 'Sữa',
      },
      expectedCodeInFileName: 'ALL',
    },
  ];

  for (const tc of testCases) {
    console.log(`\n--- Test Case: ${tc.name} ---`);
    const searchParams = new URLSearchParams(tc.params);
    const res = await fetch(`${BASE_URL}/inventory/stock/export-excel?${searchParams.toString()}`, {
      headers,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const fileName = match ? match[1] : '';
    console.log(`   -> Header Content-Disposition: "${disposition}"`);
    console.log(`   -> Tên tệp trả về: "${fileName}"`);

    if (!fileName.includes(tc.expectedCodeInFileName)) {
      throw new Error(`FAIL: Tên tệp "${fileName}" không chứa mã kho kỳ vọng "${tc.expectedCodeInFileName}"`);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    if (!fileName.includes(todayStr)) {
      throw new Error(`FAIL: Tên tệp "${fileName}" không chứa ngày xuất hiện tại "${todayStr}"`);
    }

    const buffer = await res.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.getWorksheet('Bao_Cao_Ton_Kho') || workbook.worksheets[0];

    const h7 = ws.getRow(5).getCell(7).value;
    const h8 = ws.getRow(5).getCell(8).value;
    const h9 = ws.getRow(5).getCell(9).value;
    if (h7 !== 'Tồn Thực Tế' || h8 !== 'Tồn Tạm Giữ' || h9 !== 'Tồn Khả Dụng') {
      throw new Error(`FAIL: Header 3 cột tồn không chuẩn: "${h7}", "${h8}", "${h9}"`);
    }

    console.log(`   -> [PASS] Tên tệp chuẩn, 3 cột tồn ("${h7}", "${h8}", "${h9}") được bảo toàn nguyên vẹn.`);
  }

  console.log('\n================================================================');
  console.log('   ✅ TẤT CẢ TEST CASES BỘ LỌC SN-220 ĐỀU ĐẠT CHUẨN 100%!');
  console.log('================================================================\n');
}

testSn220Filters().catch((err) => {
  console.error('\n❌ KIỂM THỬ BỘ LỌC THẤT BẠI:', err.message);
  process.exit(1);
});
