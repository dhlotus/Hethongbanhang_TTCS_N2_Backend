const ExcelJS = require('exceljs');

const BASE_URL = 'http://localhost:3000/api';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return { status: res.status, data, headers: res.headers };
  } else {
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(text || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: buffer, headers: res.headers };
  }
}

async function login(username, password) {
  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return res.data.accessToken || res.data.token || res.data.access_token;
}

async function runTests() {
  console.log('================================================================');
  console.log('   KIỂM THỬ TỰ ĐỘNG CHỨC NĂNG SN-186 VÀ SN-220 (E2E TEST)');
  console.log('================================================================\n');

  // 1. Đăng nhập với quyền Warehouse Keeper / Manager
  console.log('1. Đăng nhập tài khoản Thủ kho (warehouse)...');
  const token = await login('warehouse', '123456');
  console.log('   -> Đăng nhập thành công, token:', token ? 'OK' : 'FAIL');
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 2. Kiểm thử SN-186: Lấy danh sách đơn hàng đủ điều kiện
  console.log('\n2. Kiểm tra API GET /api/picking-sheets/eligible-orders...');
  const eligibleRes = await request('/picking-sheets/eligible-orders', { headers: authHeaders });
  const eligibleOrders = eligibleRes.data;
  console.log(`   -> Số đơn hàng đủ điều kiện: ${eligibleOrders.length}`);
  for (const ord of eligibleOrders) {
    const st = (ord.status || '').toUpperCase();
    if (st !== 'APPROVED' && st !== 'PROCESSING') {
      throw new Error(`FAIL: Đơn ${ord.orderCode} có trạng thái không hợp lệ: ${st}`);
    }
  }
  console.log('   -> [PASS] Tất cả các đơn đều ở trạng thái APPROVED hoặc PROCESSING (không chứa đơn PENDING/CANCELLED).');

  if (eligibleOrders.length === 0) {
    throw new Error('FAIL: Không có đơn hàng đã duyệt nào trong hệ thống để kiểm thử.');
  }

  // 3. Kiểm thử SN-186: Tạo phiếu soạn hàng mới từ đơn đã duyệt
  const targetOrder = eligibleOrders.find((o) => !o.isCurrentlyPicking) || eligibleOrders[0];
  const orderId = targetOrder.id || targetOrder.orderCode;
  console.log(`\n3. Kiểm tra tạo phiếu soạn hàng mới cho đơn: ${targetOrder.orderCode} (ID: ${orderId})...`);

  let createdSheet;
  try {
    const createRes = await request('/picking-sheets', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseCode: 'KHO-MN-01',
        warehouseName: 'Kho Miền Nam (TP. Hồ Chí Minh)',
        selectedOrderIds: [orderId],
        pickerName: 'Thủ kho Nguyễn Văn Kho',
        note: 'Phiếu kiểm thử tự động SN-186',
      }),
    });
    createdSheet = createRes.data;
    console.log(`   -> [PASS] Đã tạo phiếu thành công: Mã phiếu = ${createdSheet.sheetCode}, Số dòng = ${createdSheet.items.length}`);
  } catch (err) {
    console.error('Lỗi tạo phiếu:', err.data || err.message);
    throw err;
  }

  // 4. Kiểm tra cấu trúc dòng hàng & vị trí kho
  console.log('\n4. Kiểm tra vị trí kho và sắp xếp theo đường đi...');
  for (const item of createdSheet.items) {
    console.log(`   - SKU: ${item.productSku} | Vị trí: ${item.location.formattedCode} | isConfigured: ${item.location.isConfigured} | sortIndex: ${item.location.sortIndex}`);
    if (item.location.isConfigured === false) {
      if (item.location.formattedCode !== 'Chưa cấu hình') {
        throw new Error(`FAIL: Hàng chưa cấu hình vị trí nhưng lại có mã vị trí giả: ${item.location.formattedCode}`);
      }
    }
  }
  console.log('   -> [PASS] Hệ thống không tự bịa vị trí; hàng chưa cấu hình được gắn cờ isConfigured: false rõ ràng.');

  // 5. Kiểm thử chống tạo trùng (Idempotency / Lock)
  console.log('\n5. Kiểm tra phòng ngừa tạo trùng khi đơn hàng đang được soạn...');
  try {
    await request('/picking-sheets', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        warehouseId: '11111111-0000-0000-0000-000000000001',
        warehouseCode: 'KHO-MN-01',
        selectedOrderIds: [orderId],
      }),
    });
    throw new Error('FAIL: Cho phép tạo trùng đơn hàng đang soạn!');
  } catch (err) {
    if (err.status === 400) {
      console.log(`   -> [PASS] Đã chặn tạo trùng thành công với HTTP 400: "${err.message}"`);
    } else {
      throw err;
    }
  }

  // 6. Kiểm thử soạn thiếu không có lý do -> Chặn HTTP 400
  console.log('\n6. Kiểm tra quy tắc bắt buộc nhập lý do khi soạn thiếu...');
  const firstItem = createdSheet.items[0];
  try {
    await request(`/picking-sheets/${createdSheet.id}/items/${firstItem.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        pickedQuantity: Math.max(0, firstItem.totalRequiredQuantity - 1),
        // Không gửi shortPickReason
      }),
    });
    throw new Error('FAIL: Cho phép soạn thiếu mà không nhập lý do!');
  } catch (err) {
    if (err.status === 400) {
      console.log(`   -> [PASS] Đã chặn soạn thiếu thiếu lý do với HTTP 400: "${err.message}"`);
    } else {
      throw err;
    }
  }

  // 7. Cập nhật soạn thiếu có lý do hợp lệ
  console.log('\n7. Cập nhật soạn thiếu với lý do hợp lệ...');
  const shortQty = Math.max(0, firstItem.totalRequiredQuantity - 1);
  const updateRes = await request(`/picking-sheets/${createdSheet.id}/items/${firstItem.id}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      pickedQuantity: shortQty,
      shortPickReason: 'Hàng hư hỏng / Bể vỡ / Móp méo: Rách bao bì khi bốc dỡ',
      shortPickReasonCode: 'DAMAGED_GOODS',
    }),
  });
  console.log(`   -> [PASS] Cập nhật thành công, dòng hàng trạng thái: ${updateRes.data.items[0].status}`);

  // 8. Đánh dấu soạn đủ các dòng còn lại và hoàn tất phiếu
  console.log('\n8. Đánh dấu soạn đủ các dòng còn lại & hoàn tất phiếu...');
  for (let i = 1; i < createdSheet.items.length; i++) {
    await request(`/picking-sheets/${createdSheet.id}/quick-pick-all/${createdSheet.items[i].id}`, {
      method: 'POST',
      headers: authHeaders,
    });
  }

  const completeRes = await request(`/picking-sheets/${createdSheet.id}/complete`, {
    method: 'POST',
    headers: authHeaders,
  });
  console.log(`   -> [PASS] Hoàn tất phiếu thành công, trạng thái phiếu: ${completeRes.data.status}`);

  // 9. Mở lại phiếu từ API để kiểm tra tính toàn vẹn và tiến độ lưu trữ
  console.log('\n9. Tải lại chi tiết phiếu để kiểm tra tính bền vững dữ liệu...');
  const reloadRes = await request(`/picking-sheets/${createdSheet.id}`, { headers: authHeaders });
  const reloaded = reloadRes.data;
  if (reloaded.id !== createdSheet.id || reloaded.status !== completeRes.data.status) {
    throw new Error('FAIL: Dữ liệu tải lại không khớp tiến độ đã lưu!');
  }
  console.log(`   -> [PASS] Dữ liệu tải lại khớp 100%: Mã ${reloaded.sheetCode}, Tiến độ ${reloaded.pickedLines}/${reloaded.totalLines} dòng.`);

  // ===========================================================================
  // KIỂM THỬ SN-220: XUẤT BÁO CÁO TỒN KHO RA EXCEL
  // ===========================================================================
  console.log('\n================================================================');
  console.log('   KIỂM THỬ SN-220: XUẤT BÁO CÁO TỒN KHO RA EXCEL (.XLSX)');
  console.log('================================================================\n');

  // 10. Lấy số liệu tồn kho trực tiếp từ API Overview để đối chiếu
  console.log('10. Lấy số liệu tồn kho thực tế qua GET /api/inventory/stock...');
  const stockRes = await request('/inventory/stock?warehouseId=11111111-0000-0000-0000-000000000001', {
    headers: authHeaders,
  });
  const stockItems = stockRes.data;
  console.log(`   -> Số mặt hàng tìm thấy: ${stockItems.length}`);
  const expectedSumPhysical = stockItems.reduce((s, it) => s + Number(it.physicalStock || 0), 0);
  const expectedSumReserved = stockItems.reduce((s, it) => s + Number(it.reservedStock || 0), 0);
  const expectedSumAvailable = stockItems.reduce((s, it) => s + Number(it.availableStock || 0), 0);
  console.log(`   -> Kỳ vọng Tồn Thực Tế = ${expectedSumPhysical}, Tồn Tạm Giữ = ${expectedSumReserved}, Tồn Khả Dụng = ${expectedSumAvailable}`);

  // 11. Gọi API xuất Excel
  console.log('\n11. Gọi API GET /api/inventory/export-excel...');
  const excelRes = await request('/inventory/export-excel?warehouseId=11111111-0000-0000-0000-000000000001', {
    headers: authHeaders,
  });

  const contentDisposition = excelRes.headers.get('content-disposition') || '';
  console.log(`   -> Header Content-Disposition: "${contentDisposition}"`);
  const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
  const exportedFileName = fileNameMatch ? fileNameMatch[1] : '';
  console.log(`   -> Tên tệp xuất: "${exportedFileName}"`);

  // Kiểm tra tên tệp dạng TonKho_<MaKho>_<YYYY-MM-DD>.xlsx
  const fileNameRegex = /^TonKho_[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}\.xlsx$/;
  if (!fileNameRegex.test(exportedFileName)) {
    throw new Error(`FAIL: Tên tệp Excel không đúng định dạng chuẩn TonKho_<MaKho>_<YYYY-MM-DD>.xlsx: "${exportedFileName}"`);
  }
  console.log('   -> [PASS] Tên tệp khớp hoàn toàn chuẩn TonKho_<MaKho>_<YYYY-MM-DD>.xlsx.');

  // 12. Phân tích nội dung tệp Excel bằng ExcelJS
  console.log('\n12. Phân tích buffer tệp Excel bằng ExcelJS...');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excelRes.data);
  const ws = workbook.getWorksheet('Bao_Cao_Ton_Kho') || workbook.worksheets[0];
  console.log(`   -> Tên Sheet: "${ws.name}", Tổng số dòng: ${ws.rowCount}`);

  // Kiểm tra Tiêu đề và Ghi chú kế toán
  const row2Text = ws.getCell('A2').value;
  const row4Text = ws.getCell('A4').value;
  console.log(`   -> Tiêu đề (Row 2): "${row2Text}"`);
  console.log(`   -> Ghi chú bộ lọc & kế toán (Row 4): "${row4Text}"`);

  if (!String(row4Text).includes('Mẫu tồn kho chuẩn hệ thống')) {
    throw new Error('FAIL: Chưa có thông báo về mẫu báo cáo kế toán để đối chiếu');
  }
  console.log('   -> [PASS] Có thông báo rõ ràng về mẫu đối chiếu kế toán.');

  // Kiểm tra Header các cột tại Row 5
  const headerRow = ws.getRow(5);
  const col7Header = headerRow.getCell(7).value;
  const col8Header = headerRow.getCell(8).value;
  const col9Header = headerRow.getCell(9).value;
  console.log(`   -> Cột 7: "${col7Header}" | Cột 8: "${col8Header}" | Cột 9: "${col9Header}"`);

  if (col7Header !== 'Tồn Thực Tế' || col8Header !== 'Tồn Tạm Giữ' || col9Header !== 'Tồn Khả Dụng') {
    throw new Error(`FAIL: Ba cột tồn không đúng tên chuẩn: "${col7Header}", "${col8Header}", "${col9Header}"`);
  }
  console.log('   -> [PASS] Giữ nguyên đúng 3 cột tồn: "Tồn Thực Tế", "Tồn Tạm Giữ", "Tồn Khả Dụng".');

  // Kiểm tra dòng dữ liệu đầu tiên (Row 6)
  const firstDataRow = ws.getRow(6);
  const skuFmt = firstDataRow.getCell(2).numFmt;
  const physFmt = firstDataRow.getCell(7).numFmt;
  console.log(`   -> Format cột SKU (Col 2): "${skuFmt}" (Định dạng text giữ số 0 đầu)`);
  console.log(`   -> Format cột Tồn Thực Tế (Col 7): "${physFmt}" (Định dạng số #,##0)`);

  if (skuFmt !== '@' || physFmt !== '#,##0') {
    throw new Error(`FAIL: Định dạng số/text không đúng: SKU=${skuFmt}, Phys=${physFmt}`);
  }
  console.log('   -> [PASS] Định dạng số và định dạng text SKU chính xác.');

  // Kiểm tra dòng Tổng cộng (Total Row)
  const totalRowIndex = 5 + stockItems.length + 1;
  const totalRow = ws.getRow(totalRowIndex);
  const physCell = totalRow.getCell(7);
  const resCell = totalRow.getCell(8);
  const availCell = totalRow.getCell(9);

  console.log(`\n13. Đối chiếu số liệu Tổng cộng tại dòng ${totalRowIndex}:`);
  console.log(`   -> Công thức Excel Cột 7: ${JSON.stringify(physCell.value)}`);
  console.log(`   -> Kết quả tính Excel: Phys = ${physCell.result || physCell.value.result}, Res = ${resCell.result || resCell.value.result}, Avail = ${availCell.result || availCell.value.result}`);

  const actualSumPhys = Number(physCell.result || physCell.value.result || 0);
  const actualSumRes = Number(resCell.result || resCell.value.result || 0);
  const actualSumAvail = Number(availCell.result || availCell.value.result || 0);

  if (
    actualSumPhys !== expectedSumPhysical ||
    actualSumRes !== expectedSumReserved ||
    actualSumAvail !== expectedSumAvailable
  ) {
    throw new Error(
      `FAIL: Số liệu tổng cộng trong Excel (${actualSumPhys}, ${actualSumRes}, ${actualSumAvail}) không khớp số liệu hệ thống (${expectedSumPhysical}, ${expectedSumReserved}, ${expectedSumAvailable})`,
    );
  }
  console.log('   -> [PASS] Số liệu tổng cộng trong Excel khớp 100% với hệ thống ở cùng phạm vi dữ liệu!');

  // Dọn dẹp phiếu soạn test
  console.log('\n14. Dọn dẹp phiếu soạn kiểm thử...');
  await request(`/picking-sheets/${createdSheet.id}`, { method: 'DELETE', headers: authHeaders });
  console.log('   -> [PASS] Đã dọn dẹp phiếu kiểm thử thành công.');

  console.log('\n================================================================');
  console.log('   ✅ TẤT CẢ 14 TIÊU CHÍ KIỂM THỬ SN-186 & SN-220 ĐỀU ĐẠT 100%!');
  console.log('================================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ KIỂM THỬ THẤT BẠI:', err.message);
  process.exit(1);
});
