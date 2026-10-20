const http = require('http');
const ExcelJS = require('exceljs');

const BASE_URL = 'http://localhost:3000/api';

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        let data = buffer;
        if (contentType.includes('application/json')) {
          try {
            data = JSON.parse(buffer.toString('utf-8'));
          } catch (e) {
            data = buffer.toString('utf-8');
          }
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          buffer,
        });
      });
    });

    req.on('error', reject);

    if (body) {
      if (typeof body === 'object' && !Buffer.isBuffer(body)) {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

async function login(username, password) {
  const url = new URL(`${BASE_URL}/auth/login`);
  const res = await request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
    },
    { username, password },
  );
  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`Login failed for ${username}: ${JSON.stringify(res.data)}`);
  }
  return res.data.access_token || res.data.token;
}

async function runTests() {
  console.log('================================================================');
  console.log('   BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG CHỨC NĂNG SN-194/186 VÀ SN-229/220  ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // 1. Đăng nhập với các vai trò
  console.log('1. Đăng nhập hệ thống:');
  const tokenManager = await login('warehousemanager', '123456');
  assert(Boolean(tokenManager), 'Đăng nhập tài khoản Quản lý kho (warehousemanager) thành công');

  const tokenKeeper = await login('warehouse', '123456');
  assert(Boolean(tokenKeeper), 'Đăng nhập tài khoản Thủ kho (warehouse) thành công');

  const tokenDealer = await login('dealer', '123456');
  assert(Boolean(tokenDealer), 'Đăng nhập tài khoản Khách hàng / Đại lý (dealer) thành công');

  // =========================================================================
  // 2. KIỂM THỬ XUẤT BÁO CÁO TỒN KHO RA EXCEL (SN-229 / SN-220)
  // =========================================================================
  console.log('\n2. Kiểm thử Xuất Báo Cáo Tồn Kho Excel (SN-229 / SN-220):');

  // 2.1 Xuất toàn bộ dữ liệu tồn kho
  const urlExport = new URL(`${BASE_URL}/inventory/stock/export-excel`);
  const resExportAll = await request({
    hostname: urlExport.hostname,
    port: urlExport.port,
    path: `${urlExport.pathname}?warehouseId=wh-hcm-01`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenManager}`,
    },
  });

  assert(resExportAll.statusCode === 200, `API export trả về HTTP 200 (Thực tế: ${resExportAll.statusCode})`);
  assert(
    resExportAll.headers['content-type']?.includes('spreadsheetml.sheet'),
    'Header Content-Type là application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );

  const disposition = resExportAll.headers['content-disposition'] || '';
  console.log(`  -> Content-Disposition: ${disposition}`);
  assert(
    disposition.includes('TonKho_') && disposition.includes('.xlsx'),
    `Tên tệp đính kèm chứa tiền tố TonKho_ và đuôi .xlsx (${disposition})`,
  );

  // 2.2 Đọc và đối chiếu cấu trúc tệp Excel bằng ExcelJS
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(resExportAll.buffer);
  const worksheet = workbook.getWorksheet('Bao_Cao_Ton_Kho');
  assert(Boolean(worksheet), 'Tệp Excel có sheet "Bao_Cao_Ton_Kho"');

  // Hàng 5: Kiểm tra đúng tên, thứ tự và ý nghĩa của ba cột tồn
  const headerRow = worksheet.getRow(5);
  const col7Name = headerRow.getCell(7).value;
  const col8Name = headerRow.getCell(8).value;
  const col9Name = headerRow.getCell(9).value;

  console.log(`  -> Cột 7: "${col7Name}", Cột 8: "${col8Name}", Cột 9: "${col9Name}"`);
  assert(
    col7Name === 'Tồn Thực Tế' && col8Name === 'Tồn Tạm Giữ' && col9Name === 'Tồn Khả Dụng',
    'Giữ nguyên đầy đủ 3 cột tồn: đúng tên, thứ tự, ý nghĩa (Tồn Thực Tế, Tồn Tạm Giữ, Tồn Khả Dụng)',
  );

  // Kiểm tra dữ liệu chi tiết và dòng tổng
  let calcSumPhys = 0;
  let calcSumRes = 0;
  let calcSumAvail = 0;
  let dataRowCount = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 5 && rowNumber < worksheet.rowCount) {
      dataRowCount++;
      const skuVal = row.getCell(2).value;
      const physVal = Number(row.getCell(7).value || 0);
      const resVal = Number(row.getCell(8).value || 0);
      const availVal = Number(row.getCell(9).value || 0);

      calcSumPhys += physVal;
      calcSumRes += resVal;
      calcSumAvail += availVal;

      // Kiểm tra công thức Tồn Khả Dụng = Tồn Thực Tế - Tồn Tạm Giữ
      if (dataRowCount <= 3) {
        assert(
          availVal === physVal - resVal,
          `Dòng ${rowNumber} [${skuVal}]: Tồn khả dụng (${availVal}) = Tồn thực tế (${physVal}) - Tồn tạm giữ (${resVal})`,
        );
      }
    }
  });

  const totalRow = worksheet.getRow(worksheet.rowCount);
  const totalPhysObj = totalRow.getCell(7).value;
  const totalResObj = totalRow.getCell(8).value;
  const totalAvailObj = totalRow.getCell(9).value;

  const totalPhys = typeof totalPhysObj === 'object' ? totalPhysObj.result : totalPhysObj;
  const totalRes = typeof totalResObj === 'object' ? totalResObj.result : totalResObj;
  const totalAvail = typeof totalAvailObj === 'object' ? totalAvailObj.result : totalAvailObj;

  console.log(`  -> Số lượng mặt hàng xuất: ${dataRowCount}`);
  console.log(`  -> Dòng tổng: Thực tế = ${totalPhys}, Tạm giữ = ${totalRes}, Khả dụng = ${totalAvail}`);

  assert(totalPhys === calcSumPhys, `Khớp số liệu tổng Tồn Thực Tế (Excel: ${totalPhys}, Tính toán: ${calcSumPhys})`);
  assert(totalRes === calcSumRes, `Khớp số liệu tổng Tồn Tạm Giữ (Excel: ${totalRes}, Tính toán: ${calcSumRes})`);
  assert(totalAvail === calcSumAvail, `Khớp số liệu tổng Tồn Khả Dụng (Excel: ${totalAvail}, Tính toán: ${calcSumAvail})`);

  // =========================================================================
  // 3. KIỂM THỬ PHIẾU SOẠN HÀNG (SN-194 / SN-186)
  // =========================================================================
  console.log('\n3. Kiểm thử Tạo và Xử lý Phiếu Soạn Hàng (SN-194 / SN-186):');

  // 3.1 Lấy danh sách đơn hàng đủ điều kiện soạn
  const resEligible = await request({
    hostname: urlExport.hostname,
    port: urlExport.port,
    path: '/api/picking-sheets/eligible-orders',
    method: 'GET',
    headers: {
      Authorization: `Bearer ${tokenKeeper}`,
    },
  });

  assert(resEligible.statusCode === 200, 'Lấy danh sách đơn hàng đủ điều kiện soạn thành công');
  const eligibleOrders = resEligible.data || [];
  console.log(`  -> Tìm thấy ${eligibleOrders.length} đơn hàng đủ điều kiện soạn`);
  assert(eligibleOrders.length > 0, 'Hệ thống có sẵn đơn hàng đủ điều kiện');

  const pickableOrders = eligibleOrders.filter((o) => !o.isCurrentlyPicking);
  console.log(`  -> Số đơn sẵn sàng chưa nằm trong phiếu: ${pickableOrders.length}`);
  assert(pickableOrders.length > 0, 'Có ít nhất 1 đơn hàng sẵn sàng để tạo phiếu mới');

  const selectedOrders = pickableOrders.slice(0, 2);
  const selectedOrderIds = selectedOrders.map((o) => o.id || o.orderCode);
  console.log(`  -> Chọn gộp ${selectedOrderIds.length} đơn hàng: ${selectedOrderIds.join(', ')}`);

  // 3.2 Tạo phiếu soạn hàng (Gộp đơn)
  const resCreateSheet = await request(
    {
      hostname: urlExport.hostname,
      port: urlExport.port,
      path: '/api/picking-sheets',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenKeeper}`,
      },
    },
    {
      warehouseId: selectedOrders[0].warehouseId || '11111111-0000-0000-0000-000000000001',
      selectedOrderIds: selectedOrderIds,
      note: 'Kiểm thử soạn hàng tự động',
    },
  );

  if (resCreateSheet.statusCode !== 201) {
    console.error('  [ERROR Details]:', resCreateSheet.data);
  }
  assert(resCreateSheet.statusCode === 201, `Tạo phiếu soạn hàng thành công (HTTP ${resCreateSheet.statusCode})`);
  const sheet = resCreateSheet.data;
  console.log(`  -> Mã phiếu soạn tạo được: ${sheet.sheetCode}, Số dòng hàng: ${sheet.items?.length}`);
  assert(Boolean(sheet.sheetCode), `Phiếu có mã hợp lệ: ${sheet.sheetCode}`);
  assert(sheet.items && sheet.items.length > 0, 'Phiếu có đầy đủ danh sách dòng hàng');
  assert(sheet.orderCount === selectedOrderIds.length, `Số đơn gộp đúng (${sheet.orderCount})`);

  // Kiểm tra sắp xếp theo thứ tự S-Shape
  let isSorted = true;
  for (let i = 0; i < sheet.items.length - 1; i++) {
    if (sheet.items[i].location.sortIndex > sheet.items[i + 1].location.sortIndex) {
      isSorted = false;
      break;
    }
  }
  assert(isSorted, 'Dòng hàng được sắp xếp tối ưu theo thứ tự vị trí trong kho (S-Shape Routing)');

  // 3.3 Chống tạo trùng đơn hàng đang soạn
  console.log('\n  * Kiểm tra cơ chế chống tạo trùng đơn hàng đang soạn:');
  const resDuplicate = await request(
    {
      hostname: urlExport.hostname,
      port: urlExport.port,
      path: '/api/picking-sheets',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenKeeper}`,
      },
    },
    {
      warehouseId: selectedOrders[0].warehouseId || '11111111-0000-0000-0000-000000000001',
      selectedOrderIds: [selectedOrderIds[0]], // Đơn này đang trong sheet
    },
  );
  assert(
    resDuplicate.statusCode === 400,
    `Hệ thống từ chối tạo trùng đơn đang soạn với mã lỗi 400 Bad Request (Thực tế: ${resDuplicate.statusCode})`,
  );
  console.log(`  -> Thông báo lỗi trả về: "${resDuplicate.data?.message}"`);

  // 3.4 Cập nhật dòng hàng: Soạn thiếu mà KHÔNG nhập lý do -> Bắt buộc lỗi
  console.log('\n  * Kiểm tra ràng buộc bắt buộc nhập lý do khi soạn thiếu:');
  const firstItem = sheet.items[0];
  const shortQty = Math.max(0, firstItem.totalRequiredQuantity - 1);

  const resShortNoReason = await request(
    {
      hostname: urlExport.hostname,
      port: urlExport.port,
      path: `/api/picking-sheets/${sheet.id}/items/${firstItem.id}`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenKeeper}`,
      },
    },
    {
      pickedQuantity: shortQty,
      // Không truyền shortPickReason
    },
  );
  assert(
    resShortNoReason.statusCode === 400,
    `Chặn soạn thiếu không có lý do với mã 400 (Thông báo: "${resShortNoReason.data?.message}")`,
  );

  // 3.5 Cập nhật dòng hàng: Soạn thiếu CÓ lý do giải trình -> Thành công
  console.log('\n  * Cập nhật soạn thiếu có lý do giải trình hợp lệ:');
  const resShortWithReason = await request(
    {
      hostname: urlExport.hostname,
      port: urlExport.port,
      path: `/api/picking-sheets/${sheet.id}/items/${firstItem.id}`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenKeeper}`,
      },
    },
    {
      pickedQuantity: shortQty,
      shortPickReason: 'Bao bì bị rách khi bốc dỡ',
      shortPickReasonCode: 'DAMAGED_CARTOON',
    },
  );
  assert(resShortWithReason.statusCode === 200, 'Ghi nhận soạn thiếu kèm lý do thành công (HTTP 200)');
  const updatedItem = resShortWithReason.data.items.find((it) => it.id === firstItem.id);
  assert(
    updatedItem.status === 'SHORT_PICKED',
    `Trạng thái dòng chuyển thành SHORT_PICKED (Thực tế: ${updatedItem.status})`,
  );
  assert(
    updatedItem.shortPickReason === 'Bao bì bị rách khi bốc dỡ',
    'Lưu đúng nguyên văn lý do giải trình',
  );

  // 3.6 Thao tác 1-chạm: Soạn đủ các dòng còn lại
  console.log('\n  * Thao tác 1-chạm soạn đủ cho các dòng còn lại:');
  for (let i = 1; i < sheet.items.length; i++) {
    const item = sheet.items[i];
    const resQuick = await request({
      hostname: urlExport.hostname,
      port: urlExport.port,
      path: `/api/picking-sheets/${sheet.id}/quick-pick-all/${item.id}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenKeeper}`,
      },
    });
    assert(resQuick.statusCode === 200 || resQuick.statusCode === 201, `Đã đánh dấu soạn đủ dòng #${i + 1}`);
  }

  // 3.7 Hoàn tất phiếu soạn hàng
  console.log('\n  * Hoàn tất phiếu soạn hàng:');
  const resComplete = await request({
    hostname: urlExport.hostname,
    port: urlExport.port,
    path: `/api/picking-sheets/${sheet.id}/complete`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenKeeper}`,
    },
  });
  assert(resComplete.statusCode === 200 || resComplete.statusCode === 201, 'Hoàn tất phiếu soạn hàng thành công');
  const completedSheet = resComplete.data;
  assert(
    completedSheet.status === 'PARTIALLY_COMPLETED' || completedSheet.status === 'COMPLETED',
    `Trạng thái phiếu hoàn tất: ${completedSheet.status}`,
  );
  assert(Boolean(completedSheet.completedAt), `Thời gian hoàn tất được lưu: ${completedSheet.completedAt}`);

  // 3.8 Xóa / Hủy phiếu soạn hàng và hoàn trả đơn
  console.log('\n  * Xóa / Hủy phiếu soạn hàng:');
  const resDelete = await request({
    hostname: urlExport.hostname,
    port: urlExport.port,
    path: `/api/picking-sheets/${sheet.id}`,
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${tokenKeeper}`,
    },
  });
  assert(resDelete.statusCode === 200, `Xóa phiếu soạn hàng thành công (HTTP ${resDelete.statusCode})`);

  // 3.9 Kiểm tra phân quyền: Dealer không được phép tạo phiếu soạn
  console.log('\n  * Kiểm tra phân quyền bảo mật (RBAC):');
  const resDealerCreate = await request(
    {
      hostname: urlExport.hostname,
      port: urlExport.port,
      path: '/api/picking-sheets',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenDealer}`,
      },
    },
    {
      warehouseId: 'wh-hcm-01',
      selectedOrderIds: selectedOrderIds,
    },
  );
  assert(
    resDealerCreate.statusCode === 403,
    `Tài khoản đại lý bị chặn 403 Forbidden khi cố tạo phiếu soạn hàng (Thực tế: ${resDealerCreate.statusCode})`,
  );

  console.log('\n================================================================');
  console.log(`   KẾT QUẢ KIỂM THỬ: ${passed} PASS, ${failed} FAIL             `);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled error in test:', err);
  process.exit(1);
});
